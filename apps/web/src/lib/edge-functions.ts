import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * Modulo condiviso per chiamate alle Edge Functions Supabase con auth utente.
 *
 * Estratto da `features/devices/repository.ts` durante Sprint T-3-A per evitare
 * duplicazione in feature multiple (devices, presentations, ecc.). Comportamento
 * IDENTICO alla versione precedente: zero refactor di logica, solo dedup.
 *
 * Pattern di gestione errori condiviso:
 *   - 401  → EdgeFunctionAuthError (la UI puo' triggerare logout o refresh)
 *   - 404  → EdgeFunctionMissingError (la function non e' deployata)
 *   - 5xx  → Error generico (la UI mostra "riprova")
 */

export class EdgeFunctionAuthError extends Error {
  constructor(message = 'auth_session_expired') {
    super(message);
    this.name = 'EdgeFunctionAuthError';
  }
}

export class EdgeFunctionMissingError extends Error {
  constructor(name: string) {
    super(`function_not_deployed:${name}`);
    this.name = 'EdgeFunctionMissingError';
  }
}

/**
 * Garantisce che la session abbia un access_token valido al momento dell invoke.
 * Se mancano <60s alla scadenza chiama `refreshSession` proattivamente.
 */
export async function ensureFreshAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new EdgeFunctionAuthError(error.message);
  const session = data.session;
  if (!session) throw new EdgeFunctionAuthError('no_session');

  const expiresAt = (session.expires_at ?? 0) * 1000;
  const skewMs = 60_000;
  if (expiresAt - Date.now() < skewMs) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      throw new EdgeFunctionAuthError(refreshError?.message ?? 'refresh_failed');
    }
    return refreshed.session.access_token;
  }
  return session.access_token;
}

export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  authRequired = true,
): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!anonKey) throw new Error('missing_anon_key');

  let bearer = anonKey;
  if (authRequired) bearer = await ensureFreshAccessToken();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EdgeFunctionAuthError(err.error ?? 'unauthorized');
  }
  if (res.status === 404) {
    throw new EdgeFunctionMissingError(name);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
    throw new Error(err?.error ?? `edge_function_${name}_${res.status}`);
  }
  return res.json() as Promise<T>;
}
