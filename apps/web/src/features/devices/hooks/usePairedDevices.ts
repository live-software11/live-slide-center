import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { listPairedDevices, type PairedDevice } from '../repository';

interface UsePairedDevicesReturn {
  devices: PairedDevice[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePairedDevices(eventId: string): UsePairedDevicesReturn {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPairedDevices(eventId);
      setDevices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!eventId) return;

    void fetch();

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`paired_devices:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'paired_devices',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setDevices((prev) => [payload.new as PairedDevice, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setDevices((prev) =>
              prev.map((d) =>
                d.id === (payload.new as PairedDevice).id ? (payload.new as PairedDevice) : d,
              ),
            );
          } else if (payload.eventType === 'DELETE') {
            setDevices((prev) => prev.filter((d) => d.id !== (payload.old as PairedDevice).id));
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  return { devices, loading, error, refresh: fetch };
}
