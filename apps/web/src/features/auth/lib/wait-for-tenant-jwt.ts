import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { getTenantIdFromUser } from '@/lib/session-tenant';

export type WaitForTenantJwtCode = 'refresh_failed' | 'tenant_timeout';

/**
 * Dopo signup il trigger Postgres aggiorna `app_metadata.tenant_id`: serve JWT aggiornato.
 * Combina `refreshSession` + `getUser()` (claims validati lato Auth) con retry per race trigger/refresh.
 */
export async function waitForTenantIdAfterSignup(
  supabase: SupabaseClient<Database>,
  opts?: { maxAttempts?: number; delayMs?: number },
): Promise<{ ok: true } | { ok: false; code: WaitForTenantJwtCode }> {
  const maxAttempts = opts?.maxAttempts ?? 12;
  const delayMs = opts?.delayMs ?? 280;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      return { ok: false, code: 'refresh_failed' };
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      return { ok: false, code: 'refresh_failed' };
    }
    if (getTenantIdFromUser(userData.user)) {
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, code: 'tenant_timeout' };
}
