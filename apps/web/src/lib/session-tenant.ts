import type { Session } from '@supabase/supabase-js';

/** `tenant_id` nel JWT (signup trigger + refresh session). */
export function getTenantIdFromSession(session: Session | null): string | null {
  if (!session?.user) return null;
  const raw = session.user.app_metadata?.tenant_id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}
