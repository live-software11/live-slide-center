import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getTenantId } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const tenantId = await getTenantId(req);

    const body = await req.json() as { event_id: string; room_id?: string | null };
    const { event_id: eventId, room_id: roomId } = body;

    if (!eventId || typeof eventId !== 'string') {
      return new Response(JSON.stringify({ error: 'event_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!event) {
      return new Response(JSON.stringify({ error: 'event_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const digits = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10));
    const code = digits.join('');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const authHeader = req.headers.get('Authorization')!;
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabaseUser.auth.getUser();

    const { error: insertError } = await supabaseAdmin
      .from('pairing_codes')
      .insert({
        code,
        tenant_id: tenantId,
        event_id: eventId,
        room_id: roomId ?? null,
        generated_by_user_id: user?.id ?? null,
        expires_at: expiresAt,
      });

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ code, expires_at: expiresAt }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message === 'Unauthorized' || message === 'Missing Authorization header' ? 401
      : message === 'No tenant_id in JWT' ? 403
        : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
