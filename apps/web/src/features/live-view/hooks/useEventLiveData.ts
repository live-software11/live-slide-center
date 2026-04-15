import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchLiveEventSnapshot, type LiveEventSnapshot } from '../repository';

export function useEventLiveData(eventId: string | null) {
  const [snapshot, setSnapshot] = useState<LiveEventSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => void>(() => { });

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
        () => reloadRef.current(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presentation_versions' },
        () => reloadRef.current(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `event_id=eq.${eventId}` },
        () => reloadRef.current(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `event_id=eq.${eventId}` },
        () => reloadRef.current(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'speakers', filter: `event_id=eq.${eventId}` },
        () => reloadRef.current(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { snapshot, loading, error, reload };
}
