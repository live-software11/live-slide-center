import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient, User } from 'jsr:@supabase/supabase-js@2';

/**
 * Estrae e valida il JWT dall'header Authorization usando il pattern raccomandato
 * Supabase per Edge Functions: ammin client + getUser(jwt) esplicito.
 *
 * Il pattern alternativo (anon client con header globale + getUser() senza arg)
 * e' fragile su Deno e puo' restituire user=null anche con session valida.
 */
export function extractJwt(req: Request): string {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');
  if (!authHeader.toLowerCase().startsWith('bearer ')) throw new Error('Unauthorized');
  const jwt = authHeader.slice(7).trim();
  if (!jwt || jwt.split('.').length !== 3) throw new Error('Unauthorized');
  return jwt;
}

let cachedAdmin: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedAdmin;
}

/**
 * Client utente che rispetta RLS (per query lette/scritte come l'utente stesso).
 * NON usare questo client per validare l'identita': usare invece getAuthenticatedUser().
 */
export function getSupabaseClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');

  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
}

/**
 * Valida il JWT e restituisce l'utente. Usa il client admin (service_role)
 * con getUser(jwt) esplicito - pattern stabile su Deno Edge Functions.
 */
export async function getAuthenticatedUser(req: Request): Promise<User> {
  const jwt = extractJwt(req);
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) throw new Error('Unauthorized');
  return data.user;
}

export async function getTenantId(req: Request): Promise<string> {
  const user = await getAuthenticatedUser(req);
  const tenantId =
    (user.app_metadata?.tenant_id as string | undefined) ??
    (user.user_metadata?.tenant_id as string | undefined);
  if (!tenantId) throw new Error('No tenant_id in JWT');
  return tenantId;
}
