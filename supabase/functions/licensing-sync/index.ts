// Edge Function: licensing-sync
// Riceve push di quote/scadenza dalla piattaforma centrale Live WORKS APP
// (Cloud Functions Firebase) e li applica al tenant Supabase corrispondente.
//
// Auth: HMAC SHA-256 sul body raw + replay-protection via timestamp.
//   Headers richiesti:
//     X-Live-Signature : sha256=<hex>     -- HMAC(SLIDECENTER_LICENSING_HMAC_SECRET, ts + "." + body)
//     X-Live-Timestamp : <unix-ms>        -- richiesta scartata se > 5 minuti dal now
//     X-Live-Nonce     : <random>         -- opzionale (idempotency lato chiamante)
//
// NESSUN JWT richiesto (verify_jwt = false in config.toml).
//
// Errori volutamente NON espongono dettagli interni Postgres: si mappano su
// codici stabili. Logging completo lato Supabase Functions Logs.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TENANT_PLANS = ['trial', 'starter', 'pro', 'enterprise'] as const;
const LICENSE_STATUSES = ['active', 'suspended', 'expired', 'revoked'] as const;
const STORAGE_MIN = -1; // -1 = illimitato (Enterprise convention)
const STORAGE_MAX = 10 * 1024 ** 4; // 10 TiB (sanity cap)
const ROOMS_MIN = 0;
const ROOMS_MAX = 1024;
const DEVICES_MIN = 0;
const DEVICES_MAX = 1024;
// Audit edit-policy-per-software 2026-04-19: -1 = unlimited; 0 vietato.
const ACTIVE_EVENTS_MIN = -1;
const ACTIVE_EVENTS_MAX = 1024;
// Audit allineamento WORKS<->SC 2026-04-20: 0 = illimitato; range 0..1024.
const EVENTS_PER_MONTH_MIN = 0;
const EVENTS_PER_MONTH_MAX = 1024;

type TenantPlan = (typeof TENANT_PLANS)[number];
type LicenseStatus = (typeof LICENSE_STATUSES)[number];

interface SyncBody {
  license_key?: string;
  tenant_id?: string | null;
  plan?: TenantPlan;
  storage_limit_bytes?: number | null;
  max_rooms_per_event?: number | null;
  // Audit UI nomenclatura quote 2026-04-20: rinomina semantica.
  // - max_devices_per_room: DEPRECATED, mantenuto in lettura per retro-
  //   compatibilita con WORKS Functions non ancora deployate.
  // - max_devices_per_event: nuovo nome ufficiale (limite totale per evento).
  // Se entrambi presenti vince max_devices_per_event.
  max_devices_per_room?: number | null;
  max_devices_per_event?: number | null;
  max_active_events?: number | null;
  // Audit allineamento WORKS<->SC 2026-04-20: limite eventi nel mese corrente
  // per il tenant. 0 = illimitato (convention enterprise). Mappa su
  // tenants.max_events_per_month nel DB.
  max_events_per_month?: number | null;
  expires_at?: string | null;
  status?: LicenseStatus;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cache HMAC key per la durata dell'isolate (subtle.importKey è costoso).
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

function sanitizedRpcError(message: string | undefined): string {
  if (!message) return 'rpc_failed';
  // Mappa codici noti restituiti da licensing_apply_quota e simili.
  const known = [
    'license_key_required',
    'tenant_not_resolved',
    'tenant_not_found',
    'invalid_storage_limit',
    'invalid_max_rooms',
    'invalid_max_devices',
    'invalid_max_devices_per_event',
    'invalid_max_active_events',
    'invalid_max_events_per_month',
  ];
  for (const code of known) {
    if (message.includes(code)) return code;
  }
  return 'rpc_failed';
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // Healthcheck early-exit: chiamata da AdminHealthView per verificare che la
  // function sia online. Non richiede HMAC; legge solo il body senza side effects.
  // Distinto dal flusso reale tramite query string (?healthcheck=1) o body marker.
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

  // Hard limit per evitare DoS via body enormi (1 MiB più che sufficiente).
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > 1024 * 1024) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const rawBody = await req.text();
  if (rawBody.length > 1024 * 1024) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const expected = `sha256=${await hmacHex(secret, `${ts}.${rawBody}`)}`;
  if (!timingSafeEqualHex(sig, expected)) {
    return jsonResponse(401, { error: 'invalid_signature' });
  }

