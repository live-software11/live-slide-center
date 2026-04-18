/**
 * Sprint 8 — repository per `/audit` admin tenant.
 *
 * Wrapper sulla RPC `list_tenant_activity` (SECURITY DEFINER, admin-only).
 * Restituisce gia' `rows` tipizzate + metadata di paginazione.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export interface TenantActivityRow {
  id: string;
  created_at: string;
  actor: 'user' | 'speaker' | 'agent' | 'system';
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  event_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface TenantActivityFilters {
  from?: string | null;
  to?: string | null;
  action?: string | null;
  actorId?: string | null;
  entityType?: string | null;
}

export interface TenantActivityPage {
  rows: TenantActivityRow[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

interface RpcResponse {
  rows?: TenantActivityRow[];
  total?: number;
  has_more?: boolean;
  limit?: number;
  offset?: number;
}

export async function listTenantActivity(
  supabase: SupabaseClient<Database>,
  filters: TenantActivityFilters,
  page: { limit: number; offset: number },
): Promise<TenantActivityPage> {
  const { data, error } = await supabase.rpc('list_tenant_activity', {
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_action: filters.action ?? undefined,
    p_actor_id: filters.actorId ?? undefined,
    p_entity_type: filters.entityType ?? undefined,
    p_limit: page.limit,
    p_offset: page.offset,
  });

  if (error) {
    throw new Error(error.message);
  }

  const payload = (data ?? {}) as RpcResponse;
  return {
    rows: payload.rows ?? [],
    total: payload.total ?? 0,
    hasMore: payload.has_more ?? false,
    limit: payload.limit ?? page.limit,
    offset: payload.offset ?? page.offset,
  };
}
