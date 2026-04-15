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

    const body = await req.json() as { code: string };
    const { code } = body;

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ error: 'invalid_code_format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = new Date().toISOString();

    const { data: pairingCode } = await supabaseAdmin
      .from('pairing_codes')
      .select('code, consumed_at, consumed_by_device_id, expires_at, tenant_id')
      .eq('code', code)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!pairingCode) {
      return new Response(JSON.stringify({ error: 'code_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (pairingCode.expires_at < now && !pairingCode.consumed_at) {
      return new Response(
        JSON.stringify({ status: 'expired' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (pairingCode.consumed_at) {
      const deviceId = pairingCode.consumed_by_device_id;
      let deviceName: string | null = null;

      if (deviceId) {
        const { data: device } = await supabaseAdmin
          .from('paired_devices')
          .select('device_name')
          .eq('id', deviceId)
          .maybeSingle();
        deviceName = device?.device_name ?? null;
      }

      return new Response(
        JSON.stringify({ status: 'consumed', device_id: deviceId, device_name: deviceName }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ status: 'pending' }),
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
