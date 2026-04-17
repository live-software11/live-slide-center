// Permette al PC sala (autenticato col solo device_token) di cambiare il proprio nome.
// Auth: hash del token vs paired_devices.pair_token_hash via RPC SECURITY DEFINER.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = (await req.json()) as { device_token?: string; device_name?: string };
    const token = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    const name = typeof body.device_name === 'string' ? body.device_name.trim() : '';

    if (!token) return jsonRes({ error: 'missing_device_token' }, 400);
    if (!name) return jsonRes({ error: 'missing_device_name' }, 400);
    if (name.length > 80) return jsonRes({ error: 'name_too_long' }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabaseAdmin.rpc('rename_paired_device_by_token', {
      p_token: token,
      p_name: name,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      const code = msg.includes('device_not_found') ? 404 : 400;
      return jsonRes({ error: msg }, code);
    }

    return jsonRes(data, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonRes({ error: message }, 500);
  }
});

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
