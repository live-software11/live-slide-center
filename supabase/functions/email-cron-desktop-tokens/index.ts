/**
 * email-cron-desktop-tokens — Sprint SR (Security Review)
 *
 * Cron daily che scansiona i desktop_devices con pair_token in scadenza e
 * invia email warning all'admin del tenant a tre soglie distinte: T-30/T-14/T-7.
 *
 * Idempotente: la RPC `rpc_admin_list_expiring_desktop_devices` esclude i
 * device che hanno gia' ricevuto un'email per quella esatta `pair_token_expires_at`,
 * quindi ripetere la chiamata nello stesso giorno NON invia duplicati.
 *
 * AUTH: header `x-internal-secret` con `EMAIL_SEND_INTERNAL_SECRET`.
 *
 * Scheduling consigliato (vedi docs/Manuali/Manuale_Email_Resend.md):
 *   - GitHub Actions schedule '0 9 * * *' UTC (= 10-11 mattina ora Italia)
 *   - oppure pg_cron + http extension da Supabase Studio
 *   - oppure cron-job.org (gratuito, max 30s timeout)
 *
 * NOTA UX: il rinnovo del token e' AUTOMATICO lato client (auto-renew 7 gg
 * prima della scadenza). L'email serve come safety net: se il dispositivo e'
 * offline o fuori sede al momento della finestra di renew, l'admin riceve
 * la notifica e puo' estendere manualmente da pannello.
 *
 * POST {} (body vuoto, opzionale `{ dry_run: true }`)
 *   → 200 { processed: { 't-30': N, 't-14': N, 't-7': N }, dry_run: bool, errors: [...] }
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface CronBody {
  dry_run?: boolean;
}

interface DesktopWarningRow {
  device_id: string;
  device_name: string;
  tenant_id: string;
  tenant_name: string;
  admin_email: string;
  admin_full_name: string;
  pair_token_expires_at: string;
  days_remaining: number;
  machine_fingerprint: string;
}

const THRESHOLDS = [
  { kind: 'desktop-token-expiring-30', daysMin: 29, daysMax: 30 },
  { kind: 'desktop-token-expiring-14', daysMin: 13, daysMax: 14 },
  { kind: 'desktop-token-expiring-7', daysMin: 6, daysMax: 7 },
] as const;

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const internalSecret = Deno.env.get('EMAIL_SEND_INTERNAL_SECRET');
  if (!internalSecret) {
    return json({ error: 'env_misconfigured', detail: 'EMAIL_SEND_INTERNAL_SECRET' }, 500);
  }
  const provided = req.headers.get('x-internal-secret');
  if (!provided || !timingSafeEqual(provided, internalSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: CronBody = {};
  try {
    body = (await req.json()) as CronBody;
  } catch {
    body = {};
  }
  const dryRun = body.dry_run === true;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) {
    return json(
      { error: 'env_misconfigured', detail: 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY' },
      500,
    );
  }

  const admin = createClient(supabaseUrl, serviceRole);
  const processed: Record<string, number> = {};
  const errors: Array<{ kind: string; device_id: string; error: string }> = [];

  for (const t of THRESHOLDS) {
    const { data: rows, error: scanErr } = await admin.rpc(
      'rpc_admin_list_expiring_desktop_devices',
      {
        p_days_min: t.daysMin,
        p_days_max: t.daysMax,
        p_email_kind: t.kind,
      },
    );
    if (scanErr) {
      errors.push({ kind: t.kind, device_id: 'scan', error: scanErr.message });
      continue;
    }
    const deviceList = (rows ?? []) as DesktopWarningRow[];
    processed[t.kind] = deviceList.length;
    if (dryRun) continue;

    for (const device of deviceList) {
      try {
        const idempotencyKey = `${t.kind}_${device.device_id}_${device.pair_token_expires_at}`;
        const sendResp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret,
          },
          body: JSON.stringify({
            tenant_id: device.tenant_id,
            kind: t.kind,
            recipient: device.admin_email,
            data: {
              full_name: device.admin_full_name,
              tenant_name: device.tenant_name,
              device_name: device.device_name || device.machine_fingerprint.slice(0, 12),
              days_remaining: device.days_remaining,
              expires_at_iso: device.pair_token_expires_at,
              app_url: Deno.env.get('PUBLIC_APP_URL') ?? 'https://app.liveworksapp.com',
              devices_url: `${Deno.env.get('PUBLIC_APP_URL') ?? 'https://app.liveworksapp.com'}/admin/desktop-devices`,
              language: 'it',
              device_id: device.device_id,
              pair_token_expires_at_iso: device.pair_token_expires_at,
            },
            idempotency_key: idempotencyKey,
          }),
        });
        if (!sendResp.ok) {
          const detail = await sendResp.text();
          errors.push({
            kind: t.kind,
            device_id: device.device_id,
            error: `${sendResp.status}: ${detail.slice(0, 200)}`,
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        errors.push({ kind: t.kind, device_id: device.device_id, error: message });
      }
    }
  }

  return json({ processed, dry_run: dryRun, errors });
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
