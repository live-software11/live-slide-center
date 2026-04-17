import type { SupabaseClient } from '@supabase/supabase-js';

export type LicenseThreshold = 'none' | 'info' | 'warning' | 'critical' | 'expired';
export type StorageThreshold = 'none' | 'warning' | 'critical';

export interface LicenseSummary {
  expires_at: string | null;
  days_remaining: number | null;
  plan: string | null;
  suspended: boolean;
  threshold: LicenseThreshold;
  as_of: string;
}

export interface StorageSummary {
  used_bytes: number;
  limit_bytes: number;
  percent: number | null;
  threshold: StorageThreshold;
  as_of: string;
}

/** RPC tenant_license_summary — banner license expiry. */
export async function fetchLicenseSummary(supabase: SupabaseClient): Promise<LicenseSummary> {
  const { data, error } = await supabase.rpc('tenant_license_summary');
  if (error) throw error;
  return data as unknown as LicenseSummary;
}

/** RPC tenant_storage_summary — banner storage warning. */
export async function fetchStorageSummary(supabase: SupabaseClient): Promise<StorageSummary> {
  const { data, error } = await supabase.rpc('tenant_storage_summary');
  if (error) throw error;
  return data as unknown as StorageSummary;
}
