import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

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

/**
 * Sprint A (GUIDA_OPERATIVA_v3 §2.A) — modalita di playback dichiarata dal PC sala.
 * - `auto`: default. Polling 12s, download a banda piena, priority `auto`.
 * - `live`: durante una proiezione. Polling 60s, throttle download (50ms ogni 4MB),
 *           `fetch` priority `low`. Garantisce che video 4K non subisca stuttering.
 * - `turbo`: setup pre-evento. Polling 5s, concurrency 3, `fetch` priority `high`.
 */
export type PlaybackMode = Database['public']['Enums']['playback_mode'];

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
  /**
   * Sprint C2 (GUIDA_OPERATIVA_v3 §2.C): hash SHA-256 calcolato lato upload e
   * salvato in `presentation_versions.file_hash_sha256`. `null` per upload
   * legacy senza hash (es. Phase 1) — in quel caso il PC sala non puo'
   * verificare l'integrita' e segna `verified: 'skipped'`.
   */
  fileHashSha256: string | null;
  /**
   * Sprint S-4 (G7) — id sala di appartenenza del file (via session→room).
   * Per device 'room': uguale per tutti i file (la sala assegnata al device).
   * Per device 'control_center': varia per file (1 device = N sale).
   * Stringa vuota se la sessione e' orfana (caso edge).
   */
  roomId: string;
  /**
   * Sprint S-4 (G7) — nome sala leggibile per UI e per il path locale del file
   * (`<roomName>/<sessionTitle>/<filename>` su disco). Stringa vuota se la
   * sessione e' orfana (fallback al roomName del device).
   */
  roomName: string;
  /**
   * Sprint T-1 (G8) — `version_number` della versione attualmente "in onda" su
   * questo file (i.e. quella servita al PC sala = `current_version_id`).
   * Nullable per backward compat con bootstrap pre-T-1; in tal caso il PC sala
   * non mostra il badge `vN/M`.
   */
  versionNumber: number | null;
  /**
   * Sprint T-1 (G8) — `MAX(version_number)` tra TUTTE le versioni 'ready' o
   * 'superseded' di questa stessa presentation. Se `versionNumber === versionTotal`
   * la corrente e' anche la piu' recente (badge verde); se `versionNumber <
   * versionTotal` significa che l'admin ha riportato indietro la corrente,
   * esiste una versione piu' nuova (badge giallo).
   */
  versionTotal: number | null;
}

/**
 * Sprint S-4 (G7) — ruolo del device pairato.
 * - `'room'` (default): 1 device = 1 sala (comportamento storico).
 * - `'control_center'`: 1 device = N sale, riceve i file di tutte le sale
 *   dell'evento per backup/export. Vedi migration 20260418090000_*.
 */
export type DeviceRole = 'room' | 'control_center';

export interface RoomPlayerBootstrapResponse {
  device: { id: string; name: string; role?: DeviceRole };
  room: { id: string; name: string } | null;
  event_id: string;
  event_name?: string;
  network_mode: RoomPlayerNetworkMode | null;
  agent: { lan_ip: string; lan_port: number } | null;
  room_state: {
    sync_status: Database['public']['Tables']['room_state']['Row']['sync_status'];
    current_session: RoomPlayerBootstrapSession | null;
    /** Sprint A6: modalita playback corrente in DB (eco lato server). */
    playback_mode: PlaybackMode;
  };
  files: RoomPlayerBootstrapFileRow[];
  warning?: string;
  /**
   * Sprint S-4 (G7) — flag esplicito presente solo per device
   * `role='control_center'`. Permette al client di branchare UI senza dover
   * controllare `device.role` (che e' opzionale per backward-compat).
   */
  control_center?: true;
  /**
   * Sprint S-4 (G7) — lista delle sale dell'evento (presente solo per device
   * `control_center`). Usata da `CenterPlayerView` per pre-popolare il tree
   * sala/sessione anche quando non ci sono ancora file.
   */
  rooms?: Array<{ id: string; name: string }>;
}

// Sprint T-3-A: refactor leggero. Le primitive `invokeEdgeFunction`,
// `EdgeFunctionAuthError`, `EdgeFunctionMissingError`, `ensureFreshAccessToken`
// sono state estratte in `@/lib/edge-functions` per dedup tra features.
// Comportamento IDENTICO. Re-export per backward-compat dei consumer esistenti.
export {
  EdgeFunctionAuthError,
  EdgeFunctionMissingError,
} from '@/lib/edge-functions';
import { invokeEdgeFunction } from '@/lib/edge-functions';

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

