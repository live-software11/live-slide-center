// ════════════════════════════════════════════════════════════════════════════
// Sprint D5 — Repository per pannello admin "Centri Slide" (PC desktop server)
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper sui 5 RPC + 2 SELECT per la gestione PC desktop server di tenant.
// Le tabelle `desktop_devices` e `desktop_provision_tokens` sono state
// introdotte da Sprint D1 (vedi
// `supabase/migrations/20260418290000_desktop_devices_licensing.sql`).
//
// Pattern allineato a `apps/web/src/features/devices/repository.ts` (Sprint
// U-4) — se cambi qui, considera consistency anche col gemello room_*.
//
// Tipi: i types Database non includono ancora le nuove tabelle (la rigenerazione
// `supabase gen types` e' in TODO sprint successivo); definiamo manualmente
// le interfacce DTO finche' il drift check non viene riconciliato.
// ════════════════════════════════════════════════════════════════════════════

import { getSupabaseBrowserClient } from '@/lib/supabase';

// Le 3 nuove RPC `rpc_admin_*_desktop_*` esistono in produzione (migration
// 20260418290000_desktop_devices_licensing.sql) ma non sono ancora nei tipi
// generati `database.types.ts`. Usiamo un cast minimale per non rompere
// i tipi generati per le altre RPC.
type SupabaseRpcLoose = ReturnType<typeof getSupabaseBrowserClient>['rpc'];
function rpcLoose(): (fn: string, args?: Record<string, unknown>) => ReturnType<SupabaseRpcLoose> {
  const client = getSupabaseBrowserClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((fn: string, args?: Record<string, unknown>) => (client.rpc as any)(fn, args)) as never;
}

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface DesktopDevice {
  id: string;
  tenant_id: string;
  device_name: string;
  machine_fingerprint: string | null;
  app_version: string | null;
  os_version: string | null;
  status: 'active' | 'revoked';
  registered_at: string;
  last_verified_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  notes: string | null;
}

export interface DesktopProvisionToken {
  id: string;
  tenant_id: string;
  label: string | null;
  max_uses: number;
  consumed_count: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatedDesktopProvisionToken {
  id: string;
  token: string;
  expires_at: string;
  max_uses: number;
  tenant_id: string;
}

// ── Lettura tabelle (RLS tenant-isolated) ───────────────────────────────────

/** Lista PC desktop server collegati al tenant corrente. */
export async function listDesktopDevices(): Promise<DesktopDevice[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('desktop_devices')
    .select(
      'id, tenant_id, device_name, machine_fingerprint, app_version, os_version, status, registered_at, last_verified_at, last_seen_at, revoked_at, notes',
    )
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .order('registered_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as DesktopDevice[];
}

/** Lista magic-link attivi (non revocati e non scaduti). */
export async function listDesktopProvisionTokens(opts?: {
  includeRevoked?: boolean;
}): Promise<DesktopProvisionToken[]> {
  const supabase = getSupabaseBrowserClient();
  let q = supabase
    .from('desktop_provision_tokens')
    .select('id, tenant_id, label, max_uses, consumed_count, expires_at, revoked_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (!opts?.includeRevoked) q = q.is('revoked_at', null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DesktopProvisionToken[];
}

// ── Mutations via RPC SECURITY DEFINER ──────────────────────────────────────

/**
 * Sprint D1: genera magic-link bind. Ritorna `token` plain UNA volta sola
 * (in DB resta solo lo sha256). L'admin lo deve mostrare/copiare/stampare
 * subito perche' non e' piu' recuperabile.
 */
export async function createDesktopProvisionToken(input: {
  label?: string | null;
  expiresMinutes?: number;
  maxUses?: number;
}): Promise<CreatedDesktopProvisionToken> {
  const { data, error } = await rpcLoose()('rpc_admin_create_desktop_provision_token', {
    p_label: input.label ?? null,
    p_expires_minutes: input.expiresMinutes ?? null,
    p_max_uses: input.maxUses ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('create_desktop_token_empty');
  return data as unknown as CreatedDesktopProvisionToken;
}

/** Revoca atomica di un magic-link non ancora consumato. */
export async function revokeDesktopProvisionToken(tokenId: string): Promise<void> {
  const { error } = await rpcLoose()('rpc_admin_revoke_desktop_provision_token', {
    p_token_id: tokenId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Sprint D1: revoca un PC desktop server attivo. Da quel momento
 * `desktop-license-verify` ritorna `device_revoked` al client che entra in
 * stato `revoked` (banner sticky + funzioni cloud disabilitate, modalita'
 * LAN preservata).
 */
export async function revokeDesktopDevice(deviceId: string): Promise<void> {
  const { error } = await rpcLoose()('rpc_admin_revoke_desktop_device', {
    p_device_id: deviceId,
  });
  if (error) throw new Error(error.message);
}

// ── Sprint S-4: toggle ruolo paired_devices (room ↔ control_center) ─────────
// L'RPC `update_device_role` esiste da
// `supabase/migrations/20260418090000_paired_devices_role.sql`. Lo esponiamo
// qui perche' il pannello admin Centri Slide unisce desktop_devices
// (PC server fisici con licenza) e i ruoli dei paired_devices PC sala.

export interface PairedDeviceLite {
  id: string;
  device_name: string;
  status: string;
  role: 'room' | 'control_center';
  room_id: string | null;
  event_id: string | null;
  last_seen_at: string | null;
}

/**
 * Lista paired_devices del tenant con ruolo, pensata per il pannello
 * "Centri Slide" che permette toggle role. RLS tenant-isolato gia' applicato
 * dalla policy. La colonna `status` (connection_status: online/offline/degraded)
 * non e' un filtro qui — il device esiste se completato il pairing, e mostriamo
 * tutti i device del tenant indipendentemente dall'attuale connessione LAN.
 */
export async function listPairedDevicesWithRole(): Promise<PairedDeviceLite[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('paired_devices')
    .select('id, device_name, status, role, room_id, event_id, last_seen_at')
    .order('role', { ascending: false }) // control_center prima
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PairedDeviceLite[];
}

/**
 * Promuove un paired_device a 'control_center' (o lo riporta a 'room').
 * Quando role='control_center': RPC forza room_id=NULL. Bumpa updated_at
 * per Realtime notify (gia' attivo da S-2).
 */
export async function updatePairedDeviceRole(input: {
  deviceId: string;
  newRole: 'room' | 'control_center';
}): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('update_device_role', {
    p_device_id: input.deviceId,
    p_new_role: input.newRole,
  });
  if (error) throw new Error(error.message);
}
