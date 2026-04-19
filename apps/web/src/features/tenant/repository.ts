import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type TenantQuotaRow = Pick<
  Database['public']['Tables']['tenants']['Row'],
  'id' | 'plan' | 'storage_used_bytes' | 'storage_limit_bytes' | 'max_events_per_month' | 'max_rooms_per_event'
>;

// BUGFIX 2026-04-19 (Sprint X-2): filtro esplicito su id=tenantId.
//
// WHY: la RLS `tenants_select` permette `is_super_admin() OR id = app_tenant_id()`.
// Per un utente normale la query senza filtro restituisce 1 sola riga (il proprio
// tenant, via RLS). Per un `super_admin` invece restituisce TUTTE le righe della
// tabella `tenants` -> `.maybeSingle()` esplode con PGRST116 "JSON object requested,
// multiple (or no) rows returned" (visibile in UI come "Impossibile caricare i
// limiti dell'abbonamento.").
//
// Fix: filtro esplicito `id = tenantId` che vale per entrambi i ruoli e rende la
// query deterministica indipendentemente dal contenuto del JWT.
export async function fetchTenantQuotaRow(supabase: SupabaseClient<Database>, tenantId: string) {
  return supabase
    .from('tenants')
    .select('id, plan, storage_used_bytes, storage_limit_bytes, max_events_per_month, max_rooms_per_event')
    .eq('id', tenantId)
    .maybeSingle();
}