/**
 * Contesto sala + `network_mode` + lista file (Fase 9) — validazione
 * `device_token` lato Edge Function.
 *
 * Sprint A6: il PC sala puo' dichiarare la propria modalita di playback
 * (`playback_mode`) per renderla visibile alla dashboard admin.
 *
 * Sprint T-2 (G9): payload `metrics` opzionale (browser/desktop perf snapshot).
 * Se presente, viene forwardato lato Edge Function alla RPC SECURITY DEFINER
 * `record_device_metric_ping` con rate-limit 3s. Best-effort: se omesso, no
 * insert; se presente ma server fallisce, il bootstrap continua comunque.
 */
export interface DeviceMetricPingPayload {
  source?: 'browser' | 'desktop';
  js_heap_used_pct?: number | null;
  js_heap_used_mb?: number | null;
  storage_quota_used_pct?: number | null;
  storage_quota_used_mb?: number | null;
  fps?: number | null;
  network_type?: string | null;
  network_downlink_mbps?: number | null;
  battery_pct?: number | null;
  battery_charging?: boolean | null;
  visibility?: 'visible' | 'hidden' | null;
  cpu_pct?: number | null;
  ram_used_pct?: number | null;
  ram_used_mb?: number | null;
  disk_free_pct?: number | null;
  disk_free_gb?: number | null;
  app_uptime_sec?: number | null;
}

