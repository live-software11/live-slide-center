// ════════════════════════════════════════════════════════════════════════════
// Sprint Z (post-field-test) Gap A — useNetworkMap hook
// ════════════════════════════════════════════════════════════════════════════
//
// Carica i NetworkNode (view tenant_network_map) e si tiene allineato in
// realtime con due channel postgres_changes:
//   - public.paired_devices  (status, last_seen_at, room_id, event_id)
//   - public.desktop_devices (status, last_seen_at, app_version)
//
// Pattern allineato a `usePairedDevices.ts` e `useRoomDevices.ts` (Sprint
// D1+D3). NB: la view in se' non riceve eventi postgres_changes (le view
// non sono pubblicate via realtime), quindi sub-scribiamo le 2 base table
// e su ogni evento ri-fetchiamo la view. Cosi' lo `derived_status` (calcolato
// da now() lato DB) resta aggiornato senza dover replicare la logica nel
// client.
//
// Tick periodico aggiuntivo: ogni 30 s ri-fetchiamo per coprire il caso di
// "nessun update in DB ma il timer ha appena attraversato la soglia 30s/5min".
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import {
  fetchEventAndRoomNames,
  listNetworkNodes,
  type NetworkNode,
} from './repository';

interface UseNetworkMapReturn {
  nodes: NetworkNode[];
  eventNames: Map<string, string>;
  roomNames: Map<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const REFRESH_TICK_MS = 30_000;

export function useNetworkMap(): UseNetworkMapReturn {
  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [eventNames, setEventNames] = useState<Map<string, string>>(new Map());
  const [roomNames, setRoomNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await listNetworkNodes();
      if (cancelledRef.current) return;
      setNodes(data);
      const eventIds = Array.from(
        new Set(data.map((n) => n.event_id).filter((v): v is string => Boolean(v))),
      );
      const roomIds = Array.from(
        new Set(data.map((n) => n.room_id).filter((v): v is string => Boolean(v))),
      );
      try {
        const { events, rooms } = await fetchEventAndRoomNames(eventIds, roomIds);
        if (cancelledRef.current) return;
        setEventNames(events);
        setRoomNames(rooms);
      } catch {
        // Lookup nomi best-effort: se fallisce mostriamo gli UUID, ma la
        // tabella resta comunque utilizzabile (status + last_seen + actions).
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    // NB: `loading` parte gia' a true in useState, quindi non lo settiamo
    // qui (regola `react-hooks/set-state-in-effect`). L'effetto e' montato
    // una sola volta — refresh() ha deps vuote — e mette `loading=false`
    // appena la prima fetch ritorna.
    void (async () => {
      await refresh();
      if (!cancelledRef.current) setLoading(false);
    })();

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel('tenant_network_map')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'paired_devices' },
        () => {
          void refresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'desktop_devices' },
        () => {
          void refresh();
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_TICK_MS);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { nodes, eventNames, roomNames, loading, error, refresh };
}
