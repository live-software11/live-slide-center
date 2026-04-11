import { createClient } from 'jsr:@supabase/supabase-js@2';

export function getSupabaseClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');

  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

export async function getTenantId(req: Request): Promise<string> {
  const supabase = getSupabaseClient(req);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');

  const tenantId =
    (user.app_metadata?.tenant_id as string) ?? (user.user_metadata?.tenant_id as string);
  if (!tenantId) throw new Error('No tenant_id in JWT');

  return tenantId;
}
