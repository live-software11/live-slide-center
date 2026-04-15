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

async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  authRequired = true,
): Promise<T> {
  const supabase = getSupabaseBrowserClient();

  if (authRequired) {
    const { data: result, error } = await supabase.functions.invoke<T>(name, { body });
    if (error) throw new Error(error.message);
    return result as T;
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
    throw new Error(err?.error ?? `Edge function ${name} failed`);
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

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
