import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type TenantQuotaRow = Pick<
  Database['public']['Tables']['tenants']['Row'],
  'id' | 'plan' | 'storage_used_bytes' | 'storage_limit_bytes' | 'max_events_per_month' | 'max_rooms_per_event'
>;

export async function fetchTenantQuotaRow(supabase: SupabaseClient<Database>) {
  return supabase
    .from('tenants')
    .select('id, plan, storage_used_bytes, storage_limit_bytes, max_events_per_month, max_rooms_per_event')
    .maybeSingle();
}
