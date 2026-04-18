// Sprint D1 — Desktop bind claim (magic-link claim per PC desktop server).
//
// Pattern identico a `room-provision-claim` (Sprint U-4) ma per il bind di
// un PC desktop server invece di un PC sala. Differenze:
//   - Nessun event_id / room_id (il desktop server e' tenant-wide).
//   - Riceve `machine_fingerprint` opzionale per riconoscere re-bind dello
//     stesso PC fisico (idempotenza UNIQUE constraint).
//   - Risponde con `pair_token` plain UNA volta sola: il PC desktop lo salva
//     cifrato AES-256-GCM in `~/.slidecenter/license.enc`.
//
// Sicurezza:
//   - verify_jwt: false (l'app desktop NON ha token utente, ha solo il magic
//     link generato dall'admin nel cloud).
//   - Rate-limit per IP: 30 claim / 5 min (un desktop fa 1 claim e basta;
//     oltre = bot/probing).
//   - Token plain mai loggato; pair_token plain ritornato solo qui.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import {
  checkAndRecordEdgeRate,
  clientIpFromRequest,
  hashIp,
} from '../_shared/rate-limit.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const ip = clientIpFromRequest(req);
    const ipHash = await hashIp(ip);
    const rate = await checkAndRecordEdgeRate(supabaseAdmin, {
      ipHash,
      scope: 'desktop-bind-claim',
      maxPerWindow: 30,
      windowMinutes: 5,
    });
    if (rate && !rate.allowed) {
      return jsonRes({ error: 'rate_limited', retryAfterSec: 60 }, 429);
    }

    const body = (await req.json()) as {
      token?: string;
      pair_token?: string;
      device_name?: string;
      machine_fingerprint?: string;
      app_version?: string;
      os_version?: string;
    };

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const pairToken = typeof body.pair_token === 'string' ? body.pair_token.trim() : '';
    if (!token) return jsonRes({ error: 'missing_token' }, 400);
    if (!pairToken || pairToken.length < 24) {
      return jsonRes({ error: 'invalid_pair_token' }, 400);
    }

    const pairTokenHash = await sha256Hex(pairToken);

    const { data, error } = await supabaseAdmin.rpc('rpc_consume_desktop_provision_token', {
      p_token: token,
      p_pair_token_hash: pairTokenHash,
      p_device_name: typeof body.device_name === 'string' ? body.device_name.slice(0, 120) : null,
      p_machine_fingerprint:
        typeof body.machine_fingerprint === 'string' ? body.machine_fingerprint.slice(0, 128) : null,
      p_app_version: typeof body.app_version === 'string' ? body.app_version.slice(0, 32) : null,
      p_os_version: typeof body.os_version === 'string' ? body.os_version.slice(0, 64) : null,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      const errorCodeMap: Record<string, number> = {
        token_invalid: 404,
        token_revoked: 410,
        token_expired: 410,
        token_exhausted: 409,
        tenant_suspended: 403,
        license_expired: 403,
        pair_token_collision: 409,
        invalid_pair_token_hash: 400,
        missing_token: 400,
      };
      const code = errorCodeMap[msg] ?? 400;
      return jsonRes({ error: msg }, code);
    }

    if (!data || typeof data !== 'object') {
      return jsonRes({ error: 'unexpected_response' }, 500);
    }

    return jsonRes(
      {
        ...(data as Record<string, unknown>),
        pair_token: pairToken,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[desktop-bind-claim]', message);
    return jsonRes({ error: 'internal_error' }, 500);
  }
});

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
