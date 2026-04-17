import type { SupabaseClient } from '@supabase/supabase-js';

export type SeedDemoResult = {
  event_id: string;
  rooms?: number;
  sessions?: number;
  speakers?: number;
  presentations?: number;
  created: boolean;
  message?: string;
};

export type ClearDemoResult = {
  deleted_events: number;
};

export type TenantOnboardingRow = {
  onboarded_at: string | null;
  name: string;
};

/** Legge stato onboarding del tenant del JWT (hook a singola riga). */
export async function fetchTenantOnboardingRow(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantOnboardingRow> {
  const { data, error } = await supabase
    .from('tenants')
    .select('onboarded_at,name')
    .eq('id', tenantId)
    .limit(1)
    .single();
  if (error) throw error;
  if (!data) throw new Error('tenant_row_missing');
  return { onboarded_at: data.onboarded_at, name: data.name };
}

/** Chiude wizard onboarding (mark_tenant_onboarded RPC, admin-only). */
export async function markTenantOnboarded(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc('mark_tenant_onboarded');
  if (error) throw error;
  return data as string;
}

/** Riapre wizard onboarding (reset_tenant_onboarding RPC, admin-only). */
export async function resetTenantOnboarding(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc('reset_tenant_onboarding');
  if (error) throw error;
}

/** Genera dati demo (seed_demo_data RPC, admin/coordinator). */
export async function seedDemoData(supabase: SupabaseClient): Promise<SeedDemoResult> {
  const { data, error } = await supabase.rpc('seed_demo_data');
  if (error) throw error;
  return data as SeedDemoResult;
}

/** Cancella dati demo (clear_demo_data RPC, admin-only). */
export async function clearDemoData(supabase: SupabaseClient): Promise<ClearDemoResult> {
  const { data, error } = await supabase.rpc('clear_demo_data');
  if (error) throw error;
  return data as ClearDemoResult;
}
