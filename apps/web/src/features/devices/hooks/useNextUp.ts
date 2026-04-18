import { useEffect, useRef, useState } from 'react';
import { getNextUpForRoom, type NextUpInfo } from '@/features/presentations/repository';

/**
 * Sprint T-3-E (G10) — hook che risolve "in onda + prossimo file" per una room.
 *
 * Triggers:
 *  - mount/unmount: prima fetch immediata.
 *  - polling `pollIntervalMs` (default 30s, allineato a `useRoomStates`).
 *  - cambio di `versionTrigger` opzionale (es. broadcast `room_state_changed`
 *    oppure trigger esterno: forza refetch ignorando il polling timer).
 *
 * Niente Realtime Channels qui: la dashboard admin gia' polla `useRoomStates`
 * ogni 30s e usa `versionTrigger = roomState.last_play_started_at` per
 * piggy-back-care la fresh info quando il PC sala apre un nuovo file.
 *
 * NB: il fetch chiama un solo round-trip PostgREST. Per una sala con scaletta
 * di ~30 file e' praticamente istantaneo (<50 ms).
 */
export function useNextUp(input: {
  roomId: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  /** Trigger esterno: ogni cambio forza un refetch immediato. */
  versionTrigger?: string | number | null;
}): {
  data: NextUpInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { roomId, enabled = true, pollIntervalMs = 30_000, versionTrigger = null } = input;
  const [data, setData] = useState<NextUpInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !roomId) return;

    let cancelled = false;

    const fetchOnce = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (!data) setLoading(true);
      try {
        const next = await getNextUpForRoom(roomId);
        if (cancelled || !mountedRef.current) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (cancelled || !mountedRef.current) return;
        setError((e as { message?: string })?.message ?? 'next_up_failed');
      } finally {
        inFlightRef.current = false;
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    };

    void fetchOnce();
    const id = window.setInterval(() => void fetchOnce(), pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // `data` viene volutamente NON inserito tra le deps: serve solo a decidere
    // se mostrare lo skeleton iniziale, non a triggerare nuovi fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, enabled, pollIntervalMs, versionTrigger, tick]);

  return {
    data,
    loading,
    error,
    refresh: () => setTick((t) => t + 1),
  };
}
