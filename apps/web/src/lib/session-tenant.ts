import type { Session, User } from '@supabase/supabase-js';

function tenantIdFromAppMetadata(user: User | null | undefined): string | null {
  if (!user) return null;
  const raw = user.app_metadata?.tenant_id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

/** `tenant_id` in JWT `app_metadata` (dopo trigger signup + refresh). Usare anche dopo `getUser()`. */
export function getTenantIdFromUser(user: User | null | undefined): string | null {
  return tenantIdFromAppMetadata(user ?? null);
}

/** `tenant_id` nel JWT (signup trigger + refresh session). */
export function getTenantIdFromSession(session: Session | null): string | null {
  return tenantIdFromAppMetadata(session?.user);
}