export async function invokeRoomPlayerBootstrap(
  deviceToken: string,
  includeVersions = true,
  playbackMode?: PlaybackMode,
  metrics?: DeviceMetricPingPayload | null,
): Promise<RoomPlayerBootstrapResponse> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-player-bootstrap`;
  // Sprint E1 (GUIDA_OPERATIVA_v3 §2.E1): retry automatico con backoff su
  // 5xx/429/network. Bootstrap viene chiamato a ogni tick di polling
  // (12s/60s/5s) — basta un blip di rete per perdere un tick e generare un
  // falso "POLLING" sulla UI. Backoff [500, 2000, 8000] = max 10.5s prima
  // di considerare la chiamata fallita.
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      device_token: deviceToken,
      include_versions: includeVersions,
      ...(playbackMode ? { playback_mode: playbackMode } : {}),
      ...(metrics ? { metrics } : {}),
    }),
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

/**
 * Sprint S-4 (G7) — promuove/demuove un device tra ruolo "room" e
 * "control_center". Wrapper sulla RPC `update_device_role` SECURITY INVOKER
 * (rispetta RLS tenant_isolation).
 *
 * Side effect:
 * - Quando `newRole = 'control_center'`, la RPC forza `room_id = NULL` lato
 *   server (un Centro Slide non e' assegnato a una singola sala).
 * - Bumpa `updated_at` cosi' la subscription Realtime postgres_changes su
 *   `paired_devices` (in `usePairedDevices`) propaga la modifica agli altri
 *   admin in <1s.
 */
export async function updateDeviceRole(
  deviceId: string,
  newRole: DeviceRole,
): Promise<{ id: string; role: DeviceRole; room_id: string | null }> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('update_device_role', {
    p_device_id: deviceId,
    p_new_role: newRole,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('update_device_role_no_row');
  return { id: row.id, role: row.role as DeviceRole, room_id: row.room_id ?? null };
}

/**
 * Sprint T-2 (G9) — admin LivePerfTelemetryPanel.
 *
 * Per ogni device dell'evento ritorna:
 * - `device`: snapshot anagrafica (name, role, status, room_id, last_seen).
 * - `latest`: ultimo metric ping (null se device non ha mai pingato in finestra).
 * - `pings`: array (max `p_max_pings_per_device`) di ping recenti, ORDINE
 *            ASCENDING per ts (utile per disegnare sparkline left-to-right).
 *
 * Auth: la RPC e' SECURITY DEFINER ma controlla `app_tenant_id() = events.tenant_id`
 * + ruolo `admin|tech`. Anon/utenti di altro tenant ricevono 403.
 *
 * Performance: query coperta da `idx_device_metric_pings_device_ts` +
 * `idx_device_metric_pings_event_ts`. Su evento con 12 PC sala × 60 ping/30min
 * = 720 righe = <50ms tipico.
 */
export interface DeviceMetricPing {
  ts: string;
  cpu_pct: number | null;
  ram_used_pct: number | null;
  js_heap_used_pct: number | null;
  storage_quota_used_pct: number | null;
  disk_free_pct: number | null;
  fps: number | null;
  battery_pct: number | null;
  battery_charging: boolean | null;
  network_type: string | null;
  visibility: 'visible' | 'hidden' | null;
}

export interface DeviceMetricsLatest extends DeviceMetricPing {
  tenant_id: string;
  device_id: string;
  event_id: string | null;
  room_id: string | null;
  source: 'browser' | 'desktop';
  js_heap_used_mb: number | null;
  storage_quota_used_mb: number | null;
  network_downlink_mbps: number | null;
  ram_used_mb: number | null;
  disk_free_gb: number | null;
  app_uptime_sec: number | null;
  playback_mode: 'auto' | 'live' | 'turbo' | null;
  device_role: 'room' | 'control_center' | null;
}

export interface DeviceMetricsRow {
  device: {
    id: string;
    name: string;
    role: 'room' | 'control_center';
    status: 'online' | 'offline' | 'degraded';
    room_id: string | null;
    last_seen_at: string | null;
    last_ip: string | null;
  };
  latest: DeviceMetricsLatest | null;
  pings: DeviceMetricPing[];
}

export async function fetchDeviceMetricsForEvent(
  eventId: string,
  options: { windowMin?: number; maxPingsPerDevice?: number } = {},
): Promise<DeviceMetricsRow[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('fetch_device_metrics_for_event', {
    p_event_id: eventId,
    p_window_min: options.windowMin ?? 30,
    p_max_pings_per_device: options.maxPingsPerDevice ?? 60,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DeviceMetricsRow[];
}

export async function renameDevice(deviceId: string, deviceName: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from('paired_devices')
    .update({ device_name: deviceName, updated_at: new Date().toISOString() })
    .eq('id', deviceId);

  if (error) throw new Error(error.message);
}

/**
 * Sprint M3 — mappa locale `deviceId → lanBaseUrl` per il pair-revoke.
 *
 * Strategia: per evitare di toccare lo schema cloud Supabase (la colonna
 * `lan_base_url` esiste solo nel SQLite locale dell'admin desktop, vedi
 * migration 0002) e mantenere il typing del Database type pulito, salviamo
 * la mappa in `localStorage` quando l'admin pairizza via LAN. La rilegge
 * `revokeDevice()` solo se siamo in modalita desktop (Tauri).
 *
 * Trade-off accettato: se l'utente admin reinstalla l'app o pulisce il
 * localStorage, il pair-revoke remoto non funziona piu' per i device gia'
 * pairati, e lui dovra' usare il menu "Esci dall'evento" sul sala. Casi
 * edge nel field-test: documentati in §4.E della guida operativa.
 */
const LAN_BASE_URL_MAP_KEY = 'sc:devices:lanBaseUrlByDeviceId';

function loadLanBaseUrlMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAN_BASE_URL_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveLanBaseUrlMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(LAN_BASE_URL_MAP_KEY, JSON.stringify(map));
  } catch {
    /* storage bloccato: non blocchiamo il pair (tradeoff accettato sopra) */
  }
}

/**
 * Sprint M3 — registra il `lanBaseUrl` di un PC sala paired direttamente
 * via LAN. Chiamata da `AddLanPcDialog` dopo pair-direct success.
 */
export function rememberPairedDeviceLanUrl(deviceId: string, lanBaseUrl: string): void {
  const map = loadLanBaseUrlMap();
  map[deviceId] = lanBaseUrl;
  saveLanBaseUrlMap(map);
}

function forgetPairedDeviceLanUrl(deviceId: string): void {
  const map = loadLanBaseUrlMap();
  if (deviceId in map) {
    delete map[deviceId];
    saveLanBaseUrlMap(map);
  }
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  // Sprint M3: in modalita desktop tentiamo prima il pair-revoke LAN sul PC
  // sala (cosi' il sala cancella device.json + paired_devices SQLite e libera
  // mDNS). Best-effort: se la chiamata fallisce (sala spento/LAN giu'),
  // procediamo comunque con la cancellazione del record sul DB locale
  // dell'admin — l'utente sa che il sala potrebbe ricomparire al prossimo
  // boot, ma puo' rifare unpair quando torna online.
  const lanBaseUrl = loadLanBaseUrlMap()[deviceId] ?? null;
  if (lanBaseUrl) {
    try {
      const { pairRevokeLan } = await import('@/lib/desktop-bridge');
      await pairRevokeLan({ targetBaseUrl: lanBaseUrl, device_id: deviceId });
    } catch {
      /* Non bloccante: procediamo con il delete locale anche se il sala e' down. */
    }
  }

  const { error } = await supabase.from('paired_devices').delete().eq('id', deviceId);
  if (error) throw new Error(error.message);

  // Pulisci la mappa locale anche se il pair-revoke remoto fallisce: se il
  // sala torna online dopo, ricomparira' nella discovery mDNS e l'admin potra'
  // farne il re-pair (che e' la UX corretta).
  forgetPairedDeviceLanUrl(deviceId);
}

/**
 * Sprint D1 (GUIDA_OPERATIVA_v3 §2.D1) — pulsante "Forza refresh" lato admin.
 *
 * Pubblica un broadcast Realtime sul topic `room:<roomId>` con event
 * `force_refresh`. Il PC sala (in `useFileSync`) ha un handler dedicato che
 * azzera la cache locale (`syncedVersionIds`, `verifiedStatusRef`) e fa un
 * `refreshNow()` immediato, ridownloadando e ri-verificando tutti i file.
 *
 * Niente Edge Function: l'admin e' autenticato e il topic e' un UUID v4
 * (non enumerable, comunicato solo agli autorizzati). La finestra d'attacco
 * e' equivalente a quella del topic principale Sprint B.
 *
 * Implementazione: apre un canale ad-hoc, attende `SUBSCRIBED`, invia il
 * broadcast e si stacca. Timeout 5s per non bloccare l'UI se Realtime e' giu'.
 */
export async function broadcastForceRefresh(roomId: string): Promise<void> {
  if (!roomId) throw new Error('roomId required');
  const supabase = getSupabaseBrowserClient();
  const channel = supabase.channel(`admin_force:${roomId}:${Date.now()}`, {
    config: { broadcast: { self: false } },
  });
  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      void supabase.removeChannel(channel);
      reject(new Error('realtime_timeout'));
    }, 5000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel
          .send({ type: 'broadcast', event: 'force_refresh', payload: { room_id: roomId, at: new Date().toISOString() } })
          .then(() => {
            window.clearTimeout(timeoutId);
            void supabase.removeChannel(channel);
            resolve();
          })
          .catch((err) => {
            window.clearTimeout(timeoutId);
            void supabase.removeChannel(channel);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        window.clearTimeout(timeoutId);
        void supabase.removeChannel(channel);
        reject(new Error(`realtime_${status.toLowerCase()}`));
      }
    });
  });
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

/**
 * Sprint I (GUIDA_OPERATIVA_v3 §3.E E3) — segnala "ora in onda" / "stop".
 *
 * `presentationId === null` → ferma la trasmissione (clear `current_presentation_id`).
 * `presentationId === string` → segnala il file aperto. La RPC verifica che
 * la presentation appartenga a una sessione DELLA STESSA sala (no cross-room).
 *
 * Side effect: il trigger broadcast Sprint B propaga `room_state_changed`
 * sul topic `room:<roomId>` → admin (che e' subscribed in `useRoomStates`)
 * vede il nuovo `current_presentation_id` in <1s.
 *
 * Best-effort: il chiamante (RoomPlayerView) NON deve bloccare la UX di
 * apertura file se questa Edge Function fallisce. Logghiamo l'errore e
 * basta — il file si apre comunque (l'esperienza sala vince sull'audit).
 */
export async function invokeRoomPlayerSetCurrent(
  deviceToken: string,
  presentationId: string | null,
  /**
   * Sprint U-3 (On Air): opzionale, indice 1-based slide attualmente
   * proiettata + totale. Se omessi, retro-compat con behavior esistente
   * (lo stato slide-counter resta NULL nella row di room_state e l'OnAir
   * mostra "—/—" per quella sala).
   */
  slideCounters?: { currentSlideIndex?: number | null; currentSlideTotal?: number | null },
): Promise<{
  ok: boolean;
  room_id: string;
  presentation_id: string | null;
  started_at: string | null;
  slide_index: number | null;
  slide_total: number | null;
}> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-player-set-current`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      device_token: deviceToken,
      presentation_id: presentationId,
      current_slide_index: slideCounters?.currentSlideIndex ?? null,
      current_slide_total: slideCounters?.currentSlideTotal ?? null,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    room_id?: string;
    presentation_id?: string | null;
    started_at?: string | null;
    slide_index?: number | null;
    slide_total?: number | null;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `room_player_set_current_${res.status}`);
  }
  return {
    ok: true,
    room_id: json.room_id!,
    presentation_id: json.presentation_id ?? null,
    started_at: json.started_at ?? null,
    slide_index: json.slide_index ?? null,
    slide_total: json.slide_total ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Sprint R-3 (G3) — Upload da PC sala (relatore last-minute)
// ────────────────────────────────────────────────────────────────────

export interface RoomDeviceUploadInitResponse {
  ok: true;
  version_id: string;
  presentation_id: string;
  storage_key: string;
  bucket: string;
  session_id: string;
  room_id: string;
  device_id: string;
  signed_url: string;
  /** Token interno necessario a `supabase.storage.uploadToSignedUrl(path, token, file)`. */
  token: string;
  /** Path nel bucket (uguale a storage_key). */
  path: string;
}

export interface RoomDeviceUploadFinalizeResponse {
  ok: true;
  version_id: string;
  presentation_id: string;
  session_id: string | null;
  room_id: string;
  file_name: string;
}

/**
 * Sprint R-3 — init upload da PC sala. Auth via device_token hash.
 * Ritorna signed upload URL Storage (validita' 2h) per PUT diretto del file
 * senza forwardare via Edge Function.
 */
export async function invokeRoomDeviceUploadInit(input: {
  deviceToken: string;
  sessionId: string;
  filename: string;
  size: number;
  mime: string;
}): Promise<RoomDeviceUploadInitResponse> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-device-upload-init`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      device_token: input.deviceToken,
      session_id: input.sessionId,
      filename: input.filename,
      size: input.size,
      mime: input.mime,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as
    | RoomDeviceUploadInitResponse
    | { error?: string };
  if (!res.ok || !('ok' in json) || !json.ok) {
    throw new Error(
      ('error' in json && json.error) || `room_device_upload_init_${res.status}`,
    );
  }
  return json;
}

/**
 * Sprint R-3 — finalize upload da PC sala. Promuove version a 'ready' e
 * pubblica broadcast realtime `room:<roomId>` event 'room_device_upload_completed'
 * cosi' la dashboard admin riceve notifica in <1s.
 */
export async function invokeRoomDeviceUploadFinalize(input: {
  deviceToken: string;
  versionId: string;
  sha256: string;
}): Promise<RoomDeviceUploadFinalizeResponse> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-device-upload-finalize`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      device_token: input.deviceToken,
      version_id: input.versionId,
      sha256: input.sha256,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as
    | RoomDeviceUploadFinalizeResponse
    | { error?: string };
  if (!res.ok || !('ok' in json) || !json.ok) {
    throw new Error(
      ('error' in json && json.error) || `room_device_upload_finalize_${res.status}`,
    );
  }
  return json;
}

