// ════════════════════════════════════════════════════════════════════════════
// Sprint Z (post-field-test) Gap C — useLastSession (Tauri-only)
// ════════════════════════════════════════════════════════════════════════════
//
// Obiettivo: dopo un crash/blackout/restart, il PC sala torna esattamente
// sull'ultima session/presentation/slide proiettata, senza richiedere
// interazione utente — niente "buco nero" durante un evento dal vivo.
//
// Architettura:
//   - lettura at-mount via Tauri command `cmd_get_last_session` (in cloud
//     ritorna `null`, lo hook diventa quindi un no-op senza causare errori).
//   - `save(partial)` fa merge dei campi modificati e chiama
//     `cmd_save_last_session` con throttle (max 1 write/2s) per non
//     bombardare il filesystem ad ogni tick di polling.
//
// Pattern integrazione (vedi `RoomPlayerView.tsx`):
//   const { lastSession, save } = useLastSession();
//   useEffect(() => {
//     if (!device || !roomData) return;
//     save({
//       device_token: token,
//       event_id: roomData.eventId,
//       room_id: roomData.id,
//       current_presentation_id: ...,
//       current_session_id: roomData.currentSession?.id ?? null,
//       ...
//     });
//   }, [device, roomData, ...]);
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLastSession,
  saveLastSession,
  type LastSession,
} from '@/lib/desktop-bridge';
import { isRunningInTauri } from '@/lib/backend-mode';

const SCHEMA_VERSION = 1;
const SAVE_THROTTLE_MS = 2_000;

export type LastSessionPatch = Partial<Omit<LastSession, 'schema' | 'saved_at'>>;

interface UseLastSessionReturn {
  /** Snapshot all'avvio. Resta `null` in cloud o se non c'era niente salvato. */
  lastSession: LastSession | null;
  /** True dopo il primo `getLastSession()` async at-mount. */
  loaded: boolean;
  /**
   * Merge + persist. Throttled: chiamate ravvicinate vengono coalescenti
   * fino a 2s. In cloud e' no-op.
   */
  save: (patch: LastSessionPatch) => void;
  /** Reset locale (non cancella il file su disco — quello e' compito di
   * `clearDevicePairing` lato Tauri).
   */
  clear: () => void;
}

export function useLastSession(): UseLastSessionReturn {
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  const currentRef = useRef<LastSession | null>(null);
  const pendingRef = useRef<LastSessionPatch | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = isRunningInTauri() ? await getLastSession() : null;
      if (cancelled) return;
      currentRef.current = session;
      setLastSession(session);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const flush = useCallback(async () => {
    timerRef.current = null;
    const patch = pendingRef.current;
    if (!patch) return;
    pendingRef.current = null;

    // Default vuoti: schema versionato + ts now.
    const merged: LastSession = {
      schema: SCHEMA_VERSION,
      device_token: patch.device_token ?? currentRef.current?.device_token ?? '',
      event_id: patch.event_id ?? currentRef.current?.event_id ?? '',
      room_id: patch.room_id !== undefined ? patch.room_id : currentRef.current?.room_id ?? null,
      current_presentation_id:
        patch.current_presentation_id !== undefined
          ? patch.current_presentation_id
          : currentRef.current?.current_presentation_id ?? null,
      current_session_id:
        patch.current_session_id !== undefined
          ? patch.current_session_id
          : currentRef.current?.current_session_id ?? null,
      current_slide_index:
        patch.current_slide_index !== undefined
          ? patch.current_slide_index
          : currentRef.current?.current_slide_index ?? null,
      current_slide_total:
        patch.current_slide_total !== undefined
          ? patch.current_slide_total
          : currentRef.current?.current_slide_total ?? null,
      saved_at: new Date().toISOString(),
    };

    // Pre-condizione: device_token + event_id obbligatori. Se mancano (es.
    // la SPA non ha ancora ricevuto il bootstrap) skippiamo: meglio NON
    // scrivere che scrivere un blob inutilizzabile al restore.
    if (!merged.device_token || !merged.event_id) return;

    currentRef.current = merged;
    setLastSession(merged);

    if (!isRunningInTauri()) return;
    try {
      await saveLastSession(merged);
    } catch {
      /* best-effort: la perdita di un save non rompe il polling normale */
    }
  }, []);

  const save = useCallback(
    (patch: LastSessionPatch) => {
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        void flush();
      }, SAVE_THROTTLE_MS);
    },
    [flush],
  );

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    currentRef.current = null;
    setLastSession(null);
  }, []);

  return { lastSession, loaded, save, clear };
}
