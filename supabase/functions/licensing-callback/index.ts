// Edge Function: licensing-callback
// =============================================================================
// Notifica Live WORKS APP quando lo stato licensing di un tenant Slide Center
// cambia (campi rilevanti: plan, status/suspended, expires_at, storage_limit,
// max_rooms_per_event, max_devices_per_room, storage_used_bytes — opzionale).
//
// FLUSSO:
//   1) Trigger Postgres `notify_works_on_tenant_change` AFTER UPDATE su
//      `public.tenants` invoca questa function via pg_net.http_post.
//   2) Auth interna: header `x-internal-secret` confrontato con
//      `LICENSING_CALLBACK_INTERNAL_SECRET` (no JWT utente — `verify_jwt=false`).
//   3) Lookup tenant via service role.
//   4) Costruzione payload `slideCenter` shadow.
//   5) HMAC SHA-256 sul payload + POST verso WORKS endpoint
//      `LIVEWORKS_CALLBACK_URL` con headers:
//        X-Backend: slide_center
//        X-Signature: <hex>
//        Content-Type: application/json
//
// FAIL-SAFE: ogni errore viene loggato ma la function ritorna sempre 200/202
// se l'auth e' valida — l'invocazione dal trigger DB non deve mai
// rallentare/bloccare l'UPDATE originale. WORKS riceve i dati appena
// disponibili; se la chiamata fallisce, il prossimo UPDATE rilancera' la sync.
//
// CONFIG (letta via RPC SECURITY DEFINER `_internal_get_licensing_callback_config`,
// che a sua volta legge da `app.licensing_callback_*` settings popolati via
// `ALTER DATABASE SET`. Vedi migration:
// `20260420090000_sprint_xy_licensing_callback_trigger.sql`):
//   - internal_secret  (random ≥32 char; confrontato col header x-internal-secret)
//   - callback_url     (URL endpoint WORKS, es. https://api-57fephgjwq-ew.a.run.app/api/webhook/sync-from-backend)
//   - hmac_secret      (stesso valore di SLIDECENTER_HMAC_SECRET su WORKS)
//   - enabled          ('true'|'false', toggle globale)
// Dipendenze env Supabase native (no setup):
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Anti-loop integrato lato WORKS: il push WORKS->SC viene skippato se
// `_lastSyncedFromBackend < 5s` (vedi cross-project-push.ts su WORKS).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface CallbackBody {
  tenant_id?: string;
  source_op?: string;
}

interface CallbackConfig {
  internal_secret: string | null;
  callback_url: string | null;
  hmac_secret: string | null;
  enabled: boolean;
}

interface TenantRow {
  id: string;
  license_key: string | null;
  plan: string | null;
  suspended: boolean | null;
  expires_at: string | null;
  storage_limit_bytes: number | null;
  storage_used_bytes: number | null;
  max_rooms_per_event: number | null;
  max_devices_per_room: number | null;
  license_synced_at: string | null;
  updated_at: string | null;
}

