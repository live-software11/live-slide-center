// Sprint Z (post-field-test) Gap D — pair-revoke-self.
//
// Permette al PC stesso (PC sala PWA o PC desktop server Tauri) di
// auto-revocare il proprio pair_token cloud-side. Speculare a
// `desktop-license-verify` (Sprint D1):
//
//   Authorization: Bearer <pair_token>
//
// La edge calcola sha256(pair_token), chiama l'RPC service-role
// `rpc_revoke_pair_self(p_pair_token_hash)` che marca il device offline
// (paired_devices) o revoked (desktop_devices).
//
// Sicurezza:
//   - verify_jwt: false (i PC sala non hanno JWT utente, sono device).
//   - Auth = pair_token sha256-matchato in DB (stesso pattern di
//     desktop-license-verify).
//   - Rate-limit per IP: 30 / 5 min (un click "esci" raramente si ripete;
//     oltre = bot/probing).
//   - Token plain mai loggato: la edge fa solo digest e forward.

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
      scope: 'pair-revoke-self',
      maxPerWindow: 30,
      windowMinutes: 5,
    });
    if (rate && !rate.allowed) {
      return jsonRes({ error: 'rate_limited', retryAfterSec: 60 }, 429);
    }

    const pairTokenHash = await sha256Hex(pairToken);

    const { data, error } = await supabaseAdmin.rpc('rpc_revoke_pair_self', {
      p_pair_token_hash: pairTokenHash,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      const errorCodeMap: Record<string, number> = {
        invalid_pair_token_hash: 400,
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
    console.error('[pair-revoke-self]', message);
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
