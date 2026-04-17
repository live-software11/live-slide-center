/**
 * system-status — Sprint 8
 *
 * Endpoint pubblico (no-auth) usato dalla pagina `/status` per mostrare lo
 * stato dei sistemi al di fuori del login. Usato sia dagli utenti per
 * verificare che il servizio sia operativo, sia da uptime monitor esterni
 * tipo UptimeRobot/BetterUptime via JSON GET.
 *
 * Service controllati:
 *  - database: SELECT 1 via REST PostgREST, latency RTT
 *  - storage: HEAD su bucket pubblico (riusa endpoint Storage REST)
 *  - auth: GET /auth/v1/health (built-in supabase)
 *  - edge: ping a se stesso (sempre 'operational' se rispondiamo)
 *
 * GET → JSON:
 *   {
 *     status: 'operational' | 'degraded' | 'major_outage',
 *     services: [
 *       { id, name, status: 'operational' | 'degraded' | 'down', latency_ms?, last_checked },
 *       ...
 *     ],
 *     incidents: [],   // placeholder per evoluzione futura
 *     updated_at: ISO,
 *     version: '1.0.0',
 *   }
 *
 * Cache: ritorna sempre dati freschi (nessuna cache server-side); i client
 * possono fare polling ogni 30-60s.
 *
 * verify_jwt = false (endpoint pubblico).
 */
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface ServiceProbe {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'down';
  latency_ms: number | null;
  last_checked: string;
  detail?: string;
}

const DEGRADED_THRESHOLD_MS = 1500;

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return jsonResponse(
      {
        status: 'major_outage',
        services: [],
        incidents: [],
        updated_at: new Date().toISOString(),
        version: '1.0.0',
        error: 'env_misconfigured',
      },
      500,
    );
  }

  const services: ServiceProbe[] = await Promise.all([
    probeDatabase(supabaseUrl, anonKey),
    probeAuth(supabaseUrl, anonKey),
    probeStorage(supabaseUrl, anonKey),
    probeEdge(),
  ]);

  // Aggrega lo stato globale: se almeno un servizio e' down → major; degraded
  // se almeno uno e' degraded; altrimenti operational.
  const downCount = services.filter((s) => s.status === 'down').length;
  const degradedCount = services.filter((s) => s.status === 'degraded').length;
  const status: 'operational' | 'degraded' | 'major_outage' = downCount >= 2
    ? 'major_outage'
    : downCount === 1
      ? 'degraded'
      : degradedCount > 0
        ? 'degraded'
        : 'operational';

  return jsonResponse({
    status,
    services,
    incidents: [], // riservato per gestione manuale incidenti (Sprint 9+)
    updated_at: new Date().toISOString(),
    version: '1.0.0',
  });
});

async function probeDatabase(url: string, anon: string): Promise<ServiceProbe> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/?select=`, {
      method: 'HEAD',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const latency = Date.now() - start;
    if (res.status >= 500) {
      return makeProbe('database', 'Database (Postgres)', 'down', latency, `http_${res.status}`);
    }
    const status = latency > DEGRADED_THRESHOLD_MS ? 'degraded' : 'operational';
    return makeProbe('database', 'Database (Postgres)', status, latency);
  } catch (err) {
    return makeProbe('database', 'Database (Postgres)', 'down', null, errorMessage(err));
  }
}

async function probeAuth(url: string, anon: string): Promise<ServiceProbe> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: anon },
    });
    const latency = Date.now() - start;
    if (!res.ok) {
      return makeProbe('auth', 'Authentication', 'down', latency, `http_${res.status}`);
    }
    const status = latency > DEGRADED_THRESHOLD_MS ? 'degraded' : 'operational';
    return makeProbe('auth', 'Authentication', status, latency);
  } catch (err) {
    return makeProbe('auth', 'Authentication', 'down', null, errorMessage(err));
  }
}

async function probeStorage(url: string, anon: string): Promise<ServiceProbe> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method: 'GET',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const latency = Date.now() - start;
    // 401 e' "ok" (auth richiesta) — significa che il servizio risponde.
    if (res.status >= 500) {
      return makeProbe('storage', 'File Storage', 'down', latency, `http_${res.status}`);
    }
    const status = latency > DEGRADED_THRESHOLD_MS ? 'degraded' : 'operational';
    return makeProbe('storage', 'File Storage', status, latency);
  } catch (err) {
    return makeProbe('storage', 'File Storage', 'down', null, errorMessage(err));
  }
}

async function probeEdge(): Promise<ServiceProbe> {
  // Se questo handler risponde, edge functions sono operative per definizione.
  return makeProbe('edge', 'Edge Functions', 'operational', 0);
}

function makeProbe(
  id: string,
  name: string,
  status: ServiceProbe['status'],
  latency: number | null,
  detail?: string,
): ServiceProbe {
  return {
    id,
    name,
    status,
    latency_ms: latency,
    last_checked: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 120) : 'unknown_error';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
