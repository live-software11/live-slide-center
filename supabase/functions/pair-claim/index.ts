import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const PAIR_CLAIM_WINDOW_MS = 15 * 60_000; // 15 min — allineato a §8 guida
const PAIR_CLAIM_MAX_PER_WINDOW = 5;

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      code: string;
      device_name?: string;
      device_type?: string;
      browser?: string;
      user_agent?: string;
    };

    const { code, device_name, device_type, browser, user_agent } = body;

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

    const rawClientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ipHash = await sha256Hex(rawClientIp ?? 'unknown');
    const nowMs = Date.now();
    const windowStartIso = new Date(nowMs - PAIR_CLAIM_WINDOW_MS).toISOString();

    await supabaseAdmin
      .from('pair_claim_rate_events')
      .delete()
      .lt('created_at', new Date(nowMs - 2 * PAIR_CLAIM_WINDOW_MS).toISOString());

    const { count, error: countError } = await supabaseAdmin
      .from('pair_claim_rate_events')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', windowStartIso);

    if (countError) {
      return new Response(JSON.stringify({ error: 'rate_limit_check_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if ((count ?? 0) >= PAIR_CLAIM_MAX_PER_WINDOW) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: rateInsertError } = await supabaseAdmin
      .from('pair_claim_rate_events')
      .insert({ ip_hash: ipHash });

    if (rateInsertError) {
      return new Response(JSON.stringify({ error: rateInsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();

    const { data: pairingCode } = await supabaseAdmin
      .from('pairing_codes')
      .select('*')
      .eq('code', code)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .maybeSingle();

    if (!pairingCode) {
      return new Response(
        JSON.stringify({ error: 'code_invalid_or_expired' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const deviceToken = crypto.randomUUID();
    const tokenHash = await sha256Hex(deviceToken);

    const resolvedDeviceName = device_name?.trim() || `PC-${code}`;

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('paired_devices')
      .insert({
        tenant_id: pairingCode.tenant_id,
        event_id: pairingCode.event_id,
        room_id: pairingCode.room_id ?? null,
        device_name: resolvedDeviceName,
        device_type: device_type ?? null,
        browser: browser ?? null,
        user_agent: user_agent ?? null,
        pair_token_hash: tokenHash,
        last_ip: rawClientIp,
        last_seen_at: now,
        status: 'online',
        paired_by_user_id: pairingCode.generated_by_user_id ?? null,
      })
      .select('id, event_id, room_id')
      .single();

    if (deviceError || !device) {
      return new Response(JSON.stringify({ error: deviceError?.message ?? 'device_insert_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabaseAdmin
      .from('pairing_codes')
      .update({
        consumed_at: now,
        consumed_by_device_id: device.id,
      })
      .eq('code', code);

    return new Response(
      JSON.stringify({
        device_token: deviceToken,
        device_id: device.id,
        event_id: device.event_id,
        room_id: device.room_id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
