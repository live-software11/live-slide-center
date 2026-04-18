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

// ─────────────────────────────────────────────────────────────────────────────
// Sprint R-1 (G1): super-admin crea tenant + invito primo admin
// ─────────────────────────────────────────────────────────────────────────────

export type TenantPlan = Database['public']['Enums']['tenant_plan'];

export interface CreateTenantInput {
  name: string;
  slug: string;
  plan: TenantPlan;
  storageLimitBytes: number;
  maxEventsPerMonth: number;
  maxRoomsPerEvent: number;
  maxDevicesPerRoom: number;
  /** ISO 8601 string oppure null per nessuna scadenza (Enterprise perpetua). */
  expiresAt: string | null;
  /** Formato XXXX-XXXX-XXXX-XXXX, opzionale (collegamento a Live WORKS APP). */
  licenseKey: string | null;
  /** Email del primo admin del tenant; verra' invitato via team_invitations. */
  adminEmail: string;
}

export interface CreateTenantResult {
  tenantId: string;
  slug: string;
  inviteId: string;
  inviteToken: string;
  inviteUrl: string;
  inviteExpiresAt: string;
  adminEmail: string;
  licenseKey: string | null;
}

/** Mappa codici errore RPC → chiavi i18n. Stringhe sconosciute → 'unknown'. */
export const CREATE_TENANT_ERROR_KEYS: Record<string, string> = {
  forbidden_super_admin_only: 'admin.createTenant.errors.forbidden',
  invalid_name: 'admin.createTenant.errors.invalidName',
  invalid_slug: 'admin.createTenant.errors.invalidSlug',
  invalid_plan: 'admin.createTenant.errors.invalidPlan',
  invalid_storage_limit: 'admin.createTenant.errors.invalidStorage',
  invalid_max_events: 'admin.createTenant.errors.invalidMaxEvents',
  invalid_max_rooms: 'admin.createTenant.errors.invalidMaxRooms',
  invalid_max_devices: 'admin.createTenant.errors.invalidMaxDevices',
  invalid_email: 'admin.createTenant.errors.invalidEmail',
  invalid_license_key_format: 'admin.createTenant.errors.invalidLicenseFormat',
  slug_already_exists: 'admin.createTenant.errors.slugTaken',
  license_key_already_assigned: 'admin.createTenant.errors.licenseTaken',
  invite_already_pending: 'admin.createTenant.errors.invitePending',
};

/**
 * Crea tenant + invito primo admin in transazione atomica via RPC SECURITY DEFINER.
 * L'autorizzazione `is_super_admin()` e' verificata DENTRO l'RPC: il client
 * non puo' bypassare e l'errore `forbidden_super_admin_only` viene mappato a UI.
 */
export async function createTenantWithInvite(
  supabase: SupabaseClient<Database>,
  input: CreateTenantInput,
): Promise<{ data: CreateTenantResult | null; error: string | null; errorCode: string | null }> {
  // Calcola app_url da window.location: l'invite_url ritornato dalla RPC sara'
  // navigabile dall'utente invitato sullo stesso dominio dove sta lavorando il
  // super-admin (es. https://app.liveslidecenter.com).
  const appUrl =
    typeof window !== 'undefined' && window.location
      ? `${window.location.protocol}//${window.location.host}`
      : '';

  // I parametri `p_expires_at` e `p_license_key` accettano NULL runtime
  // (la RPC SQL ha branch `IF ... IS NULL`), ma il type generator Supabase
  // li riflette come `string` non-nullable perche' la signature SQL non ha
  // DEFAULT. Cast esplicito per allinearci al runtime senza alterare la API.
  const { data, error } = await supabase.rpc('admin_create_tenant_with_invite', {
    p_name: input.name,
    p_slug: input.slug,
    p_plan: input.plan,
    p_storage_limit_bytes: input.storageLimitBytes,
    p_max_events_per_month: input.maxEventsPerMonth,
    p_max_rooms_per_event: input.maxRoomsPerEvent,
    p_max_devices_per_room: input.maxDevicesPerRoom,
    p_expires_at: input.expiresAt as unknown as string,
    p_license_key: input.licenseKey as unknown as string,
    p_admin_email: input.adminEmail,
    p_app_url: appUrl,
  });

  if (error) {
    // I codici applicativi sono nel `message` della PostgrestError (RAISE EXCEPTION).
    // Postgres include "anche" il `code` SQLSTATE: 42501 = forbidden, 23505 =
    // unique_violation, P0001 = generic raise (default per le nostre RAISE).
    const rawMsg = error.message ?? 'unknown';
    return { data: null, error: rawMsg, errorCode: rawMsg };
  }

  if (!data || typeof data !== 'object') {
    return { data: null, error: 'malformed_rpc_response', errorCode: 'malformed_rpc_response' };
  }

  // Cast safe: la RPC restituisce sempre questi campi (vedi migration).
  const json = data as {
    tenant_id: string;
    slug: string;
    invite_id: string;
    invite_token: string;
    invite_url: string;
    invite_expires_at: string;
    admin_email: string;
    license_key: string | null;
  };

  return {
    data: {
      tenantId: json.tenant_id,
      slug: json.slug,
      inviteId: json.invite_id,
      inviteToken: json.invite_token,
      inviteUrl: json.invite_url,
      inviteExpiresAt: json.invite_expires_at,
      adminEmail: json.admin_email,
      licenseKey: json.license_key,
    },
    error: null,
    errorCode: null,
  };
}

/** Suggerisce uno slug valido a partire dal nome azienda (lowercase, no accenti, dash). */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
