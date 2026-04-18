/**
 * lemon-squeezy-webhook — Sprint R-2 (G2)
 *
 * Endpoint per webhook Lemon Squeezy (subscription_created / updated / cancelled / ...).
 * Sostituisce il flusso manuale di creazione tenant: quando un cliente compra
 * Slide Center su Live WORKS APP (lemonsqueezy.com), questo webhook crea
 * automaticamente il tenant + spedisce l'invito al primo admin.
 *
 * AUTH: HMAC SHA-256 sul body raw (NO timestamp prefix, formato standard
 *   Lemon Squeezy). Header `X-Signature: <hex>`.
 *   Header `X-Event-Name: subscription_created` (per dispatch).
 *
 * IDEMPOTENZA:
 *   1. Lemon Squeezy invia `meta.test_mode` e `meta.event_id` per ogni evento.
 *   2. Tabella `lemon_squeezy_event_log` con UNIQUE(event_id) blocca duplicati.
 *   3. Se evento gia' processed → return 200 skipped (Lemon Squeezy ferma retry).
 *
 * EVENT FLOW:
 *   - subscription_created    → crea tenant + invito admin + invia email
 *   - subscription_updated    → aggiorna plan/quote
 *   - subscription_payment_success → conferma renewal (estende expires_at)
 *   - subscription_resumed    → unsuspend
 *   - subscription_cancelled  → cancellazione futura (a fine periodo)
 *   - subscription_expired    → suspend immediato
 *   - subscription_paused     → suspend immediato
 *
 * SECRETS richiesti:
 *   - LEMON_SQUEEZY_WEBHOOK_SECRET    (signing secret da Lemon Squeezy dashboard)
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 *   - EMAIL_SEND_INTERNAL_SECRET      (per chiamare email-send a chain)
 *   - PUBLIC_APP_URL                  (es. https://app.liveslidecenter.com)
 *
 * RIFERIMENTI:
 *   - Webhook docs: https://docs.lemonsqueezy.com/help/webhooks
 *   - Subscription object: https://docs.lemonsqueezy.com/api/subscriptions
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface LemonSqueezyWebhookBody {
  meta: {
    event_name: string;
    test_mode?: boolean;
    custom_data?: Record<string, unknown>;
  };
  data: {
    id: string;
    type: string;
    attributes: {
      store_id?: number;
      customer_id?: number;
      order_id?: number;
      variant_id?: number;
      product_id?: number;
      product_name?: string;
      variant_name?: string;
      user_email?: string;
      user_name?: string;
      status?: string;
      renews_at?: string | null;
      ends_at?: string | null;
      trial_ends_at?: string | null;
      created_at?: string;
      updated_at?: string;
    };
  };
}

const HANDLED_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_resumed',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_cancelled',
  'subscription_expired',
  'subscription_payment_success',
  'subscription_payment_failed',
]);

const SUSPEND_EVENTS = new Set([
  'subscription_paused',
  'subscription_cancelled',
  'subscription_expired',
]);

// ── Crypto helpers ────────────────────────────────────────────────────────────
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

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function deriveEventId(payload: LemonSqueezyWebhookBody, rawBodyHash: string): string {
  // Lemon Squeezy NON espone un event_id stabile in tutti i payload, ma:
  //   1. data.id (subscription ID) + meta.event_name + data.attributes.updated_at
  //      e' sufficientemente univoco per i nostri scopi (idempotency event-level).
  //   2. Fallback a hash del body (raro: solo se mancano i campi sopra).
  const id = payload?.data?.id;
  const eventName = payload?.meta?.event_name;
  const updated = payload?.data?.attributes?.updated_at ?? payload?.data?.attributes?.created_at;
  if (id && eventName && updated) {
    return `${eventName}:${id}:${updated}`;
  }
  return `hash:${rawBodyHash}`;
}

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // ── 1) Validate env ─────────────────────────────────────────────────────────
  const webhookSecret = Deno.env.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
  if (!webhookSecret || webhookSecret.length < 16) {
    console.error('[lemon-squeezy-webhook] missing LEMON_SQUEEZY_WEBHOOK_SECRET');
    return jsonResponse(500, { error: 'server_misconfigured' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) {
    return jsonResponse(500, { error: 'server_misconfigured', detail: 'supabase_env' });
  }

  // ── 2) Read raw body + verify signature ─────────────────────────────────────
  const signature = req.headers.get('X-Signature') ?? req.headers.get('x-signature');
  const eventNameHeader = req.headers.get('X-Event-Name') ?? req.headers.get('x-event-name');

  if (!signature) {
    return jsonResponse(401, { error: 'missing_signature' });
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > 1024 * 1024) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const rawBody = await req.text();
  if (rawBody.length > 1024 * 1024) {
    return jsonResponse(413, { error: 'payload_too_large' });
  }

  const expected = await hmacHex(webhookSecret, rawBody);
  // Lemon Squeezy invia la firma SENZA prefisso `sha256=` (a differenza GitHub).
  // Accettiamo entrambi i formati per safety.
  const sigClean = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  if (!timingSafeEqualHex(sigClean.toLowerCase(), expected.toLowerCase())) {
    console.warn('[lemon-squeezy-webhook] invalid signature');
    return jsonResponse(401, { error: 'invalid_signature' });
  }

  // ── 3) Parse JSON ──────────────────────────────────────────────────────────
  let payload: LemonSqueezyWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LemonSqueezyWebhookBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const eventName = payload?.meta?.event_name ?? eventNameHeader ?? '';
  if (!eventName) {
    return jsonResponse(400, { error: 'missing_event_name' });
  }

  if (!HANDLED_EVENTS.has(eventName)) {
    // Eventi non gestiti (es. order_*) → return 200 per evitare retry.
    return jsonResponse(200, { skipped: true, reason: 'event_not_handled', event_name: eventName });
  }

  const subscriptionId = payload?.data?.id ?? null;
  const customerId = payload?.data?.attributes?.customer_id != null
    ? String(payload.data.attributes.customer_id)
    : null;
  const variantId = payload?.data?.attributes?.variant_id != null
    ? String(payload.data.attributes.variant_id)
    : null;
  const customerEmail = payload?.data?.attributes?.user_email ?? null;
  const customerName = payload?.data?.attributes?.user_name
    ?? payload?.data?.attributes?.product_name
    ?? null;
  const status = payload?.data?.attributes?.status ?? 'unknown';
  const renewsAt = payload?.data?.attributes?.renews_at ?? null;
  const endsAt = payload?.data?.attributes?.ends_at ?? null;

  if (!subscriptionId) {
    return jsonResponse(400, { error: 'missing_subscription_id' });
  }

  // ── 4) Idempotency check ───────────────────────────────────────────────────
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Hash del body per fallback event_id
  const bodyHash = await hmacHex('idempotency-salt', rawBody);
  const eventId = deriveEventId(payload, bodyHash.slice(0, 16));

  const { data: idempotencyData, error: idempotencyError } = await admin.rpc(
    'record_lemon_squeezy_event',
    {
      p_event_id: eventId,
      p_event_name: eventName,
      p_subscription_id: subscriptionId,
      p_customer_id: customerId,
      p_payload: payload as unknown as Record<string, unknown>,
    },
  );

  if (idempotencyError) {
    console.error('[lemon-squeezy-webhook] idempotency error', idempotencyError);
    return jsonResponse(500, { error: 'idempotency_failed' });
  }

  const idempotencyResult = idempotencyData as {
    is_new: boolean;
    log_id: string;
    previous_status?: string;
  };

  if (!idempotencyResult.is_new) {
    return jsonResponse(200, {
      skipped: true,
      reason: 'duplicate_event',
      previous_status: idempotencyResult.previous_status,
      log_id: idempotencyResult.log_id,
    });
  }

  // ── 5) Validate dati richiesti per applicare evento ─────────────────────────
  if (!variantId) {
    await admin.rpc('mark_lemon_squeezy_event_processed', {
      p_log_id: idempotencyResult.log_id,
      p_status: 'failed',
      p_tenant_id: null,
      p_error_message: 'missing_variant_id',
    });
    return jsonResponse(400, { error: 'missing_variant_id' });
  }

  if (!customerEmail || !customerEmail.includes('@')) {
    await admin.rpc('mark_lemon_squeezy_event_processed', {
      p_log_id: idempotencyResult.log_id,
      p_status: 'failed',
      p_tenant_id: null,
      p_error_message: 'missing_customer_email',
    });
    return jsonResponse(400, { error: 'missing_customer_email' });
  }

  // ── 6) Apply event al tenant ────────────────────────────────────────────────
  const appUrl = Deno.env.get('PUBLIC_APP_URL') ?? 'https://app.liveslidecenter.com';

  const { data: applyData, error: applyError } = await admin.rpc(
    'lemon_squeezy_apply_subscription_event',
    {
      p_event_name: eventName,
      p_subscription_id: subscriptionId,
      p_customer_id: customerId,
      p_variant_id: variantId,
      p_customer_email: customerEmail,
      p_customer_name: customerName,
      p_status: status,
      p_renews_at: renewsAt,
      p_ends_at: endsAt,
      p_app_url: appUrl,
    },
  );

  if (applyError) {
    const msg = applyError.message ?? 'apply_failed';
    await admin.rpc('mark_lemon_squeezy_event_processed', {
      p_log_id: idempotencyResult.log_id,
      p_status: 'failed',
      p_tenant_id: null,
      p_error_message: msg.slice(0, 500),
    });
    console.error('[lemon-squeezy-webhook] apply error', msg);
    // Mappa errori noti a status HTTP appropriati
    const httpStatus = msg.includes('unknown_variant_id') || msg.includes('subscription_id_required')
      || msg.includes('invalid_email') ? 400 : 500;
    return jsonResponse(httpStatus, { error: msg });
  }

  const result = applyData as {
    action: 'created' | 'updated' | 'suspended' | 'resumed' | 'noop';
    tenant_id: string | null;
    invite_url?: string;
    invite_token?: string;
    invite_expires_at?: string;
    admin_email?: string;
    tenant_name?: string;
    reason?: string;
  };

  // ── 7) Se nuovo tenant: invia email admin invitato (R-1.b inline) ───────────
  let emailSent = false;
  let emailError: string | null = null;

  if (result.action === 'created' && result.invite_url && result.admin_email) {
    const internalSecret = Deno.env.get('EMAIL_SEND_INTERNAL_SECRET');
    if (internalSecret) {
      try {
        const emailResp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret,
          },
          body: JSON.stringify({
            tenant_id: result.tenant_id,
            kind: 'admin-invite',
            recipient: result.admin_email,
            data: {
              tenant_name: result.tenant_name ?? '',
              invite_url: result.invite_url,
              invite_expires_at: result.invite_expires_at,
              app_url: appUrl,
              language: 'it', // TODO: derive da customer locale se disponibile
            },
            idempotency_key: `admin-invite_${result.tenant_id}_${result.invite_token?.slice(0, 16)}`,
          }),
        });
        if (emailResp.ok) {
          emailSent = true;
        } else {
          emailError = `${emailResp.status}: ${(await emailResp.text()).slice(0, 200)}`;
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : 'unknown';
      }
    } else {
      emailError = 'missing_internal_secret';
    }
  }

  // ── 8) Mark evento processato ───────────────────────────────────────────────
  // Status 'processed' anche se email fallita: il tenant esiste, l'admin puo'
  // essere reinvitato manualmente via /admin/tenants. Logiamo l'errore ma non
  // fail dell'intero webhook (Lemon Squeezy retryebbe e creerebbe duplicati).
  const finalStatus = result.action === 'noop' ? 'skipped' : 'processed';
  await admin.rpc('mark_lemon_squeezy_event_processed', {
    p_log_id: idempotencyResult.log_id,
    p_status: finalStatus,
    p_tenant_id: result.tenant_id,
    p_error_message: emailError,
  });

  return jsonResponse(200, {
    ok: true,
    action: result.action,
    tenant_id: result.tenant_id,
    email_sent: emailSent,
    email_error: emailError,
    log_id: idempotencyResult.log_id,
  });
});
