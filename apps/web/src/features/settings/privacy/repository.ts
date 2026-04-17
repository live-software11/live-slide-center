import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type DataExportRow = Database['public']['Functions']['list_tenant_data_exports']['Returns'][number];

export interface GdprExportResult {
  export_id: string;
  download_url: string;
  expires_at: string;
  byte_size: number;
}

/**
 * Invoca Edge Function `gdpr-export` (richiede JWT admin).
 * L'Edge:
 *  1) chiama RPC create_tenant_data_export → record pending
 *  2) chiama RPC export_tenant_data → JSONB completo
 *  3) costruisce ZIP (tenant-data.json + manifest + CSV + README)
 *  4) upload su Storage `tenant-exports`
 *  5) firma URL 7 giorni e ritorna download_url
 */
export async function requestGdprExport(supabase: SupabaseClient<Database>): Promise<GdprExportResult> {
  const { data, error } = await supabase.functions.invoke<GdprExportResult>('gdpr-export', { body: {} });
  if (error) throw error;
  if (!data) throw new Error('Empty response from gdpr-export');
  return data;
}

/** RPC list_tenant_data_exports: ultimi 10 export del tenant (admin only). */
export async function listTenantDataExports(supabase: SupabaseClient<Database>): Promise<DataExportRow[]> {
  const { data, error } = await supabase.rpc('list_tenant_data_exports');
  if (error) throw error;
  return (data ?? []) as DataExportRow[];
}
