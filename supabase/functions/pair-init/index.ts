import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonRes({ error: 'missing_authorization' }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return jsonRes({ error: 'unauthorized' }, 401);
    const user = userData.user;

    const role = (user.app_metadata?.role as string | undefined) ?? null;
    const userTenantId =
      (user.app_metadata?.tenant_id as string | undefined) ??
      (user.user_metadata?.tenant_id as string | undefined) ??
      null;
    const isSuperAdmin = role === 'super_admin';

    if (!isSuperAdmin && !userTenantId) {
      return jsonRes({ error: 'no_tenant_in_jwt' }, 403);
    }

    const body = await req.json() as { event_id?: string; room_id?: string | null };
    const eventId = body.event_id;
    const roomId = body.room_id ?? null;

    if (!eventId || typeof eventId !== 'string') {
      return jsonRes({ error: 'event_id_required' }, 400);
    }

    // Per super_admin il tenant viene risolto dall'evento target; per gli utenti
    // tenant viene verificato che l'evento appartenga al loro tenant.
    const eventQuery = supabaseAdmin
      .from('events')
      .select('id, tenant_id')
      .eq('id', eventId);
    const { data: event } = isSuperAdmin
      ? await eventQuery.maybeSingle()
      : await eventQuery.eq('tenant_id', userTenantId!).maybeSingle();

    if (!event) {
      return jsonRes({ error: 'event_not_found' }, 404);
    }
    const tenantId = event.tenant_id as string;

    const digits = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10));
    const code = digits.join('');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await supabaseAdmin
      .from('pairing_codes')
      .insert({
        code,
        tenant_id: tenantId,
        event_id: eventId,
        room_id: roomId,
        generated_by_user_id: user.id,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('[pair-init] insert_failed', insertError.message);
      return jsonRes({ error: 'insert_failed' }, 500);
    }

    return jsonRes({ code, expires_at: expiresAt }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal_error';
    console.error('[pair-init] unhandled', message);
    return jsonRes({ error: 'internal_error' }, 500);
  }
});