/**
 * Sprint R-3 — abort upload da PC sala. Cleanup version 'uploading' su errore
 * o cancel utente, marca 'failed'. Best-effort: errori ignorabili dal chiamante.
 */
export async function invokeRoomDeviceUploadAbort(input: {
  deviceToken: string;
  versionId: string;
}): Promise<{ ok: true }> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-device-upload-abort`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      device_token: input.deviceToken,
      version_id: input.versionId,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `room_device_upload_abort_${res.status}`);
  }
  return { ok: true };
}

/** Rinomina chiamata dal PC sala (autenticazione via device_token, no JWT). */
export async function invokeRoomPlayerRename(
  deviceToken: string,
  deviceName: string,
): Promise<{ ok: boolean; device_id: string; device_name: string }> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-player-rename`;
  // Sprint E1: rename invocato dal PC sala — retry trasparente.
  const res = await fetchWithRetry(url, {
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

// ════════════════════════════════════════════════════════════════════════════
// Sprint U-4 — Magic-link provisioning (zero-friction PC sala)
// ════════════════════════════════════════════════════════════════════════════

export type RoomProvisionToken =
  Database['public']['Tables']['room_provision_tokens']['Row'];

export interface CreatedRoomProvisionToken {
  id: string;
  token: string;
  expires_at: string;
  max_uses: number;
  tenant_id: string;
  event_id: string;
  room_id: string;
}

/**
 * Sprint U-4 (admin) — genera un magic-link token per la sala. Il valore
 * `token` torna in chiaro UNA SOLA VOLTA: il client deve mostrarlo subito
 * in QR/copia e salvarlo solo se serve. In DB resta solo l'hash sha256.
 *
 * - `expiresMinutes` clamped 5..43200 (server-side).
 * - `maxUses` clamped 1..10.
 */
export async function createRoomProvisionToken(input: {
  eventId: string;
  roomId: string;
  expiresMinutes?: number;
  maxUses?: number;
  label?: string | null;
}): Promise<CreatedRoomProvisionToken> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_admin_create_room_provision_token', {
    p_event_id: input.eventId,
    p_room_id: input.roomId,
    p_expires_minutes: input.expiresMinutes ?? undefined,
    p_max_uses: input.maxUses ?? undefined,
    p_label: input.label ?? undefined,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') {
    throw new Error('create_room_provision_token_empty');
  }
  return data as unknown as CreatedRoomProvisionToken;
}

