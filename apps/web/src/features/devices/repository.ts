import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export type PairedDevice = Database['public']['Tables']['paired_devices']['Row'];

export interface PairInitResponse {
  code: string;
  expires_at: string;
}

export interface PairPollResponse {
  status: 'pending' | 'consumed' | 'expired';
  device_id?: string;
  device_name?: string;
}

export interface PairClaimResponse {
  device_token: string;
  device_id: string;
  event_id: string;
  room_id: string | null;
}

export type RoomPlayerNetworkMode = Database['public']['Enums']['network_mode'];

export interface RoomPlayerBootstrapSession {
  id: string;
  title: string;
  scheduled_start: string;
  scheduled_end: string;
}

export interface RoomPlayerBootstrapFileRow {
  versionId: string;
  presentationId: string;
  storageKey: string;
  filename: string;
  speakerName: string | null;
  sessionId: string;
  sessionTitle: string;
  sessionScheduledStart: string | null;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export interface RoomPlayerBootstrapResponse {
  device: { id: string; name: string };
  room: { id: string; name: string } | null;
  event_id: string;
  event_name?: string;
  network_mode: RoomPlayerNetworkMode | null;
  agent: { lan_ip: string; lan_port: number } | null;
  room_state: {
    sync_status: Database['public']['Tables']['room_state']['Row']['sync_status'];
    current_session: RoomPlayerBootstrapSession | null;
  };
  files: RoomPlayerBootstrapFileRow[];
  warning?: string;
}

// Errori funzionali: il client UI distingue 'auth_session_expired' (utente)
// da 'function_not_deployed' (config) e da errori HTTP generici.
export class EdgeFunctionAuthError extends Error {
  constructor(message = 'auth_session_expired') {
    super(message);
    this.name = 'EdgeFunctionAuthError';
  }
}

export class EdgeFunctionMissingError extends Error {
  constructor(name: string) {
    super(`function_not_deployed:${name}`);
    this.name = 'EdgeFunctionMissingError';
  }
}

/** Garantisce che la session abbia un access_token valido al momento dell'invoke. */
async function ensureFreshAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new EdgeFunctionAuthError(error.message);
  const session = data.session;
  if (!session) throw new EdgeFunctionAuthError('no_session');

  const expiresAt = (session.expires_at ?? 0) * 1000;
  const skewMs = 60_000;
  if (expiresAt - Date.now() < skewMs) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      throw new EdgeFunctionAuthError(refreshError?.message ?? 'refresh_failed');
    }
    return refreshed.session.access_token;
  }
  return session.access_token;
}

async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  authRequired = true,
): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!anonKey) throw new Error('missing_anon_key');

  let bearer = anonKey;
  if (authRequired) bearer = await ensureFreshAccessToken();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EdgeFunctionAuthError(err.error ?? 'unauthorized');
  }
  if (res.status === 404) {
    throw new EdgeFunctionMissingError(name);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
    throw new Error(err?.error ?? `edge_function_${name}_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function invokePairInit(
  eventId: string,
  roomId?: string | null,
): Promise<PairInitResponse> {
  return invokeEdgeFunction<PairInitResponse>('pair-init', { event_id: eventId, room_id: roomId });
}

export async function invokePairPoll(code: string): Promise<PairPollResponse> {
  return invokeEdgeFunction<PairPollResponse>('pair-poll', { code });
}

export async function invokePairClaim(
  code: string,
  deviceName?: string,
): Promise<PairClaimResponse> {
  return invokeEdgeFunction<PairClaimResponse>(
    'pair-claim',
    {
      code,
      device_name: deviceName,
      device_type: 'desktop',
      browser: navigator.userAgent.split(' ').slice(-1)[0] ?? null,
      user_agent: navigator.userAgent,
    },
    false,
  );
}

/** Contesto sala + `network_mode` + lista file (Fase 9) — validazione `device_token` lato Edge Function. */
export async function invokeRoomPlayerBootstrap(
  deviceToken: string,
  includeVersions = true,
): Promise<RoomPlayerBootstrapResponse> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-player-bootstrap`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ device_token: deviceToken, include_versions: includeVersions }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Partial<RoomPlayerBootstrapResponse>;
  if (!res.ok) {
    throw new Error(json.error ?? `room_player_bootstrap_${res.status}`);
  }
  return json as RoomPlayerBootstrapResponse;
}

export async function listPairedDevices(eventId: string): Promise<PairedDevice[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('paired_devices')
    .select('*')
    .eq('event_id', eventId)
    .order('paired_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateDeviceRoom(
  deviceId: string,
  roomId: string | null,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from('paired_devices')
    .update({ room_id: roomId, updated_at: new Date().toISOString() })
    .eq('id', deviceId);

  if (error) throw new Error(error.message);
}

export async function renameDevice(deviceId: string, deviceName: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from('paired_devices')
    .update({ device_name: deviceName, updated_at: new Date().toISOString() })
    .eq('id', deviceId);

  if (error) throw new Error(error.message);
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from('paired_devices').delete().eq('id', deviceId);
  if (error) throw new Error(error.message);
}

export async function getDeviceByToken(token: string): Promise<PairedDevice | null> {
  const tokenHash = await sha256Hex(token);
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('paired_devices')
    .select('*')
    .eq('pair_token_hash', tokenHash)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/** Rinomina chiamata dal PC sala (autenticazione via device_token, no JWT). */
export async function invokeRoomPlayerRename(
  deviceToken: string,
  deviceName: string,
): Promise<{ ok: boolean; device_id: string; device_name: string }> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-player-rename`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ device_token: deviceToken, device_name: deviceName }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    device_id?: string;
    device_name?: string;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `room_player_rename_${res.status}`);
  }
  return { ok: true, device_id: json.device_id!, device_name: json.device_name! };
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
