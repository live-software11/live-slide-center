/**
 * email-send — Sprint 7
 *
 * Invio email transazionali via Resend (https://resend.com).
 *
 * AUTH (server-to-server only):
 *   Header `x-internal-secret: <EMAIL_SEND_INTERNAL_SECRET>` obbligatorio.
 *   `verify_jwt = false` in config.toml (no JWT utente: chiamata da Edge cron o
 *   da trigger DB via http extension, oppure da Cloud Function Live WORKS APP).
 *
 * POST {
 *   tenant_id: string | null,         // null = email super-admin (es. notifiche di sistema)
 *   kind: 'welcome' | 'license-expiring' | 'storage-warning' | 'event-published',
 *   recipient: string,                // email destinatario
 *   subject?: string,                 // opzionale, fallback al default per kind
 *   data: Record<string, unknown>,    // dati per render template
 *   idempotency_key: string,          // anti-duplicati: se gia' inviato, ritorna { skipped: true }
 *   reply_to?: string                 // override reply-to
 * }
 *
 * RESPONSE 200: { sent: true, provider_message_id, log_id } | { skipped: true, log_id }
 * RESPONSE 401: { error: 'unauthorized' }
 * RESPONSE 422: { error: 'invalid_payload' | 'unknown_kind' | 'invalid_recipient' }
 * RESPONSE 502: { error: 'resend_failed', detail }
 *
 * SECRETS richiesti (Supabase Dashboard → Edge Functions → Secrets):
 *   - RESEND_API_KEY            (api_xxx, da resend.com)
 *   - RESEND_FROM_EMAIL         (es. "Live Slide Center <noreply@liveworksapp.com>")
 *   - EMAIL_SEND_INTERNAL_SECRET (random >=32 char, vedi docs/Manuali/Manuale_Email_Resend.md)
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

type EmailKind =
  | 'welcome'
  | 'license-expiring'
  | 'storage-warning'
  | 'event-published'
  | 'admin-invite'
  | 'desktop-token-expiring'
  | 'desktop-token-expiring-30'
  | 'desktop-token-expiring-14'
  | 'desktop-token-expiring-7';

interface EmailRequestBody {
  tenant_id: string | null;
  kind: EmailKind;
  recipient: string;
  subject?: string;
  data: Record<string, unknown>;
  idempotency_key: string;
  reply_to?: string;
}

const KIND_DEFAULTS: Record<EmailKind, { subjectIt: string; subjectEn: string }> = {
  welcome: {
    subjectIt: 'Benvenuto su Live SLIDE CENTER',
    subjectEn: 'Welcome to Live SLIDE CENTER',
  },
  'license-expiring': {
    subjectIt: 'La tua licenza Live SLIDE CENTER sta per scadere',
    subjectEn: 'Your Live SLIDE CENTER license is expiring soon',
  },
  'storage-warning': {
    subjectIt: 'Spazio di archiviazione quasi esaurito',
    subjectEn: 'Storage quota almost full',
  },
  'event-published': {
    subjectIt: 'Evento pubblicato con successo',
    subjectEn: 'Event published successfully',
  },
  'admin-invite': {
    subjectIt: 'Sei stato invitato come amministratore su Live SLIDE CENTER',
    subjectEn: 'You have been invited as administrator on Live SLIDE CENTER',
  },
  'desktop-token-expiring': {
    subjectIt: 'Token desktop in scadenza - Rinnovo automatico richiesto',
    subjectEn: 'Desktop token expiring - Automatic renewal required',
  },
  'desktop-token-expiring-30': {
    subjectIt: 'Token desktop in scadenza tra 30 giorni',
    subjectEn: 'Desktop token expires in 30 days',
  },
  'desktop-token-expiring-14': {
    subjectIt: 'Token desktop in scadenza tra 14 giorni',
    subjectEn: 'Desktop token expires in 14 days',
  },
  'desktop-token-expiring-7': {
    subjectIt: 'Token desktop in scadenza tra 7 giorni - Azione consigliata',
    subjectEn: 'Desktop token expires in 7 days - Action recommended',
  },
};

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // Auth interna: header secret obbligatorio.
  const internalSecret = Deno.env.get('EMAIL_SEND_INTERNAL_SECRET');
  if (!internalSecret) {
    return json({ error: 'env_misconfigured', detail: 'EMAIL_SEND_INTERNAL_SECRET' }, 500);
  }
  const provided = req.headers.get('x-internal-secret');
  if (!provided || !timingSafeEqual(provided, internalSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const resendFrom = Deno.env.get('RESEND_FROM_EMAIL');
  if (!resendApiKey || !resendFrom) {
    return json({ error: 'env_misconfigured', detail: 'RESEND_API_KEY|RESEND_FROM_EMAIL' }, 500);
  }

  let body: EmailRequestBody;
  try {
    body = await req.json() as EmailRequestBody;
  } catch {
    return json({ error: 'invalid_payload' }, 422);
  }

  if (!body.kind || !KIND_DEFAULTS[body.kind]) {
    return json({ error: 'unknown_kind' }, 422);
  }
  if (!body.recipient || !body.recipient.includes('@')) {
    return json({ error: 'invalid_recipient' }, 422);
  }
  if (!body.idempotency_key || body.idempotency_key.length < 8) {
    return json({ error: 'invalid_idempotency_key' }, 422);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) {
    return json({ error: 'env_misconfigured', detail: 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRole);

  // Idempotenza: controlla se gia' loggato come 'sent' con la stessa key.
  const { data: existing } = await admin
    .from('email_log')
    .select('id, status')
    .eq('idempotency_key', body.idempotency_key)
    .limit(1)
    .maybeSingle();

  if (existing && existing.status === 'sent') {
    return json({ skipped: true, log_id: existing.id });
  }

  // Render template.
  const language = (body.data?.['language'] as string | undefined) ?? 'it';
  const lang = language.startsWith('en') ? 'en' : 'it';
  const subject = body.subject ?? (lang === 'en' ? KIND_DEFAULTS[body.kind].subjectEn : KIND_DEFAULTS[body.kind].subjectIt);
  const html = renderTemplate(body.kind, lang, body.data);
  const text = htmlToPlainText(html);

  // Invia con Resend.
  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [body.recipient],
      subject,
      html,
      text,
      reply_to: body.reply_to,
      headers: {
        'X-Entity-Ref-ID': body.idempotency_key,
        'X-Tenant-ID': body.tenant_id ?? 'system',
      },
    }),
  });

  if (!resendResp.ok) {
    const detail = await resendResp.text();
    // Log failure per debug super-admin.
    await admin.rpc('log_email_sent', {
      p_tenant_id: body.tenant_id,
      p_kind: body.kind,
      p_recipient: body.recipient,
      p_idempotency_key: body.idempotency_key,
      p_status: 'failed',
      p_error_message: `resend_${resendResp.status}: ${detail.slice(0, 300)}`,
      p_metadata: { language: lang, ...body.data },
    });
    return json({ error: 'resend_failed', status: resendResp.status, detail }, 502);
  }

  const resendJson = await resendResp.json() as { id?: string };
  const providerMessageId = resendJson?.id ?? null;

  const { data: logId } = await admin.rpc('log_email_sent', {
    p_tenant_id: body.tenant_id,
    p_kind: body.kind,
    p_recipient: body.recipient,
    p_idempotency_key: body.idempotency_key,
    p_status: 'sent',
    p_provider_message_id: providerMessageId,
    p_metadata: { language: lang, ...body.data },
  });

  return json({ sent: true, provider_message_id: providerMessageId, log_id: logId });
});

// ─── Template rendering (no deps, HTML inline) ─────────────────────────────────
function renderTemplate(kind: EmailKind, lang: 'it' | 'en', data: Record<string, unknown>): string {
  const baseStyle = `font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; color: #1a1f2e; line-height: 1.55;`;
  const buttonStyle = `display: inline-block; background: #5b8def; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;`;
  const footer = lang === 'en'
    ? `<p style="font-size: 12px; color: #6c7689; margin-top: 32px; border-top: 1px solid #e5e8ee; padding-top: 16px;">Live SLIDE CENTER · Live Software · live.software11@gmail.com</p>`
    : `<p style="font-size: 12px; color: #6c7689; margin-top: 32px; border-top: 1px solid #e5e8ee; padding-top: 16px;">Live SLIDE CENTER · Live Software · live.software11@gmail.com</p>`;

  const fullName = (data?.['full_name'] as string | undefined) ?? '';
  const tenantName = (data?.['tenant_name'] as string | undefined) ?? '';
  const appUrl = (data?.['app_url'] as string | undefined) ?? 'https://app.liveworksapp.com';

  if (kind === 'welcome') {
    if (lang === 'en') {
      return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Welcome aboard${fullName ? `, ${escapeHtml(fullName)}` : ''}!</h1>
  <p>You have just joined the workspace <strong>${escapeHtml(tenantName)}</strong> on Live SLIDE CENTER.</p>
  <p>Live SLIDE CENTER is the operations centre for live conferences: speakers upload slides, the regia controls every screen, the rooms display in sync — even on intranet.</p>
  <p><a href="${escapeHtml(appUrl)}" style="${buttonStyle}">Open Live SLIDE CENTER</a></p>
  <p style="font-size: 14px; color: #6c7689;">Need help? Reply to this email or check the onboarding tour inside the app (Settings → Demo &amp; Onboarding).</p>
  ${footer}
</div>`;
    }
    return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Benvenuto a bordo${fullName ? `, ${escapeHtml(fullName)}` : ''}!</h1>
  <p>Hai appena fatto parte del workspace <strong>${escapeHtml(tenantName)}</strong> su Live SLIDE CENTER.</p>
  <p>Live SLIDE CENTER e' la centrale operativa per le conferenze live: i relatori caricano le slide, la regia controlla ogni schermo, le sale visualizzano in sincrono — anche in intranet.</p>
  <p><a href="${escapeHtml(appUrl)}" style="${buttonStyle}">Apri Live SLIDE CENTER</a></p>
  <p style="font-size: 14px; color: #6c7689;">Hai bisogno di aiuto? Rispondi a questa email o consulta il tour interattivo dentro l'app (Impostazioni → Demo &amp; Onboarding).</p>
  ${footer}
</div>`;
  }

  if (kind === 'license-expiring') {
    const days = (data?.['days_remaining'] as number | undefined) ?? 0;
    const expiresIso = (data?.['expires_at_iso'] as string | undefined) ?? '';
    const expiresLabel = expiresIso ? new Date(expiresIso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT') : '';
    const billingUrl = (data?.['billing_url'] as string | undefined) ?? `${appUrl}/billing`;

    if (lang === 'en') {
      return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Your license expires in ${days} day${days === 1 ? '' : 's'}</h1>
  <p>Hi${fullName ? ` ${escapeHtml(fullName)}` : ''},</p>
  <p>Your Live SLIDE CENTER subscription for <strong>${escapeHtml(tenantName)}</strong> will expire on <strong>${escapeHtml(expiresLabel)}</strong>.</p>
  <p>To avoid service interruption (workspace will be suspended automatically), please renew before the expiry date.</p>
  <p><a href="${escapeHtml(billingUrl)}" style="${buttonStyle}">Renew now</a></p>
  <p style="font-size: 14px; color: #6c7689;">Already renewed? You can ignore this email — sync may take a few minutes.</p>
  ${footer}
</div>`;
    }
    return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">La tua licenza scade tra ${days} giorn${days === 1 ? 'o' : 'i'}</h1>
  <p>Ciao${fullName ? ` ${escapeHtml(fullName)}` : ''},</p>
  <p>L'abbonamento Live SLIDE CENTER per <strong>${escapeHtml(tenantName)}</strong> scade il <strong>${escapeHtml(expiresLabel)}</strong>.</p>
  <p>Per evitare l'interruzione del servizio (il workspace verra' sospeso automaticamente), rinnova prima della data di scadenza.</p>
  <p><a href="${escapeHtml(billingUrl)}" style="${buttonStyle}">Rinnova ora</a></p>
  <p style="font-size: 14px; color: #6c7689;">Hai gia' rinnovato? Puoi ignorare questa email — la sincronizzazione puo' richiedere qualche minuto.</p>
  ${footer}
</div>`;
  }

  if (kind === 'storage-warning') {
    const percent = (data?.['percent'] as number | undefined) ?? 0;
    const usedMb = (data?.['used_mb'] as number | undefined) ?? 0;
    const limitMb = (data?.['limit_mb'] as number | undefined) ?? 0;
    const billingUrl = (data?.['billing_url'] as string | undefined) ?? `${appUrl}/billing`;
    const isCritical = percent >= 95;

    if (lang === 'en') {
      return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">${isCritical ? 'Storage almost full' : 'Storage usage warning'}</h1>
  <p>Workspace <strong>${escapeHtml(tenantName)}</strong> is using <strong>${percent}%</strong> of its storage quota (${usedMb} MB / ${limitMb} MB).</p>
  <p>${isCritical
          ? 'New uploads will be rejected when you reach 100%. Free up space or upgrade your plan.'
          : 'Consider upgrading your plan or removing old presentation versions before reaching 100%.'}</p>
  <p><a href="${escapeHtml(billingUrl)}" style="${buttonStyle}">Manage plan</a></p>
  ${footer}
</div>`;
    }
    return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">${isCritical ? 'Spazio quasi esaurito' : 'Avviso spazio di archiviazione'}</h1>
  <p>Il workspace <strong>${escapeHtml(tenantName)}</strong> sta usando <strong>${percent}%</strong> della quota storage (${usedMb} MB / ${limitMb} MB).</p>
  <p>${isCritical
        ? 'I nuovi upload verranno rifiutati al 100%. Libera spazio o aggiorna il piano.'
        : 'Considera un upgrade del piano o rimuovi vecchie versioni di presentazioni prima di raggiungere il 100%.'}</p>
  <p><a href="${escapeHtml(billingUrl)}" style="${buttonStyle}">Gestisci piano</a></p>
  ${footer}
</div>`;
  }

  if (kind === 'event-published') {
    const eventName = (data?.['event_name'] as string | undefined) ?? '';
    const eventUrl = (data?.['event_url'] as string | undefined) ?? appUrl;

    if (lang === 'en') {
      return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Event published: ${escapeHtml(eventName)}</h1>
  <p>The event <strong>${escapeHtml(eventName)}</strong> for workspace <strong>${escapeHtml(tenantName)}</strong> is now live.</p>
  <p>Speakers can upload slides via the upload portal links, the regia can pair devices and start synchronisation.</p>
  <p><a href="${escapeHtml(eventUrl)}" style="${buttonStyle}">Open event</a></p>
  ${footer}
</div>`;
    }
    return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Evento pubblicato: ${escapeHtml(eventName)}</h1>
  <p>L'evento <strong>${escapeHtml(eventName)}</strong> per il workspace <strong>${escapeHtml(tenantName)}</strong> e' attivo.</p>
  <p>I relatori possono caricare le slide via i link upload portal, la regia puo' associare i dispositivi e avviare la sincronizzazione.</p>
  <p><a href="${escapeHtml(eventUrl)}" style="${buttonStyle}">Apri evento</a></p>
  ${footer}
</div>`;
  }

  if (kind === 'admin-invite') {
    const inviteUrl = (data?.['invite_url'] as string | undefined) ?? appUrl;
    const inviteExpiresIso = (data?.['invite_expires_at'] as string | undefined) ?? '';
    const expiresLabel = inviteExpiresIso
      ? new Date(inviteExpiresIso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT')
      : '';

    if (lang === 'en') {
      return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">You're invited to administer ${escapeHtml(tenantName) || 'a workspace'}</h1>
  <p>${fullName ? `Hi ${escapeHtml(fullName)}, ` : ''}you have been invited as <strong>administrator</strong> of the workspace <strong>${escapeHtml(tenantName)}</strong> on Live SLIDE CENTER.</p>
  <p>Live SLIDE CENTER is the operations centre for live conferences: speakers upload slides, the regia controls every screen, the rooms display in sync — even on intranet.</p>
  <p><a href="${escapeHtml(inviteUrl)}" style="${buttonStyle}">Accept the invitation</a></p>
  <p style="font-size: 13px; color: #6c7689;">${expiresLabel ? `This invitation expires on <strong>${escapeHtml(expiresLabel)}</strong>. ` : ''}If the button doesn't work, copy and paste this URL into your browser:<br><span style="word-break: break-all; color: #5b8def;">${escapeHtml(inviteUrl)}</span></p>
  <p style="font-size: 14px; color: #6c7689;">Didn't expect this email? You can safely ignore it — the invitation will expire on its own.</p>
  ${footer}
</div>`;
    }
    return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Sei invitato ad amministrare ${escapeHtml(tenantName) || 'un workspace'}</h1>
  <p>${fullName ? `Ciao ${escapeHtml(fullName)}, ` : ''}sei stato invitato come <strong>amministratore</strong> del workspace <strong>${escapeHtml(tenantName)}</strong> su Live SLIDE CENTER.</p>
  <p>Live SLIDE CENTER e' la centrale operativa per le conferenze live: i relatori caricano le slide, la regia controlla ogni schermo, le sale visualizzano in sincrono — anche in intranet.</p>
  <p><a href="${escapeHtml(inviteUrl)}" style="${buttonStyle}">Accetta l'invito</a></p>
  <p style="font-size: 13px; color: #6c7689;">${expiresLabel ? `Questo invito scade il <strong>${escapeHtml(expiresLabel)}</strong>. ` : ''}Se il bottone non funziona, copia e incolla questo URL nel browser:<br><span style="word-break: break-all; color: #5b8def;">${escapeHtml(inviteUrl)}</span></p>
  <p style="font-size: 14px; color: #6c7689;">Non ti aspettavi questa email? Puoi ignorarla — l'invito scadra' da solo.</p>
  ${footer}
</div>`;
  }

  if (
    kind === 'desktop-token-expiring' ||
    kind === 'desktop-token-expiring-30' ||
    kind === 'desktop-token-expiring-14' ||
    kind === 'desktop-token-expiring-7'
  ) {
    const days = (data?.['days_remaining'] as number | undefined) ?? 0;
    const deviceName = (data?.['device_name'] as string | undefined) ?? '';
    const expiresIso = (data?.['expires_at_iso'] as string | undefined) ?? '';
    const expiresLabel = expiresIso
      ? new Date(expiresIso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT')
      : '';
    const devicesUrl = (data?.['devices_url'] as string | undefined) ?? `${appUrl}/admin/desktop-devices`;

    if (lang === 'en') {
      return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Desktop token expires in ${days} day${days === 1 ? '' : 's'}</h1>
  <p>Hi${fullName ? ` ${escapeHtml(fullName)}` : ''},</p>
  <p>The pairing token for desktop device <strong>${escapeHtml(deviceName)}</strong> in workspace <strong>${escapeHtml(tenantName)}</strong> will expire on <strong>${escapeHtml(expiresLabel)}</strong>.</p>
  <p><strong>What happens automatically:</strong> the desktop client will renew the token by itself the next time it connects (rotation 7 days before expiry). Usually no action is required.</p>
  <p><strong>What to do if the device is offline or off-site:</strong></p>
  <ul style="padding-left: 20px;">
    <li>Open the device once and let it connect (auto-renewal)</li>
    <li>OR extend the token manually from the admin panel (+12 months)</li>
  </ul>
  <p><a href="${escapeHtml(devicesUrl)}" style="${buttonStyle}">Manage desktop devices</a></p>
  <p style="font-size: 14px; color: #6c7689;">If the token expires without renewal, the device will be temporarily blocked until a new bind from the admin panel.</p>
  ${footer}
</div>`;
    }
    return `<div style="${baseStyle}">
  <h1 style="font-size: 22px; margin-bottom: 8px;">Token desktop in scadenza tra ${days} giorn${days === 1 ? 'o' : 'i'}</h1>
  <p>Ciao${fullName ? ` ${escapeHtml(fullName)}` : ''},</p>
  <p>Il token di pairing del dispositivo desktop <strong>${escapeHtml(deviceName)}</strong> nel workspace <strong>${escapeHtml(tenantName)}</strong> scade il <strong>${escapeHtml(expiresLabel)}</strong>.</p>
  <p><strong>Cosa succede in automatico:</strong> il client desktop rinnova il token da solo alla prossima connessione (rotazione 7 giorni prima della scadenza). Di solito nessuna azione e' richiesta.</p>
  <p><strong>Cosa fare se il dispositivo e' offline o fuori sede:</strong></p>
  <ul style="padding-left: 20px;">
    <li>Apri il dispositivo una volta e lascialo connettere (rinnovo automatico)</li>
    <li>OPPURE estendi il token manualmente dal pannello admin (+12 mesi)</li>
  </ul>
  <p><a href="${escapeHtml(devicesUrl)}" style="${buttonStyle}">Gestisci dispositivi desktop</a></p>
  <p style="font-size: 14px; color: #6c7689;">Se il token scade senza rinnovo, il dispositivo verra' temporaneamente bloccato fino a un nuovo bind dal pannello admin.</p>
  ${footer}
</div>`;
  }

  return `<div style="${baseStyle}"><p>Notification from Live SLIDE CENTER.</p>${footer}</div>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<br\s*\/?>(\r\n|\n)?/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
