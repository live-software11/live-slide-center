/**
 * Sprint O3 (GUIDA_OPERATIVA_v3 §4.G — UX parity cloud/offline) — astrazione realtime.
 *
 * Wrapper minimo per le sottoscrizioni realtime broadcast indipendente dal
 * backend:
 *   • cloud → Supabase Realtime channel (`supabase.channel(topic).on('broadcast').subscribe()`)
 *   • desktop → long-poll `/events/stream` del backend Rust locale (Sprint N3)
 *
 * **Stato Sprint O3**: l'API e' fornita PER LE FUTURE migrazioni hook-by-hook.
 * Gli hook esistenti (`useFileSync`, `usePairedDevices`, `useRoomDevices`,
 * `useEventLiveData`, `useEventPresentationSpeakerIds`,
 * `usePresentationForSpeaker`, `useRoomStates`) continuano ad usare
 * direttamente `supabase.channel(...)` perche':
 *   • In cloud funziona nativamente (status quo).
 *   • In desktop, i `.subscribe()` falliscono con `CHANNEL_ERROR`/`TIMED_OUT`
 *     entro pochi secondi, gli hook leggono lo stato e degradano al polling
 *     REST safety-net (gia' codificato in tutti gli hook che usano realtime
 *     come "best-effort push"). Esperienza utente: le modifiche arrivano in
 *     <30s anche senza realtime.
 *   • Il push reattivo lato sala (l'unico flusso UX time-critical) usa gia'
 *     il long-poll `/events/stream` di Sprint N3 in `useFileSync`.
 *
 * Quando un hook cresce in importanza (es. `usePairedDevices` per
 * dashboard live in desktop), si puo' migrarlo a `subscribeToTopic` per avere
 * push reattivo anche lato admin desktop tramite il long-poll.
 *
 * Per ora questa astrazione documenta il pattern e fornisce l'unsubscribe
 * uniforme.
 */

import type { Database } from '@slidecenter/shared';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getBackendMode } from './backend-mode';
import { getSupabaseBrowserClient } from './supabase';
import { getCachedDesktopBackendInfo } from './desktop-backend-init';
import { fetchLanEvents, type LanEvent } from './desktop-bridge';

export type RealtimeMode = 'cloud-channel' | 'desktop-longpoll' | 'unsupported';

export interface RealtimeSubscription {
  /** Modalita effettiva utilizzata per la sottoscrizione (utile per logging/test). */
  readonly mode: RealtimeMode;
  /** Chiude la sottoscrizione e libera le risorse (cloud removeChannel / abort fetch). */
  unsubscribe(): void;
}

export interface BroadcastEvent {
  /** Nome dell'evento broadcast (es. `presentation_changed`, `file_added`). */
  event: string;
  /** Payload arbitrario inviato dall'editor del topic. */
  payload: unknown;
}

export interface SubscribeOptions {
  /**
   * Filtro per `event_id` (solo desktop): in cloud i topic Supabase sono gia'
   * scoped al `room:<roomId>`, quindi il filter e' superfluo. In desktop il
   * long-poll del backend Rust ritorna eventi di TUTTI gli eventi dello stesso
   * processo Rust, quindi va filtrato lato client.
   */
  eventId?: string | null;
  /** Callback invocato per ogni evento broadcast ricevuto. */
  onEvent: (evt: BroadcastEvent) => void;
  /**
   * Callback opzionale per status changes (cloud only): SUBSCRIBED, CHANNEL_ERROR,
   * TIMED_OUT, CLOSED. Da usare per UI status badge "LIVE SYNC" / "POLLING".
   */
  onStatus?: (status: 'subscribed' | 'connecting' | 'error' | 'closed') => void;
}

