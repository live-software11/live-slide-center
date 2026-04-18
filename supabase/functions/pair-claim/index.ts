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
      // Audit-fix 2026-04-18: no leak DB error to client.
      console.error('[pair-claim] rate insert error', rateInsertError.message);
      return new Response(JSON.stringify({ error: 'rate_limit_check_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit-fix 2026-04-18: claim atomico via RPC SECURITY DEFINER per
    // chiudere la race TOCTOU (prima: SELECT + INSERT + UPDATE in 3 step
    // permetteva due richieste parallele di consumare lo stesso codice).
    const deviceToken = crypto.randomUUID();
    const tokenHash = await sha256Hex(deviceToken);
    const resolvedDeviceName = device_name?.trim() || `PC-${code}`;

    const { data: claimData, error: claimError } = await supabaseAdmin.rpc(
      'claim_pairing_code_atomic',
      {
        p_code: code,
        p_token_hash: tokenHash,
        p_device_name: resolvedDeviceName,
        p_device_type: device_type ?? null,
        p_browser: browser ?? null,
        p_user_agent: user_agent ?? null,
        p_last_ip: rawClientIp,
      },
    );

    if (claimError) {
      const msg = claimError.message ?? '';
      console.error('[pair-claim] claim error', msg);
      if (msg.includes('code_invalid_or_expired')) {
        return new Response(JSON.stringify({ error: 'code_invalid_or_expired' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('invalid_code_format') || msg.includes('invalid_token_hash')) {
        return new Response(JSON.stringify({ error: 'invalid_input' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'pair_claim_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const claim = claimData as {
      device_id: string;
      tenant_id: string;
      event_id: string;
      room_id: string | null;
    };

    return new Response(
      JSON.stringify({
        device_token: deviceToken,
        device_id: claim.device_id,
        event_id: claim.event_id,
        room_id: claim.room_id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    // Audit-fix 2026-04-18: log only, no leak to client.
    console.error('[pair-claim] unhandled', message);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
