// ════════════════════════════════════════════════════════════════════════════
// Edge Function: licensing-shadow
// ────────────────────────────────────────────────────────────────────────────
// Audit bidirezionalita Ondata 3 (GAP-8) — 2026-04-19.
//
// READ-ONLY mirror di `licensing-sync`. Restituisce lo "shadow" attuale del
// tenant Slide Center (plan, status, quote osservate, scadenza) verso il
// control plane Live WORKS APP, che lo usa per ricostruire
// `crossProjectShadow.slideCenter` quando l'admin clicca "Sincronizza ora"
// nella dialog cross-project (recupero drift / callback HMAC perso / change
// manuale via Supabase Studio).
//
// Auth: identica a `licensing-sync`:
//   X-Live-Signature : sha256=<hex>     -- HMAC(SLIDECENTER_LICENSING_HMAC_SECRET, ts + "." + body)
//   X-Live-Timestamp : <unix-ms>        -- richiesta scartata se > 5 minuti dal now
//   X-Live-Nonce     : <random>         -- opzionale (idempotency lato chiamante)
//
// Riusiamo lo stesso `SLIDECENTER_LICENSING_HMAC_SECRET` di `licensing-sync`
// (gia' configurato come Function Secret su Supabase + speculare a
// `SLIDECENTER_HMAC_SECRET` su Firebase secrets WORKS): zero nuovi secret da
// gestire/ruotare e niente service_role esposto fuori da Supabase.
//
// Body atteso:
//   { tenant_id?: string }  oppure  { license_key?: string }
//   (almeno uno; tenant_id ha priorita' se entrambi presenti)
//
// Response 200:
//   {
//     shadow: {
//       plan: string,
//       status: 'active' | 'suspended',
//       storageUsedBytes: number | null,
//       storageLimitBytes: number | null,
//       maxRoomsPerEvent: number | null,
//       maxDevicesPerRoom: number | null,
//       maxActiveEvents: number | null,
//       expiresAt: string | null,            // ISO8601
//       lastObservedAt: number               // unix-ms al momento del SELECT
//     }
//   }
//
// NESSUN JWT richiesto (verify_jwt = false in config.toml).
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024; // 8 KiB largamente sufficiente per { tenant_id, license_key }

interface ShadowBody {
  tenant_id?: string | null;
  license_key?: string | null;
}

interface TenantShadowRow {
  id: string;
  plan: string | null;
  suspended: boolean | null;
  expires_at: string | null;
  storage_used_bytes: number | string | null;
  storage_limit_bytes: number | string | null;
  max_rooms_per_event: number | null;
  // Audit UI nomenclatura quote 2026-04-20.
  // Entrambi letti per backward compat: la DB migration mantiene le due colonne
  // sincronizzate finche' non sara' rimossa la vecchia.
  max_devices_per_room: number | null;
  max_devices_per_event: number | null;
  max_active_events: number | null;
  license_key: string | null;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isValidUuid(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // Healthcheck mirror di licensing-sync (no HMAC necessario): permette a
  // monitor/probe esterni di verificare che la function sia online senza
  // possedere il secret.
  const url = new URL(req.url);
  if (url.searchParams.get('healthcheck') === '1') {
    return jsonResponse(200, { ok: true, healthcheck: true });
  }
  const peekRaw = await req.clone().text().catch(() => '');
  if (peekRaw.length < 256 && /"healthcheck"\s*:\s*true/.test(peekRaw)) {
    return jsonResponse(200, { ok: true, healthcheck: true });
  }

  const secret = Deno.env.get('SLIDECENTER_LICENSING_HMAC_SECRET');
  if (!secret || secret.length < 32) {
    return jsonResponse(500, { error: 'server_misconfigured' });
  }

  const ts = req.headers.get('X-Live-Timestamp');
  const sig = req.headers.get('X-Live-Signature');
  if (!ts || !sig) {
    return jsonResponse(401, { error: 'missing_signature_headers' });
  }

  const tsMs = Number(ts);
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_CLOCK_SKEW_MS) {
    return jsonResponse(401, { error: 'timestamp_invalid_or_expired' });
  }

  // Hard cap difensivo: il body atteso e' minimo (qualche centinaio di byte
  // al massimo). Limite generoso 8 KiB.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const expected = `sha256=${await hmacHex(secret, `${ts}.${rawBody}`)}`;
  if (!timingSafeEqualHex(sig, expected)) {
    return jsonResponse(401, { error: 'invalid_signature' });
  }

  let payload: ShadowBody;
  try {
    payload = JSON.parse(rawBody) as ShadowBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const tenantIdRaw = (payload.tenant_id ?? '').toString().trim();
  const licenseKeyRaw = (payload.license_key ?? '').toString().trim();

  if (!tenantIdRaw && !licenseKeyRaw) {
    return jsonResponse(400, { error: 'tenant_id_or_license_key_required' });
  }
  if (tenantIdRaw && !isValidUuid(tenantIdRaw)) {
    return jsonResponse(400, { error: 'invalid_tenant_id' });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // SELECT minimo dei campi shadow. service_role bypassa RLS — accesso
  // ristretto perche' la function richiede HMAC firma con secret condiviso
  // solo con il control plane WORKS.
  // Audit UI nomenclatura quote 2026-04-20: includiamo entrambe le colonne
  // device cap (vecchia + nuova) finche' WORKS non smette di leggere la vecchia.
  const SELECT_COLS =
    'id,plan,suspended,expires_at,storage_used_bytes,storage_limit_bytes,' +
    'max_rooms_per_event,max_devices_per_room,max_devices_per_event,' +
    'max_active_events,license_key';

  let query = supabaseAdmin
    .from('tenants')
    .select(SELECT_COLS)
    .limit(1);

  if (tenantIdRaw) {
    query = query.eq('id', tenantIdRaw);
  } else {
    query = query.eq('license_key', licenseKeyRaw);
  }

  const { data, error } = await query.maybeSingle<TenantShadowRow>();

  if (error) {
    console.error('[licensing-shadow] select_failed', {
      tenantId: tenantIdRaw || null,
      raw: error.message,
    });
    return jsonResponse(500, { error: 'select_failed' });
  }

  if (!data) {
    return jsonResponse(404, { error: 'tenant_not_found' });
  }

  // Audit UI nomenclatura quote 2026-04-20: la nuova UI usa
  // maxDevicesPerEvent; manteniamo maxDevicesPerRoom nel payload con lo
  // stesso valore per non rompere consumatori legacy (es. WORKS Functions
  // pre-rinomina). Nuova logica deve preferire maxDevicesPerEvent.
  const devicesPerEvent =
    num(data.max_devices_per_event) ?? num(data.max_devices_per_room);
  const shadow = {
    plan: typeof data.plan === 'string' && data.plan.length > 0 ? data.plan : 'unknown',
    status: data.suspended === true ? 'suspended' : 'active',
    storageUsedBytes: num(data.storage_used_bytes),
    storageLimitBytes: num(data.storage_limit_bytes),
    maxRoomsPerEvent: num(data.max_rooms_per_event),
    maxDevicesPerRoom: devicesPerEvent,
    maxDevicesPerEvent: devicesPerEvent,
    maxActiveEvents: num(data.max_active_events),
    expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
    lastObservedAt: Date.now(),
  };

  return jsonResponse(200, { shadow });
});