/**
 * Sottoscrive un topic broadcast. In cloud apre un channel Supabase Realtime;
 * in desktop usa long-poll su `/events/stream`. L'unsubscribe e' uniforme.
 *
 * **API minima per Sprint O3**: copre solo broadcast events (no postgres_changes,
 * no presence). Per migrare un hook esistente che usa `supabase.channel().on(
 * 'broadcast', ...)`, si sostituisce la chiamata diretta con questa, mantenendo
 * la firma del callback identica (`(payload) => ...`).
 *
 * Esempio migration:
 * ```ts
 * // PRIMA (cloud-only):
 * const channel = supabase.channel(`room:${id}`).on('broadcast', { event: 'x' }, (p) => {...}).subscribe();
 * return () => supabase.removeChannel(channel);
 *
 * // DOPO (cloud+desktop):
 * const sub = subscribeToTopic(`room:${id}`, {
 *   eventId,
 *   onEvent: ({ event, payload }) => { if (event === 'x') {...} },
 * });
 * return () => sub.unsubscribe();
 * ```
 */
export function subscribeToTopic(
  topic: string,
  options: SubscribeOptions,
): RealtimeSubscription {
  const mode = getBackendMode();

  if (mode === 'cloud') {
    return subscribeViaSupabaseChannel(topic, options);
  }

  if (mode === 'desktop') {
    return subscribeViaDesktopLongPoll(topic, options);
  }

  return { mode: 'unsupported', unsubscribe: () => {} };
}

/**
 * Modalita realtime corrente (utile per UI status / logging).
 * - `cloud-channel`: Supabase Realtime WebSocket attivo (cloud).
 * - `desktop-longpoll`: long-poll Rust attivo (desktop).
 * - `unsupported`: nessuna modalita disponibile (es. backend desktop offline).
 */
export function getRealtimeMode(): RealtimeMode {
  const mode = getBackendMode();
  if (mode === 'cloud') return 'cloud-channel';
  if (mode === 'desktop') {
    const info = getCachedDesktopBackendInfo();
    return info?.base_url ? 'desktop-longpoll' : 'unsupported';
  }
  return 'unsupported';
}

// ── implementazioni interne ───────────────────────────────────────────────

function subscribeViaSupabaseChannel(
  topic: string,
  options: SubscribeOptions,
): RealtimeSubscription {
  const supabase: SupabaseClient<Database> = getSupabaseBrowserClient();
  const channel: RealtimeChannel = supabase
    .channel(topic, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: '*' }, (payload) => {
      const event = (payload as { event?: string }).event ?? 'unknown';
      const data = (payload as { payload?: unknown }).payload ?? payload;
      options.onEvent({ event, payload: data });
    })
    .subscribe((status) => {
      if (!options.onStatus) return;
      if (status === 'SUBSCRIBED') options.onStatus('subscribed');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') options.onStatus('error');
      else if (status === 'CLOSED') options.onStatus('closed');
      else options.onStatus('connecting');
    });

  return {
    mode: 'cloud-channel',
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

function subscribeViaDesktopLongPoll(
  _topic: string,
  options: SubscribeOptions,
): RealtimeSubscription {
  const info = getCachedDesktopBackendInfo();
  const baseUrl = info?.base_url;
  if (!baseUrl) {
    options.onStatus?.('error');
    return { mode: 'unsupported', unsubscribe: () => {} };
  }

  let cancelled = false;
  const ctrl = new AbortController();
  let cursor = 0;

  const dispatch = (evt: LanEvent) => {
    const kind = evt.payload?.kind ?? 'unknown';
    options.onEvent({ event: kind, payload: evt.payload ?? {} });
  };

  void (async () => {
    options.onStatus?.('connecting');
    let hadFirstResponse = false;
    while (!cancelled) {
      try {
        const res = await fetchLanEvents({
          baseUrl,
          since: cursor,
          timeoutMs: 25_000,
          eventId: options.eventId ?? undefined,
          signal: ctrl.signal,
        });
        if (cancelled) return;
        if (!hadFirstResponse) {
          hadFirstResponse = true;
          options.onStatus?.('subscribed');
        }
        if (res.events.length > 0) {
          for (const e of res.events) dispatch(e);
          cursor = Math.max(cursor, res.cursor);
        } else if (res.cursor > cursor) {
          cursor = res.cursor;
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === 'AbortError') return;
        options.onStatus?.('error');
        await sleep(2_000);
      }
    }
  })();

  return {
    mode: 'desktop-longpoll',
    unsubscribe: () => {
      cancelled = true;
      ctrl.abort();
      options.onStatus?.('closed');
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
