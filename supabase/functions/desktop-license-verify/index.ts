// Sprint D1 — Desktop license verify (heartbeat 1x/24h dal PC desktop).
//
// Il PC desktop server (Tauri 2) chiama questo endpoint con
//   Authorization: Bearer <pair_token>
// Il pair_token e' lo stesso ottenuto al bind via desktop-bind-claim, salvato
// cifrato AES-256-GCM in ~/.slidecenter/license.enc.
//
// Aggiorna last_verified_at + last_seen_at lato DB e ritorna lo stato licenza
// + il `grace_until` (now + 30gg) che il client salva per sapere fino a quando
// puo' restare offline senza perdere le funzioni cloud.
//
// Sicurezza:
//   - verify_jwt: false (il client e' un device, non un utente Supabase).
//   - Auth tramite Bearer pair_token sha256-matchato in DB.
//   - Rate-limit per IP: 60 / ora (heartbeat normale = 1/giorno + retry).

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

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const auth = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!m) {
      return jsonRes({ error: 'missing_bearer' }, 401);
    }
    const pairToken = m[1].trim();
    if (pairToken.length < 24) {
      return jsonRes({ error: 'invalid_bearer' }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const ip = clientIpFromRequest(req);
    const ipHash = await hashIp(ip);
    const rate = await checkAndRecordEdgeRate(supabaseAdmin, {
      ipHash,
      scope: 'desktop-license-verify',
      maxPerWindow: 60,
      windowMinutes: 60,
    });
    if (rate && !rate.allowed) {
      return jsonRes({ error: 'rate_limited', retryAfterSec: 60 }, 429);
    }

    const pairTokenHash = await sha256Hex(pairToken);

    let appVersion: string | null = null;
    if (req.method === 'POST') {
      try {
        const body = (await req.json()) as { app_version?: string };
        if (typeof body.app_version === 'string') {
          appVersion = body.app_version.slice(0, 32);
        }
      } catch {
        // body opzionale; ignora parse error
      }
    }

    const { data, error } = await supabaseAdmin.rpc('rpc_desktop_license_verify', {
      p_pair_token_hash: pairTokenHash,
      p_app_version: appVersion,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      const errorCodeMap: Record<string, number> = {
        invalid_pair_token_hash: 400,
        device_unknown: 401,
        device_revoked: 403,
        tenant_suspended: 403,
        license_expired: 403,
      };
      const code = errorCodeMap[msg] ?? 500;
      return jsonRes({ error: msg }, code);
    }

    if (!data || typeof data !== 'object') {
      return jsonRes({ error: 'unexpected_response' }, 500);
    }
    return jsonRes(data, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[desktop-license-verify]', message);
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
