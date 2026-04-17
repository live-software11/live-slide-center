/**
 * email-cron-licenses — Sprint 7
 *
 * Cron daily che scansiona i tenant con licenza in scadenza e invia email di
 * warning a tre soglie distinte: T-30 / T-7 / T-1.
 *
 * Idempotente: la RPC `list_tenants_for_license_warning` esclude i tenant
 * che hanno gia' ricevuto un'email per quella esatta `expires_at`, quindi
 * ripetere la chiamata nello stesso giorno NON invia duplicati.
 *
 * AUTH: header `x-internal-secret` con `EMAIL_SEND_INTERNAL_SECRET`.
 *
 * Scheduling consigliato (vedi docs/Manuali/Manuale_Email_Resend.md):
 *   - GitHub Actions schedule '0 8 * * *' UTC (= 9-10 mattina ora Italia)
 *   - oppure pg_cron + http extension da Supabase Studio
 *   - oppure servizio esterno tipo cron-job.org (gratuito, max 30s timeout)
 *
 * POST {} (body vuoto, opzionale `{ dry_run: true }` per non inviare davvero)
 *   → 200 { processed: { 't-30': N, 't-7': N, 't-1': N }, dry_run: bool, errors: [...] }
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface CronBody {
  dry_run?: boolean;
}

interface TenantWarningRow {
  tenant_id: string;
  tenant_name: string;
  admin_email: string;
  admin_full_name: string;
  expires_at: string;
  plan: string;
  days_remaining: number;
}

const THRESHOLDS = [
  { kind: 'license-expiring-30', daysMin: 29, daysMax: 30 },
  { kind: 'license-expiring-7', daysMin: 6, daysMax: 7 },
  { kind: 'license-expiring-1', daysMin: 0, daysMax: 1 },
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
    return json({ error: 'env_misconfigured', detail: 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRole);
  const processed: Record<string, number> = {};
  const errors: Array<{ kind: string; tenant_id: string; error: string }> = [];

  for (const t of THRESHOLDS) {
    const { data: rows, error: scanErr } = await admin.rpc('list_tenants_for_license_warning', {
      p_days_min: t.daysMin,
      p_days_max: t.daysMax,
      p_email_kind: t.kind,
    });
    if (scanErr) {
      errors.push({ kind: t.kind, tenant_id: 'scan', error: scanErr.message });
      continue;
    }
    const tenantList = (rows ?? []) as TenantWarningRow[];
    processed[t.kind] = tenantList.length;
    if (dryRun) continue;

    for (const tenant of tenantList) {
      try {
        const idempotencyKey = `${t.kind}_${tenant.tenant_id}_${tenant.expires_at}`;
        const sendResp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret,
          },
          body: JSON.stringify({
            tenant_id: tenant.tenant_id,
            kind: 'license-expiring',
            recipient: tenant.admin_email,
            data: {
              full_name: tenant.admin_full_name,
              tenant_name: tenant.tenant_name,
              days_remaining: tenant.days_remaining,
              expires_at_iso: tenant.expires_at,
              app_url: Deno.env.get('PUBLIC_APP_URL') ?? 'https://app.liveworksapp.com',
              billing_url: `${Deno.env.get('PUBLIC_APP_URL') ?? 'https://app.liveworksapp.com'}/billing`,
              language: 'it', // TODO Sprint 7+: leggere users.language quando aggiunto
            },
            idempotency_key: idempotencyKey,
          }),
        });
        if (!sendResp.ok) {
          const detail = await sendResp.text();
          errors.push({ kind: t.kind, tenant_id: tenant.tenant_id, error: `${sendResp.status}: ${detail.slice(0, 200)}` });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        errors.push({ kind: t.kind, tenant_id: tenant.tenant_id, error: message });
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