interface SlideCenterShadowPayload {
  plan: string | null;
  status: 'active' | 'suspended' | 'expired';
  suspended: boolean;
  expiresAt: string | null;
  storageLimitBytes: number | null;
  storageUsedBytes: number | null;
  maxRoomsPerEvent: number | null;
  maxDevicesPerRoom: number | null;
  licenseSyncedAt: string | null;
  observedAt: string;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isValidUuid(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

let cachedHmacKey: { secret: string; key: CryptoKey } | null = null;
async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedHmacKey && cachedHmacKey.secret === secret) return cachedHmacKey.key;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  cachedHmacKey = { secret, key };
  return key;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function deriveStatus(t: TenantRow): 'active' | 'suspended' | 'expired' {
  const now = Date.now();
  const exp = t.expires_at ? Date.parse(t.expires_at) : NaN;
  if (Number.isFinite(exp) && exp < now) return 'expired';
  if (t.suspended === true) return 'suspended';
  return 'active';
}

function buildShadow(t: TenantRow): SlideCenterShadowPayload {
  return {
    plan: t.plan,
    status: deriveStatus(t),
    suspended: t.suspended === true,
    expiresAt: t.expires_at,
    storageLimitBytes: t.storage_limit_bytes,
    storageUsedBytes: t.storage_used_bytes,
    maxRoomsPerEvent: t.max_rooms_per_event,
    maxDevicesPerRoom: t.max_devices_per_room,
    licenseSyncedAt: t.license_synced_at,
    observedAt: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Carica config da DB settings via RPC SECURITY DEFINER. Single source of
  // truth: cosi' non serve duplicare i secret in env edge function.
  const { data: configData, error: configErr } = await supabaseAdmin.rpc(
    '_internal_get_licensing_callback_config',
  );
  if (configErr) {
    console.error('[licensing-callback] config_rpc_failed', { error: configErr.message });
    return jsonResponse(500, { error: 'config_unavailable' });
  }
  const config = (configData ?? {}) as CallbackConfig;
  if (!config.internal_secret || config.internal_secret.length < 32) {
    return jsonResponse(500, {
      error: 'server_misconfigured',
      detail: 'app.licensing_callback_internal_secret',
    });
  }

  const providedSecret = req.headers.get('x-internal-secret') ?? '';
  if (!timingSafeEqual(providedSecret, config.internal_secret)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  let body: CallbackBody;
  try {
    body = (await req.json()) as CallbackBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const tenantId = (body.tenant_id ?? '').trim();
  if (!isValidUuid(tenantId)) {
    return jsonResponse(400, { error: 'invalid_tenant_id' });
  }

  if (!config.enabled) {
    // Feature flag spenta lato DB: il trigger non dovrebbe arrivare qui ma
    // double-check applicativo per safety in caso di flag race.
    return jsonResponse(200, { ok: true, skipped: 'feature_disabled' });
  }

  if (!config.callback_url || !config.hmac_secret) {
    console.warn('[licensing-callback] callback disabled (missing url or hmac)', {
      hasUrl: !!config.callback_url,
      hasHmac: !!config.hmac_secret,
    });
    return jsonResponse(200, { ok: true, skipped: 'callback_disabled' });
  }

  const callbackUrl = config.callback_url;
  const hmacSecret = config.hmac_secret;

  const { data: tenant, error } = await supabaseAdmin
    .from('tenants')
    .select(
      'id, license_key, plan, suspended, expires_at, storage_limit_bytes, storage_used_bytes, max_rooms_per_event, max_devices_per_room, license_synced_at, updated_at',
    )
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[licensing-callback] tenant_lookup_failed', { tenantId, error: error.message });
    return jsonResponse(500, { error: 'tenant_lookup_failed' });
  }
  if (!tenant) {
    return jsonResponse(404, { error: 'tenant_not_found' });
  }

  const shadow = buildShadow(tenant as TenantRow);
  const callbackPayload = {
    backend: 'slide_center',
    tenantId,
    licenseKey: tenant.license_key ?? null,
    payload: shadow,
    sourceOp: body.source_op ?? null,
  };
  const rawBody = JSON.stringify(callbackPayload);
  const signature = await hmacHex(hmacSecret, rawBody);

  try {
    const resp = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend': 'slide_center',
        'X-Signature': signature,
      },
      body: rawBody,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[licensing-callback] works_callback_non_2xx', {
        tenantId,
        status: resp.status,
        body: text.slice(0, 256),
      });
      return jsonResponse(502, {
        error: 'works_callback_failed',
        upstream_status: resp.status,
      });
    }

    let upstream: unknown = null;
    try {
      upstream = await resp.json();
    } catch {
      // ignore
    }
    return jsonResponse(200, {
      ok: true,
      tenantId,
      sourceOp: body.source_op ?? null,
      upstream,
    });
  } catch (err) {
    console.error('[licensing-callback] works_callback_exception', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(502, { error: 'works_callback_exception' });
  }
});
