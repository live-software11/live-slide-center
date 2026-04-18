import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { Database } from '@slidecenter/shared';

/**
 * Sprint D1+D2+D3 (GUIDA_OPERATIVA_v3 §2.D) — proiezione client-side dei
 * `paired_devices` di una o piu' sale, per la dashboard salute lato admin
 * (`EventDetailView`).
 *
 * Strategia ibrida:
 *  - **Polling 30s** (D2): garantisce che `last_seen_at` venga ri-letto anche
 *    se il channel Realtime e' giu' o se non ci sono nuove scritture sulla
 *    riga (es. un PC fermo da 5 minuti continuera' a leggersi come "rosso"
 *    senza bisogno di trigger).
 *  - **Realtime postgres_changes** (D3): subscribe sui `paired_devices` con
 *    filter `room_id=in.(...)`. L'admin e' autenticato (sessione utente) e
 *    ha policy RLS `tenant_isolation` su `paired_devices`, quindi
 *    `postgres_changes` riceve gli eventi correttamente — diversamente dal
 *    PC sala (Sprint B usa Realtime Broadcast per quel motivo).
 *
 * Output: mappa `roomId -> RoomDevice[]` ordinata per `device_name`.
 *
 * Lo stato derivato `online | warning | offline` viene CALCOLATO a partire
 * da `last_seen_at` lato componente (vedi `RoomDevicesPanel`), NON ricavato
 * dalla colonna enum `status` perche' quest'ultima viene aggiornata solo dal
 * bootstrap e non si "spegne" da sola: un PC che si spegne all'improvviso
 * resterebbe `online` finche' un altro PC non lo notasse. Usare il timestamp
 * `last_seen_at` con soglie (30s/180s) e' piu' affidabile.
 */
export type RoomDevice = Pick<
  Database['public']['Tables']['paired_devices']['Row'],
  | 'id'
  | 'room_id'
  | 'event_id'
  | 'device_name'
  | 'browser'
  | 'last_seen_at'
  | 'paired_at'
  | 'status'
  | 'updated_at'
>;

export type RoomDevicesMap = Record<string, RoomDevice[]>;

export interface UseRoomDevicesResult {
  devices: RoomDevicesMap;
  /** Forza un re-fetch immediato (es. dopo rinomina/rimozione). */
  refresh: () => Promise<void>;
}

export function useRoomDevices(
  roomIds: string[],
  pollIntervalMs = 30_000,
): UseRoomDevicesResult {
  const key = useMemo(() => [...roomIds].sort().join(','), [roomIds]);
  const [map, setMap] = useState<RoomDevicesMap>({});

  const fetchAll = useCallback(async (): Promise<void> => {
    if (!key) return;
    const supabase = getSupabaseBrowserClient();
    const ids = key.split(',').filter(Boolean);
    const { data, error } = await supabase
      .from('paired_devices')
      .select(
        'id, room_id, event_id, device_name, browser, last_seen_at, paired_at, status, updated_at',
      )
      .in('room_id', ids)
      .order('device_name', { ascending: true });
    if (error || !data) return;
    const next: RoomDevicesMap = {};
    for (const row of data) {
      const rid = row.room_id;
      if (!rid) continue;
      if (!next[rid]) next[rid] = [];
      next[rid].push(row);
    }
    setMap(next);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    // Defer first fetch al prossimo tick per non triggerare il warning
    // `react-hooks/set-state-in-effect`: vogliamo che il setState dentro
    // `fetchAll` parta fuori dal render in corso.
    const initialFetchId = window.setTimeout(() => {
      if (cancelled) return;
      void fetchAll();
    }, 0);

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      void fetchAll();
    }, pollIntervalMs);

    // Sprint D3 — Realtime sulle sole righe della sala. Niente debounce: un
    // INSERT/UPDATE/DELETE su `paired_devices` di norma non arriva a raffica.
    const ids = key.split(',').filter(Boolean);
    const filter = `room_id=in.(${ids.join(',')})`;
    const channel = supabase
      .channel(`admin_paired_devices:${key}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'paired_devices', filter },
        () => {
          if (cancelled) return;
          void fetchAll();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearTimeout(initialFetchId);
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [key, pollIntervalMs, fetchAll]);

  return key ? { devices: map, refresh: fetchAll } : EMPTY;
}

const EMPTY: UseRoomDevicesResult = {
  devices: {},
  refresh: async () => { },
};
