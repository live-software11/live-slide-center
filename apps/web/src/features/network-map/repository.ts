// ════════════════════════════════════════════════════════════════════════════
// Sprint Z (post-field-test) Gap A + Gap B — Repository Network Map tenant
// ════════════════════════════════════════════════════════════════════════════
//
// Backend:
//   - SELECT da view `tenant_network_map` (migrazione
//     20260420010000_sprint_z_network_map_view.sql).
//     SECURITY INVOKER → eredita RLS tenant_id = app_tenant_id() dalle base
//     table `paired_devices` e `desktop_devices`. Niente cross-tenant leak.
//   - RPC `rpc_admin_move_paired_device` (Gap B, migrazione
//     20260420020000) per spostare PC sala su un evento target del tenant.
//
// Pattern allineato a `apps/web/src/features/desktop-devices/repository.ts`
// (Sprint D5) — stessa firma per i wrapper, stesso uso di
// `getSupabaseBrowserClient()`, stessi metodi `.order()` e `.limit()`.
// ════════════════════════════════════════════════════════════════════════════

import { getSupabaseBrowserClient } from '@/lib/supabase';

// ── DTOs ────────────────────────────────────────────────────────────────────

export type NetworkNodeKind = 'paired_device' | 'desktop_device';
export type NetworkNodeRole = 'room' | 'control_center' | 'desktop_server';
export type NetworkNodeStatus = 'online' | 'degraded' | 'offline';

export interface NetworkNode {
  node_id: string;
  tenant_id: string;
  kind: NetworkNodeKind;
  role: NetworkNodeRole;
  display_name: string;
  event_id: string | null;
  room_id: string | null;
  last_seen_at: string | null;
  derived_status: NetworkNodeStatus;
  raw_status: string;
  app_version: string | null;
  machine_fingerprint: string | null;
  registered_at: string | null;
}

export interface EventLite {
  id: string;
  name: string;
  status: string;
}

export interface RoomLite {
  id: string;
  name: string;
  event_id: string;
}

// ── Lettura ─────────────────────────────────────────────────────────────────

/**
 * Sprint Z Gap A — lista TUTTI i PC node del tenant: paired_devices + desktop
 * devices, status derivato da last_seen_at. Ordinamento: prima i nodi attivi
 * recenti, poi gli offline.
 */
export async function listNetworkNodes(): Promise<NetworkNode[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('tenant_network_map')
    .select(
      'node_id, tenant_id, kind, role, display_name, event_id, room_id, last_seen_at, derived_status, raw_status, app_version, machine_fingerprint, registered_at',
    )
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as NetworkNode[];
}

/**
 * Sprint Z Gap A (UI) — risolve gli UUID di eventi e sale in nomi human-
 * readable. La view tenant_network_map ritorna solo UUID per non duplicare
 * dati e mantenere la query veloce; i nomi vengono presi qui in batch UNICA
 * lato client (RLS filtra automaticamente per tenant). Ritorna due `Map` per
 * lookup O(1) dal componente.
 */
export async function fetchEventAndRoomNames(
  eventIds: readonly string[],
  roomIds: readonly string[],
): Promise<{ events: Map<string, string>; rooms: Map<string, string> }> {
  const supabase = getSupabaseBrowserClient();
  const eventsMap = new Map<string, string>();
  const roomsMap = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data, error } = await supabase
      .from('events')
      .select('id, name')
      .in('id', [...eventIds]);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row) => eventsMap.set(row.id, row.name));
  }
  if (roomIds.length > 0) {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, name')
      .in('id', [...roomIds]);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row) => roomsMap.set(row.id, row.name));
  }
  return { events: eventsMap, rooms: roomsMap };
}

/**
 * Sprint Z Gap B — lista eventi del tenant disponibili come destinazione
 * "Sposta PC qui". Limit 50, ordine: attivi prima, poi created_at desc.
 */
export async function listEventsForMove(): Promise<EventLite[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('events')
    .select('id, name, status')
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventLite[];
}

/**
 * Sprint Z Gap B — lista sale di un evento (per "sposta PC sull'evento X
 * sala Y"). L'admin puo' anche scegliere "nessuna sala" (drop su event card
 * generica) → il PC resta unassigned dentro all'evento.
 */
export async function listRoomsForEvent(eventId: string): Promise<RoomLite[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, event_id')
    .eq('event_id', eventId)
    .order('name', { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as RoomLite[];
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface MoveDeviceInput {
  deviceId: string;
  targetEventId: string;
  /** Se omesso, il device finisce nell'evento ma senza sala assegnata (waiting room). */
  targetRoomId?: string | null;
}

export interface MoveDeviceResult {
  ok: boolean;
  device_id: string;
  target_event_id: string;
  target_room_id: string | null;
  prev_event_id: string | null;
  prev_room_id: string | null;
}

/**
 * Sprint Z Gap B — sposta un paired_device su un evento target del tenant.
 * Server-side fa: validazione caller admin/tech, validazione event tenant,
 * validazione room appartenente all'event target, UPDATE atomico, audit log.
 */
export async function moveDeviceToEvent(input: MoveDeviceInput): Promise<MoveDeviceResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_admin_move_paired_device', {
    p_device_id: input.deviceId,
    p_target_event_id: input.targetEventId,
    // Cast `as unknown as string` perche' la generazione TS marca come
    // non-nullable, mentre l'RPC server-side accetta NULL (= sposta solo
    // nell'evento, lasciando waiting-room senza sala assegnata).
    p_target_room_id: (input.targetRoomId ?? null) as unknown as string,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('move_device_empty_response');
  return data as unknown as MoveDeviceResult;
}
