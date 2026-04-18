/**
 * Sprint T-3-G (G10) — repository client per il telecomando remoto via tablet.
 *
 * Suddiviso in due aree:
 *   1) Admin (sessione JWT): create / revoke / list dei pairings, via RPC
 *      `rpc_create_remote_control_pairing`, `rpc_revoke_remote_control_pairing`
 *      e SELECT diretta su `remote_control_pairings` (RLS-isolata).
 *   2) Remote (anon + token): validate token, fetch scaletta, dispatch comandi.
 *      Le prime due via RPC anon-callable (`rpc_validate_remote_control_token`
 *      e `rpc_get_room_schedule_remote`); il dispatch passa dalla Edge
 *      Function `remote-control-dispatch` perche' la RPC e' GRANT solo a
 *      service_role.
 *
 * Vedi:
 *   - migration `supabase/migrations/20260418210000_remote_control_pairings.sql`
 *   - Edge Function `supabase/functions/remote-control-dispatch/index.ts`
 *   - tipi `packages/shared/src/types/remote-control.ts`
 */
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type {
  RemoteControlCommand,
  RemoteControlDispatchResult,
  RemoteControlPairingCreated,
  RemoteControlPairingSummary,
  RemoteControlSchedule,
  RemoteControlScheduleItem,
  RemoteControlValidatedToken,
} from '@slidecenter/shared';

// ── ADMIN ────────────────────────────────────────────────────────────────────

export async function createRemoteControlPairing(input: {
  roomId: string;
  name: string;
  ttlMinutes?: number;
}): Promise<RemoteControlPairingCreated> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_create_remote_control_pairing', {
    p_room_id: input.roomId,
    p_name: input.name,
    p_ttl_minutes: input.ttlMinutes ?? 1440,
  });
  if (error) throw new Error(error.message);
  const result = data as {
    ok?: boolean;
    pairing_id?: string;
    token?: string;
    expires_at?: string;
    room_id?: string;
    event_id?: string;
  } | null;
  if (!result?.ok || !result.pairing_id || !result.token) {
    throw new Error('create_pairing_failed');
  }
  return {
    pairingId: result.pairing_id,
    token: result.token,
    expiresAt: result.expires_at ?? new Date().toISOString(),
    roomId: result.room_id ?? input.roomId,
    eventId: result.event_id ?? '',
  };
}

export async function revokeRemoteControlPairing(pairingId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('rpc_revoke_remote_control_pairing', {
    p_pairing_id: pairingId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Lista pairings ATTIVI per una sala (non revocati e non scaduti). RLS-isolata
 * per tenant_admin via policy `rcp_select_tenant_admin`.
 */
export async function listActiveRemoteControlPairingsForRoom(
  roomId: string,
): Promise<RemoteControlPairingSummary[]> {
  const supabase = getSupabaseBrowserClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('remote_control_pairings')
    .select(
      'id, name, room_id, event_id, created_at, expires_at, last_used_at, revoked_at, commands_count',
    )
    .eq('room_id', roomId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    roomId: row.room_id,
    eventId: row.event_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    commandsCount: row.commands_count,
  }));
}

// ── REMOTE (tablet, anon + token) ────────────────────────────────────────────

export async function validateRemoteControlToken(
  token: string,
): Promise<RemoteControlValidatedToken> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_validate_remote_control_token', {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  const result = data as {
    ok?: boolean;
    pairing_id?: string;
    tenant_id?: string;
    event_id?: string;
    room_id?: string;
    name?: string;
    expires_at?: string;
    room_name?: string | null;
    event_title?: string | null;
  } | null;
  if (!result?.ok || !result.pairing_id) throw new Error('token_invalid');
  return {
    pairingId: result.pairing_id,
    tenantId: result.tenant_id ?? '',
    eventId: result.event_id ?? '',
    roomId: result.room_id ?? '',
    name: result.name ?? '',
    expiresAt: result.expires_at ?? new Date().toISOString(),
    roomName: result.room_name ?? null,
    eventTitle: result.event_title ?? null,
  };
}

export async function getRemoteControlSchedule(token: string): Promise<RemoteControlSchedule> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_get_room_schedule_remote', { p_token: token });
  if (error) throw new Error(error.message);
  const result = data as {
    ok?: boolean;
    session_id?: string | null;
    session_title?: string | null;
    current_presentation_id?: string | null;
    schedule?: Array<{
      presentation_id: string;
      version_id: string;
      file_name: string;
      speaker_name: string | null;
      display_order: number | null;
    }>;
  } | null;
  if (!result?.ok) throw new Error('schedule_fetch_failed');
  const schedule: RemoteControlScheduleItem[] = (result.schedule ?? []).map((item) => ({
    presentationId: item.presentation_id,
    versionId: item.version_id,
    fileName: item.file_name,
    speakerName: item.speaker_name,
    displayOrder: item.display_order,
  }));
  return {
    sessionId: result.session_id ?? null,
    sessionTitle: result.session_title ?? null,
    currentPresentationId: result.current_presentation_id ?? null,
    schedule,
  };
}

/**
 * Invia un comando al PC sala via Edge Function.
 *
 * Errori mappati lato Edge:
 *   - 401: token_invalid | token_revoked | token_expired
 *   - 429: rate_limited (60 cmd/min)
 *   - 400: invalid_command | missing_target | end_of_schedule | start_of_schedule | ...
 *
 * NON usa `invokeEdgeFunction` (che richiede session JWT): chiamata diretta
 * con anon-key + token nel body.
 */
export async function dispatchRemoteCommand(input: {
  token: string;
  command: RemoteControlCommand;
  targetPresentationId?: string | null;
}): Promise<RemoteControlDispatchResult> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/remote-control-dispatch`;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!anonKey) throw new Error('missing_anon_key');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      token: input.token,
      command: input.command,
      target_presentation_id: input.targetPresentationId ?? null,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    room_id?: string;
    command?: string;
    presentation_id?: string | null;
    started_at?: string | null;
    error?: string;
  };

  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `remote_control_dispatch_${res.status}`);
  }

  return {
    roomId: json.room_id ?? '',
    command: json.command ?? input.command,
    presentationId: json.presentation_id ?? null,
    startedAt: json.started_at ?? null,
  };
}

/**
 * Costruisce l'URL pubblico del telecomando, prefissato dall'origin attuale.
 * Esempio: `https://app.example.com/remote/<token>`
 */
export function buildRemoteControlUrl(token: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ?? '';
  return `${origin.replace(/\/+$/, '')}/remote/${encodeURIComponent(token)}`;
}
