import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type TenantRow = Database['public']['Tables']['tenants']['Row'];
export type UserRow = Database['public']['Tables']['users']['Row'];
export type ActivityRow = Database['public']['Tables']['activity_log']['Row'];
export type EventListRow = Pick<
  Database['public']['Tables']['events']['Row'],
  'id' | 'name' | 'start_date' | 'end_date' | 'status'
>;

export type TenantDetailBundle = {
  tenant: TenantRow;
  users: UserRow[];
  events: EventListRow[];
  activity: ActivityRow[];
};

export async function fetchTenantDetailBundle(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ data: TenantDetailBundle | null; error: string | null }> {
  const { data: tenant, error: te } = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle();
  if (te) return { data: null, error: te.message };
  if (!tenant) return { data: null, error: 'not_found' };

  const [usersRes, eventsRes, activityRes] = await Promise.all([
    supabase.from('users').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true }),
    supabase
      .from('events')
      .select('id, name, start_date, end_date, status')
      .eq('tenant_id', tenantId)
      .order('start_date', { ascending: false })
      .limit(50),
    supabase
      .from('activity_log')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (usersRes.error) return { data: null, error: usersRes.error.message };
  if (eventsRes.error) return { data: null, error: eventsRes.error.message };
  if (activityRes.error) return { data: null, error: activityRes.error.message };

  return {
    data: {
      tenant,
      users: usersRes.data ?? [],
      events: eventsRes.data ?? [],
      activity: activityRes.data ?? [],
    },
    error: null,
  };
}

export type PlatformAdminStats = {
  tenantCount: number;
  activeEventsCount: number;
  storageUsedTotalBytes: number;
};

export async function fetchPlatformAdminStats(
  supabase: SupabaseClient<Database>,
): Promise<{ data: PlatformAdminStats | null; error: string | null }> {
  const [tenantsRes, eventsRes] = await Promise.all([
    supabase.from('tenants').select('id, storage_used_bytes'),
    supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .in('status', ['setup', 'active']),
  ]);

  if (tenantsRes.error) return { data: null, error: tenantsRes.error.message };
  if (eventsRes.error) return { data: null, error: eventsRes.error.message };

  const rows = tenantsRes.data ?? [];
  const storageUsedTotalBytes = rows.reduce((acc, r) => acc + (r.storage_used_bytes ?? 0), 0);

  return {
    data: {
      tenantCount: rows.length,
      activeEventsCount: eventsRes.count ?? 0,
      storageUsedTotalBytes,
    },
    error: null,
  };
}

export async function fetchCrossTenantAudit(
  supabase: SupabaseClient<Database>,
  limit = 200,
): Promise<{ data: ActivityRow[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
}

export async function fetchTenantSuspended(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ suspended: boolean | null; error: string | null }> {
  const { data, error } = await supabase.from('tenants').select('suspended').eq('id', tenantId).maybeSingle();
  if (error) return { suspended: null, error: error.message };
  if (!data) return { suspended: null, error: 'not_found' };
  return { suspended: data.suspended, error: null };
}
