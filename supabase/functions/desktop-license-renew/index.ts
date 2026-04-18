// Sprint SR (Security Review) — Desktop license renew (rotazione pair_token).
//
// Endpoint chiamato dal client Tauri quando il `pair_token_status` ricevuto in
// risposta a `desktop-license-verify` e' `expiring_soon` (≤7 giorni alla
// scadenza), oppure su richiesta manuale dell'utente dal banner.
//
// Sicurezza:
//   - verify_jwt: false (il client e' un device, non un utente Supabase).
//   - Auth tramite Bearer = vecchio pair_token (sha256-matchato in DB via
//     rpc_desktop_renew_token, SECURITY DEFINER service-role).
//   - Il NUOVO pair_token plain viene generato lato CLIENT (stesso pattern di
//     bind: 32 byte random base64url), il cloud non lo vede mai in chiaro,
//     riceve solo lo sha256 nel body. Questo riduce la superficie di attacco.
//   - Rate-limit per IP: 30 / ora. Il renew normale e' 1x/anno per device,
//     il margine e' per retry/manual flow durante il setup.
//
// Flow:
//   POST /desktop-license-renew
//     Authorization: Bearer <vecchio_pair_token_plain>
//     Body: { new_pair_token_hash: "<sha256 hex>" }
//   →
//     200 { ok, device_id, tenant_id, tenant_name, plan, expires_at,
//           pair_token_expires_at, pair_token_expires_in_days, pair_token_status }
//     401 { error: "missing_bearer" | "invalid_bearer" | "device_unknown" }
//     400 { error: "missing_new_pair_token_hash" | "invalid_new_pair_token_hash" }
//     403 { error: "device_revoked" | "tenant_suspended" | "license_expired" }
//     410 { error: "pair_token_renew_expired" }    ← richiede re-bind manuale
//     429 { error: "rate_limited" }
//     500 { error: "internal_error" }

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
    const oldPairToken = m[1].trim();
    if (oldPairToken.length < 24) {
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
      scope: 'desktop-license-renew',
      maxPerWindow: 30,
      windowMinutes: 60,
    });
    if (rate && !rate.allowed) {
      return jsonRes({ error: 'rate_limited', retryAfterSec: 60 }, 429);
    }

    let body: { new_pair_token_hash?: string };
    try {
      body = (await req.json()) as { new_pair_token_hash?: string };
    } catch {
      return jsonRes({ error: 'invalid_payload' }, 400);
    }

    const newPairTokenHash = (body.new_pair_token_hash ?? '').trim().toLowerCase();
    if (!newPairTokenHash) {
      return jsonRes({ error: 'missing_new_pair_token_hash' }, 400);
    }
    if (!/^[0-9a-f]{64}$/.test(newPairTokenHash)) {
      return jsonRes({ error: 'invalid_new_pair_token_hash' }, 400);
    }

    const oldPairTokenHash = await sha256Hex(oldPairToken);
    if (oldPairTokenHash === newPairTokenHash) {
      return jsonRes({ error: 'identical_pair_tokens' }, 400);
    }

    const { data, error } = await supabaseAdmin.rpc('rpc_desktop_renew_token', {
      p_old_pair_token_hash: oldPairTokenHash,
      p_new_pair_token_hash: newPairTokenHash,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      const errorCodeMap: Record<string, number> = {
        invalid_old_pair_token_hash: 400,
        invalid_new_pair_token_hash: 400,
        identical_pair_tokens: 400,
        device_unknown: 401,
        device_revoked: 403,
        tenant_suspended: 403,
        license_expired: 403,
        pair_token_renew_expired: 410,
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
    console.error('[desktop-license-renew]', message);
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