/** Sprint U-4 (admin) — lista token attivi per un evento (RLS multi-tenant). */
export async function listRoomProvisionTokens(input: {
  eventId: string;
  roomId?: string | null;
  includeRevoked?: boolean;
}): Promise<RoomProvisionToken[]> {
  const supabase = getSupabaseBrowserClient();
  let q = supabase
    .from('room_provision_tokens')
    .select('*')
    .eq('event_id', input.eventId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (input.roomId) q = q.eq('room_id', input.roomId);
  // Default: nascondiamo i revocati per non sporcare la UI; admin puo'
  // chiedere il "mostra tutti".
  if (!input.includeRevoked) q = q.is('revoked_at', null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Sprint U-4 (admin) — revoca immediata di un magic-link attivo. */
export async function revokeRoomProvisionToken(tokenId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('rpc_admin_revoke_room_provision_token', {
    p_token_id: tokenId,
  });
  if (error) throw new Error(error.message);
}

export interface RoomProvisionClaimResponse {
  device_id: string;
  tenant_id: string;
  event_id: string;
  room_id: string;
  pair_token: string;
  max_uses: number;
  consumed_count: number;
}

/**
 * Sprint U-4 (PC sala) — consuma il magic-link e ottiene un pair_token
 * permanente. Il pair_token viene generato CLIENT-SIDE (32 byte
 * crypto.getRandomValues) e l'edge function ne calcola lo sha256 lato
 * server prima di chiamare la RPC SECURITY DEFINER. Il pair_token plain
 * resta nel browser (localStorage del PC sala) e non viene mai loggato.
 *
 * Nota: la chiamata e' anonima (verify_jwt=false). Rate-limit 30/5min/IP
 * lato edge.
 */
export async function claimRoomProvisionToken(input: {
  token: string;
  deviceName?: string | null;
}): Promise<RoomProvisionClaimResponse> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-provision-claim`;
  const pairToken = generateRandomToken(32);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const browser = detectBrowserNameSafe();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      token: input.token,
      pair_token: pairToken,
      device_name: input.deviceName ?? null,
      device_type: 'browser',
      browser,
      user_agent: ua,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as
    | RoomProvisionClaimResponse
    | { error?: string };
  if (!res.ok || !('device_id' in json)) {
    const err = ('error' in json && json.error) || `room_provision_claim_${res.status}`;
    throw new Error(err);
  }
  return json;
}

/**
 * Sprint Z (post-field-test) Gap D — il PC sala (PWA o Tauri) auto-revoca
 * il proprio pair_token cloud-side. Idempotente, fire-and-forget compatibile
 * (l'utente ha gia' deciso di disconnettersi).
 *
 * - Edge function: pair-revoke-self (verify_jwt=false, rate-limit 30/5min/IP).
 * - Token plain inviato in `Authorization: Bearer`, mai loggato lato client.
 * - In modalita desktop la chiamata va comunque al cloud Supabase (serve a
 *   marcare `desktop_devices.status = revoked` o `paired_devices.status =
 *   offline`); il cleanup locale (file device.json, license.enc, ...) e'
 *   responsabilita del chiamante via `clearDevicePairing()`.
 */
export async function revokePairTokenSelf(pairToken: string): Promise<{ ok: boolean; kind?: string }> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pair-revoke-self`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pairToken}`,
    },
    body: '{}',
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; kind?: string; error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `pair_revoke_self_${res.status}`);
  }
  return { ok: Boolean(json.ok), kind: json.kind };
}

/**
 * Genera N byte random come stringa base64url (no padding). Usa
 * crypto.getRandomValues — disponibile in tutti i browser moderni e
 * sicuro per chiavi/token.
 */
function generateRandomToken(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function detectBrowserNameSafe(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}
