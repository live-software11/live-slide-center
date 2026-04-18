import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchLiveEventSnapshot, type LiveEventSnapshot } from '../repository';

/**
 * Hook live snapshot evento.
 *
 * Audit-fix AU-06 (2026-04-18): debounce 200ms su reload realtime.
 * Quando l'admin sposta in batch 5+ presentations, arrivano 5 postgres_changes
 * in <200ms; senza debounce facevamo 5 fetch consecutivi (waste banda + CPU
 * + flicker UI). Con debounce: 1 sola fetch dopo 200ms di quiete.
 */
export function useEventLiveData(eventId: string | null) {
  const [snapshot, setSnapshot] = useState<LiveEventSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => void>(() => { });
  const debounceTimerRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await fetchLiveEventSnapshot(eventId);
      setSnapshot(data);
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  reloadRef.current = reload;

  // Debounced trigger: se piu' eventi arrivano in <200ms, riarma il timer
  // ed esegui un solo reload dopo l'ultimo evento.
  const scheduleReload = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      reloadRef.current();
    }, 200);
  }, []);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    void reload();
  }, [eventId, reload]);

  useEffect(() => {
    if (!eventId) return;
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`live-view:${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presentations', filter: `event_id=eq.${eventId}` },
        () => scheduleReload(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presentation_versions' },
        () => scheduleReload(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `event_id=eq.${eventId}` },
        () => scheduleReload(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `event_id=eq.${eventId}` },
        () => scheduleReload(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'speakers', filter: `event_id=eq.${eventId}` },
        () => scheduleReload(),
      )
      // Sprint U-3 (On Air): ascolto room_state per il "Now Playing" live.
      // Niente filter event_id (room_state non lo ha), filtro lato hook
      // tramite il roomIds del snapshot — accetto reload spurio cross-evento
      // che e' raro e debounced.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_state' },
        () => scheduleReload(),
      )
      .subscribe();

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [eventId, scheduleReload]);

  return { snapshot, loading, error, reload };
}
