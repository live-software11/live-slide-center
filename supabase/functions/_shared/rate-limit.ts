// ════════════════════════════════════════════════════════════════════════════
// Rate-limit shared helper — Audit-fix AU-05 (2026-04-18)
// ════════════════════════════════════════════════════════════════════════════
// Wrapper minimale sulla RPC SECURITY DEFINER `check_and_record_edge_rate`.
// Restituisce { allowed, count, limit, windowMinutes } o null se la RPC fallisce
// (in cui caso l'Edge Function dovrebbe degradare a "permetti" per evitare
// di bloccare il servizio in caso di problemi DB).
//
// USO:
//   const rate = await checkAndRecordEdgeRate(supabaseAdmin, {
//     ipHash: hashedIp,
//     scope: 'room-device-upload-init',
//     maxPerWindow: 30,
//     windowMinutes: 5,
//   });
//   if (rate && !rate.allowed) {
//     return jsonRes({ error: 'rate_limited' }, 429);
//   }
//
// SCOPE convenzioni (1 per Edge Function rate-limited):
//   - 'pair-claim'                  → gestito storicamente da pair_claim_rate_events
//   - 'room-device-upload-init'     → 30 req / 5 min / IP
//   - 'remote-control-dispatch'     → 120 req / 1 min / IP (perche' tablet
//                                     genera rapidamente next/prev/goto)
//
// IP HASH: usa SHA-256(ip + EDGE_FN_RATE_SALT). Fallback su SHA-256 dell'IP solo.
// ════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface RateLimitInput {
  ipHash: string;
  scope: string;
  maxPerWindow: number;
  windowMinutes: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  windowMinutes: number;
}

export async function checkAndRecordEdgeRate(
  supabaseAdmin: SupabaseClient,
  input: RateLimitInput,
): Promise<RateLimitResult | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('check_and_record_edge_rate', {
      p_ip_hash: input.ipHash,
      p_scope: input.scope,
      p_max_per_window: input.maxPerWindow,
      p_window_minutes: input.windowMinutes,
    });
    if (error) {
      console.warn('[rate-limit] rpc error', input.scope, error.message);
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    return {
      allowed: Boolean(obj.allowed),
      count: typeof obj.count === 'number' ? obj.count : 0,
      limit: typeof obj.limit === 'number' ? obj.limit : input.maxPerWindow,
      windowMinutes:
        typeof obj.window_minutes === 'number' ? obj.window_minutes : input.windowMinutes,
    };
  } catch (err) {
    console.warn(
      '[rate-limit] unexpected',
      input.scope,
      err instanceof Error ? err.message : 'unknown',
    );
    return null;
  }
}

/** Estrae IP client da headers (Cloudflare/Vercel/Supabase Edge). */
export function clientIpFromRequest(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/** Hash SHA-256 dell'IP + salt opzionale (env `EDGE_FN_RATE_SALT`). */
export async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get('EDGE_FN_RATE_SALT') ?? 'live-slide-center-default-salt';
  const enc = new TextEncoder();
  const data = enc.encode(`${ip}:${salt}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
