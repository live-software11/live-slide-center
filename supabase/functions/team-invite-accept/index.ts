/**
 * team-invite-accept — Sprint 1 / Fase 14
 *
 * POST { action: 'validate', token: string }
 *   → { valid: true, email, role, tenant_name, expires_at } | { valid: false, error: string }
 *
 * POST { action: 'accept', token: string, password: string, full_name?: string }
 *   → { ok: true } | { error: string }
 *
 * verify_jwt = false (token nel body, nessun JWT tenant richiesto)
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json() as {
      action: 'validate' | 'accept';
      token: string;
      password?: string;
      full_name?: string;
    };

    const { action, token, password, full_name } = body;

    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      return json({ error: 'invalid_token' }, 400);
    }

    // ── Leggi invito ────────────────────────────────────────────────────────
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('team_invitations')
      .select('id, tenant_id, email, role, invite_token_expires_at, accepted_at, tenants(name)')
      .eq('invite_token', token.trim())
      .maybeSingle();

    if (inviteErr || !invite) {
      return json({ valid: false, error: 'not_found' }, 404);
    }

    if (invite.accepted_at) {
      return json({ valid: false, error: 'already_used' }, 410);
    }

    if (new Date(invite.invite_token_expires_at) < new Date()) {
      return json({ valid: false, error: 'expired' }, 410);
    }

    const tenantName = (invite.tenants as { name: string } | null)?.name ?? '';

    // ── Validate-only ───────────────────────────────────────────────────────
    if (action === 'validate') {
      return json({
        valid: true,
        email: invite.email,
        role: invite.role,
        tenant_name: tenantName,
        expires_at: invite.invite_token_expires_at,
      });
    }

    // ── Accept ──────────────────────────────────────────────────────────────
    if (action === 'accept') {
      if (!password || typeof password !== 'string' || password.length < 8) {
        return json({ error: 'password_too_short' }, 422);
      }

      // Crea utente Supabase Auth con app_metadata già impostato.
      // Il trigger handle_new_user vede tenant_id + role e NON crea un nuovo tenant.
      const { data: authUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: invite.email,
        password,
        email_confirm: true,
        app_metadata: {
          tenant_id: invite.tenant_id,
          role: invite.role,
        },
        user_metadata: {
          full_name: full_name?.trim() || invite.email.split('@')[0],
        },
      });

      if (createErr || !authUser.user) {
        const msg = createErr?.message ?? 'create_user_failed';
        // Email già in uso = utente esiste, errore comprensibile
        if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
          return json({ error: 'email_already_registered' }, 409);
        }
        return json({ error: msg }, 500);
      }

      // Marca invito come consumato
      const { error: acceptErr } = await supabaseAdmin
        .from('team_invitations')
        .update({
          accepted_at: new Date().toISOString(),
          accepted_by_user_id: authUser.user.id,
        })
        .eq('id', invite.id);

      if (acceptErr) {
        // L'utente è già stato creato — loghiamo l'errore ma non blocchiamo
        console.error('team-invite-accept: failed to mark invite as accepted', acceptErr.message);
      }

      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
