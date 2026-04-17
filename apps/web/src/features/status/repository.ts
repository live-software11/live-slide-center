/**
 * Sprint 8 — repository per la pagina pubblica /status.
 *
 * Chiama l'Edge Function `system-status` (no-auth) e tipizza la risposta.
 * NON usa il client Supabase autenticato perche' la pagina e' accessibile
 * senza login.
 */
export interface ServiceStatus {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'down';
  latency_ms: number | null;
  last_checked: string;
  detail?: string;
}

export interface SystemStatusResponse {
  status: 'operational' | 'degraded' | 'major_outage';
  services: ServiceStatus[];
  incidents: unknown[];
  updated_at: string;
  version: string;
  error?: string;
}

export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL non configurato');
  }

  const url = `${supabaseUrl}/functions/v1/system-status`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
    },
  });

  if (!res.ok) {
    throw new Error(`system-status returned ${res.status}`);
  }

  return res.json() as Promise<SystemStatusResponse>;
}
