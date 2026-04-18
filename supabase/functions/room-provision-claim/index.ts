// Sprint U-4 (UX V2.0) — "Magic link claim" per zero-friction PC sala.
//
// Flusso:
//   1. Admin in regia genera un magic-link via RPC
//      `rpc_admin_create_room_provision_token` → ottiene token plain (32 byte
//      base64url) + scadenza + max_uses.
//   2. Stampa il QR / condivide l'URL `/sala-magic/<token>` al PC sala.
//   3. Il PC sala apre l'URL → MagicProvisionView (apps/web) → genera
//      LOCALMENTE 32 byte random come `pair_token` (mai usciti dal device),
//      ne calcola lo sha256 e invia tutto QUI.
//   4. Questa Edge Function delega alla RPC SECURITY DEFINER
//      `rpc_consume_room_provision_token`, che:
//        - valida il magic-link (hash, scadenza, max_uses, revoked)
//        - crea atomicamente un nuovo `paired_devices` con il pair_token_hash
//          → il PC sala usera' d'ora in avanti il pair_token plain (non il
//          magic-link) per autenticarsi (`room-player-bootstrap` etc.).
//   5. Risposta 200 con { device_id, tenant_id, event_id, room_id, pair_token }.
//      Il PC sala salva pair_token in localStorage e prosegue come un device
//      paired normalmente.
//
// Sicurezza:
//   - Rate-limit per IP: max 30 claim / 5 min (un PC sala fa 1 claim e
//     basta; oltre = bot/probing).
//   - Token plain mai loggato.
//   - Pair-token plain ritornato UNA volta sola: il client deve metterlo
//     subito in localStorage, dopo non lo recuperera' piu'.
//   - In caso di errore la RPC alza eccezioni granulari (`token_invalid`,
//     `token_revoked`, `token_expired`, `token_exhausted`) → mappiamo a HTTP
//     codes distinti per UI dedicata.
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

    // Rate-limit per IP. Un magic-link viene consumato da un solo device,
    // tipicamente una volta. 30 tentativi / 5 minuti su singolo IP e' di
    // gran lunga oltre l'uso normale e protegge da brute-force di token.
    const ip = clientIpFromRequest(req);
    const ipHash = await hashIp(ip);
    const rate = await checkAndRecordEdgeRate(supabaseAdmin, {
      ipHash,
      scope: 'room-provision-claim',
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
      device_type?: string;
      browser?: string;
      user_agent?: string;
    };

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const pairToken = typeof body.pair_token === 'string' ? body.pair_token.trim() : '';
    if (!token) return jsonRes({ error: 'missing_token' }, 400);
    if (!pairToken || pairToken.length < 24) {
      return jsonRes({ error: 'invalid_pair_token' }, 400);
    }

    // Hash sha256 del pair_token. Lo facciamo SERVER-SIDE (web crypto) per
    // evitare di fidarci dello hash client-side e per uniformare l'algoritmo
    // (alcuni browser PWA potrebbero non avere SubtleCrypto disponibile in
    // alcuni contesti raros).
    const pairTokenHash = await sha256Hex(pairToken);

    const { data, error } = await supabaseAdmin.rpc('rpc_consume_room_provision_token', {
      p_token: token,
      p_pair_token_hash: pairTokenHash,
      p_device_name: typeof body.device_name === 'string' ? body.device_name.slice(0, 120) : null,
      p_device_type: typeof body.device_type === 'string' ? body.device_type.slice(0, 32) : null,
      p_browser: typeof body.browser === 'string' ? body.browser.slice(0, 64) : null,
      p_user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 256) : null,
      p_last_ip: ip === 'unknown' ? null : ip,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      const code =
        msg.includes('token_invalid') ? 404
        : msg.includes('token_revoked') ? 410   // Gone
        : msg.includes('token_expired') ? 410
        : msg.includes('token_exhausted') ? 409  // Conflict
        : msg.includes('invalid_pair_token_hash') ? 400
        : msg.includes('missing_token') ? 400
        : 400;
      return jsonRes({ error: msg }, code);
    }

    if (!data || typeof data !== 'object') {
      return jsonRes({ error: 'unexpected_response' }, 500);
    }

    // Il pair_token plain e' ESCLUSIVO del client: lo restituiamo qui per
    // permettere al PC sala di salvarselo in localStorage. Dopo questa
    // chiamata non lo conosceremo piu' (DB ha solo lo hash).
    return jsonRes(
      {
        ...(data as Record<string, unknown>),
        pair_token: pairToken,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[room-provision-claim]', message);
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
