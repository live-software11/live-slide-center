// ════════════════════════════════════════════════════════════════════════════
// CORS shared helper — Audit-fix AU-04 (2026-04-18)
// ════════════════════════════════════════════════════════════════════════════
// Due profili CORS distinti:
//
//  1. PUBLIC ANON (default `corsHeaders` + `handleCors`):
//     `Access-Control-Allow-Origin: *`
//     Usato da Edge Functions invocate da:
//       - webhook esterni (Lemon Squeezy)
//       - device anonimi via fetch (PWA tablet remote-control, PC sala con
//         token in body ma senza JWT, codice di pairing iniziale, slide
//         validator chiamato dal client web ma senza enforcing dell'origin)
//     Per questi: token-in-body + RPC SECURITY DEFINER fanno il vero auth,
//     quindi `*` non aggiunge esposizione.
//
//  2. ADMIN ALLOWLIST (`adminCorsHeaders(req)` + `handleAdminCors(req)`):
//     `Access-Control-Allow-Origin: <origin se in whitelist, altrimenti vuoto>`
//     Usato da Edge Functions invocate solo dall'app web admin loggata
//     (email-send, gdpr-export, team-invite-accept, system-status,
//     licensing-sync, cleanup-expired-codes). La whitelist accetta:
//       - https://app.liveslidecenter.com  (production app)
//       - https://liveworksapp.com         (WordPress + checkout)
//       - https://www.liveworksapp.com     (variante)
//       - origini Vercel preview deployment (*.vercel.app del progetto)
//       - http://localhost:5173, http://localhost:4173 (dev e preview locali)
//
// Override via env `EDGE_CORS_ADMIN_ALLOWLIST` (CSV) per ambiente staging.
// ════════════════════════════════════════════════════════════════════════════

const COMMON_HEADERS_VALUE = 'authorization, x-client-info, apikey, content-type, x-internal-secret';
const COMMON_METHODS_VALUE = 'GET, POST, PUT, DELETE, OPTIONS';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': COMMON_HEADERS_VALUE,
  'Access-Control-Allow-Methods': COMMON_METHODS_VALUE,
};

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

// ── Admin allowlist ─────────────────────────────────────────────────────────
const DEFAULT_ADMIN_ALLOWLIST = [
  'https://app.liveslidecenter.com',
  'https://liveworksapp.com',
  'https://www.liveworksapp.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
];

// Pattern accettati (es. preview Vercel)
const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+-live-software11\.vercel\.app$/i;
const SLIDECENTER_VERCEL_RE = /^https:\/\/live-slide-center(-[a-z0-9-]+)?\.vercel\.app$/i;

function getAdminAllowlist(): string[] {
  const env = Deno.env.get('EDGE_CORS_ADMIN_ALLOWLIST');
  if (env && env.trim().length > 0) {
    return env.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ADMIN_ALLOWLIST;
}

function isAdminOriginAllowed(origin: string | null): origin is string {
  if (!origin) return false;
  const list = getAdminAllowlist();
  if (list.includes(origin)) return true;
  if (VERCEL_PREVIEW_RE.test(origin)) return true;
  if (SLIDECENTER_VERCEL_RE.test(origin)) return true;
  return false;
}

export function adminCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? req.headers.get('Origin');
  const allowedOrigin = isAdminOriginAllowed(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': COMMON_HEADERS_VALUE,
    'Access-Control-Allow-Methods': COMMON_METHODS_VALUE,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function handleAdminCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const headers = adminCorsHeaders(req);
    // Se origin non in allowlist ritorniamo 403 sul preflight (evita probing
    // anonimo cross-origin)
    if (!headers['Access-Control-Allow-Origin']) {
      return new Response('forbidden_origin', { status: 403 });
    }
    return new Response('ok', { headers });
  }
  return null;
}