  let payload: SyncBody;
  try {
    payload = JSON.parse(rawBody) as SyncBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const licenseKey = (payload.license_key ?? '').trim();
  if (!licenseKey) {
    return jsonResponse(400, { error: 'license_key_required' });
  }

  const plan: TenantPlan = (payload.plan ?? 'starter') as TenantPlan;
  if (!TENANT_PLANS.includes(plan)) {
    return jsonResponse(400, { error: 'invalid_plan' });
  }

  const status: LicenseStatus = (payload.status ?? 'active') as LicenseStatus;
  if (!LICENSE_STATUSES.includes(status)) {
    return jsonResponse(400, { error: 'invalid_status' });
  }

  // Validazione numerica difensiva (la RPC ricontrolla, ma fail-fast lato edge).
  const storage = payload.storage_limit_bytes;
  if (storage != null) {
    if (!Number.isFinite(storage) || storage < STORAGE_MIN || storage > STORAGE_MAX) {
      return jsonResponse(400, { error: 'invalid_storage_limit' });
    }
  }
  const rooms = payload.max_rooms_per_event;
  if (rooms != null) {
    if (!Number.isInteger(rooms) || rooms < ROOMS_MIN || rooms > ROOMS_MAX) {
      return jsonResponse(400, { error: 'invalid_max_rooms' });
    }
  }
  // Audit UI nomenclatura quote 2026-04-20: prefer max_devices_per_event.
  const devices =
    payload.max_devices_per_event !== undefined
      ? payload.max_devices_per_event
      : payload.max_devices_per_room;
  if (devices != null) {
    if (!Number.isInteger(devices) || devices < DEVICES_MIN || devices > DEVICES_MAX) {
      return jsonResponse(400, { error: 'invalid_max_devices' });
    }
  }
  // Audit edit-policy-per-software 2026-04-19: -1 unlimited; 0 invalido; range 1..1024.
  const activeEvents = payload.max_active_events;
  if (activeEvents != null) {
    if (
      !Number.isInteger(activeEvents) ||
      activeEvents < ACTIVE_EVENTS_MIN ||
      activeEvents === 0 ||
      activeEvents > ACTIVE_EVENTS_MAX
    ) {
      return jsonResponse(400, { error: 'invalid_max_active_events' });
    }
  }
  // Audit allineamento WORKS<->SC 2026-04-20: 0 = illimitato; range 0..1024.
  const eventsPerMonth = payload.max_events_per_month;
  if (eventsPerMonth != null) {
    if (
      !Number.isInteger(eventsPerMonth) ||
      eventsPerMonth < EVENTS_PER_MONTH_MIN ||
      eventsPerMonth > EVENTS_PER_MONTH_MAX
    ) {
      return jsonResponse(400, { error: 'invalid_max_events_per_month' });
    }
  }

  const tenantId = payload.tenant_id;
  if (tenantId != null && !isValidUuid(tenantId)) {
    return jsonResponse(400, { error: 'invalid_tenant_id' });
  }

  const expiresAt = payload.expires_at;
  if (expiresAt != null) {
    const t = Date.parse(expiresAt);
    if (!Number.isFinite(t)) {
      return jsonResponse(400, { error: 'invalid_expires_at' });
    }
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Audit UI nomenclatura quote 2026-04-20: la RPC ora si aspetta
  // p_max_devices_per_event; la migration scrive su entrambe le colonne
  // DB (vecchia + nuova) per safe coesistenza con consumatori non aggiornati.
  const { data, error } = await supabaseAdmin.rpc('licensing_apply_quota', {
    p_license_key: licenseKey,
    p_tenant_id: tenantId ?? null,
    p_plan: plan,
    p_storage_limit_bytes: storage ?? null,
    p_max_rooms_per_event: rooms ?? null,
    p_max_devices_per_event: devices ?? null,
    p_expires_at: expiresAt ?? null,
    p_status: status,
    p_max_active_events: activeEvents ?? null,
    p_max_events_per_month: eventsPerMonth ?? null,
  });

  if (error) {
    const code = sanitizedRpcError(error.message);
    const httpStatus =
      code === 'tenant_not_resolved' || code === 'tenant_not_found'
        ? 404
        : code.startsWith('invalid_') || code === 'license_key_required'
          ? 400
          : 500;
    // Dettaglio raw solo nei logs (non in response al client).
    console.error('[licensing-sync] rpc_failed', { code, raw: error.message });
    return jsonResponse(httpStatus, { error: code });
  }

  return jsonResponse(200, data ?? { ok: true });
});
