import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from '@slidecenter/shared';
import { fetchRecentActivity } from '../repository';

type ActivityRow = Database['public']['Tables']['activity_log']['Row'];

const POLL_INTERVAL_MS = 10_000;

export function useActivityFeed(eventId: string | null) {
  const [entries, setEntries] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await fetchRecentActivity(eventId);
      setEntries(data);
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    void reload();

    intervalRef.current = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [eventId, reload]);

  return { entries, loading, error, reload };
}
