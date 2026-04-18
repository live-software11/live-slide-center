import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export interface SidebarEventLite {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface SidebarDeviceLite {
  id: string;
  device_name: string;
  status: 'online' | 'offline' | 'degraded' | null;
  event_id: string | null;
  room_id: string | null;
  last_seen_at: string | null;
}

export interface SidebarData {
  events: SidebarEventLite[];
  devices: SidebarDeviceLite[];
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: SidebarData }
  | { status: 'error'; message: string };

const EMPTY: SidebarData = { events: [], devices: [] };

/**
 * Sprint U-1: hook condiviso per popolare la Sidebar AppShell.
 * Carica top-N eventi recenti + tutti i PC sala del tenant (RLS-isolato).
 * Refresh manuale via `reload()`. Non sottoscrive Realtime per ora (le
 * subscriptions sui singoli eventi rimangono nelle viste dedicate).
 */
export function useSidebarData(tenantId: string | null) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const supabase = useMemo<SupabaseClient<Database>>(() => getSupabaseBrowserClient(), []);

  const load = useCallback(async () => {
    if (!tenantId) {
      setState({ status: 'ready', data: EMPTY });
      return;
    }
    setState({ status: 'loading' });
    try {
      const [eventsRes, devicesRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, name, start_date, end_date, status')
          .order('start_date', { ascending: false })
          .limit(20),
        supabase
          .from('paired_devices')
          .select('id, device_name, status, event_id, room_id, last_seen_at')
          .order('paired_at', { ascending: false })
          .limit(60),
      ]);
      if (eventsRes.error) throw new Error(eventsRes.error.message);
      if (devicesRes.error) throw new Error(devicesRes.error.message);
      setState({
        status: 'ready',
        data: {
          events: (eventsRes.data ?? []) as SidebarEventLite[],
          devices: (devicesRes.data ?? []) as SidebarDeviceLite[],
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'load_failed';
      setState({ status: 'error', message });
    }
  }, [supabase, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
