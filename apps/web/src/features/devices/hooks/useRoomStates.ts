import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { Database } from '@slidecenter/shared';

/**
 * Sprint A6 (GUIDA_OPERATIVA_v3 §2.A6) — proiezione client-side dello stato
 * `room_state` per le sale di un evento. Serve all'admin (`EventDetailView`)
 * per mostrare in tempo "quasi-reale" la modalita di playback dichiarata dal
 * PC sala (`auto`/`live`/`turbo`) e lo stato di sync.
 *
 * Sprint I (GUIDA_OPERATIVA_v3 §3.E E4) — esposto anche `current_presentation_id`
 * + `last_play_started_at` per il badge "In onda" lato admin. Il nome del
 * file viene risolto via JOIN nested (`presentations -> presentation_versions`)
 * per evitare un secondo round-trip.
 *
 * Implementazione: polling semplice ogni `pollIntervalMs` (default 30s). Non
 * usiamo Realtime channels per non aggiungere complessita: la cadenza minima
 * con cui il PC sala dichiara la modalita e' 12s (polling auto), quindi 30s
 * lato admin e' piu' che sufficiente per rendere viva la dashboard. Per lo
 * Sprint I "now playing" 30s e' anche piu' del necessario perche' l'admin
 * vuole solo sapere COSA viene proiettato in linea di massima, non avere il
 * cronometro al millisecondo.
 */
export type RoomStateRow = Pick<
  Database['public']['Tables']['room_state']['Row'],
  | 'room_id'
  | 'sync_status'
  | 'playback_mode'
  | 'last_sync_at'
  | 'agent_connection'
  | 'current_presentation_id'
  | 'last_play_started_at'
> & {
  /** Sprint I: nome del file in onda (resolved via JOIN). NULL se nessun file aperto. */
  current_file_name: string | null;
};

export type RoomStatesMap = Record<string, RoomStateRow>;

interface RoomStateRawRow {
  room_id: string;
  sync_status: Database['public']['Tables']['room_state']['Row']['sync_status'];
  playback_mode: Database['public']['Tables']['room_state']['Row']['playback_mode'];
  last_sync_at: string | null;
  agent_connection: Database['public']['Tables']['room_state']['Row']['agent_connection'];
  current_presentation_id: string | null;
  last_play_started_at: string | null;
  // Embedded join: la presentation in onda + la sua version corrente.
  // PostgREST ritorna l'embed come oggetto (relazione 1:1) o null.
  current_presentation: {
    current_version_id: string | null;
    current_version: { file_name: string } | null;
  } | null;
}

export function useRoomStates(roomIds: string[], pollIntervalMs = 30_000): RoomStatesMap {
  // Memoizzo la "chiave" stabile (ids ordinati) per evitare di ri-creare
  // l'effect ad ogni render quando l'array `roomIds` ha la stessa identita
  // logica ma diversa identita referenziale.
  const key = useMemo(() => [...roomIds].sort().join(','), [roomIds]);
  const [map, setMap] = useState<RoomStatesMap>({});

  useEffect(() => {
    // Niente sale: salta del tutto l'effect per non triggerare cascading renders
    // (lint rule react-hooks/set-state-in-effect). Lo stato eventualmente
    // residuo non e' visibile in UI (nessuna riga sala da renderizzare).
    if (!key) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    const ids = key.split(',').filter(Boolean);

    const fetchAll = async () => {
      // PostgREST embed: `current_presentation:current_presentation_id` segue
      // la FK e ritorna la presentation; dentro `current_version:current_version_id`
      // ritorna la version. Nested 2-livelli, una sola query.
      // RLS `tenant_isolation` garantisce che vediamo solo i dati del tenant.
      const { data, error } = await supabase
        .from('room_state')
        .select(
          `room_id, sync_status, playback_mode, last_sync_at, agent_connection,
           current_presentation_id, last_play_started_at,
           current_presentation:current_presentation_id (
             current_version_id,
             current_version:current_version_id ( file_name )
           )`,
        )
        .in('room_id', ids);
      if (cancelled || error || !data) return;
      const next: RoomStatesMap = {};
      for (const row of data as unknown as RoomStateRawRow[]) {
        next[row.room_id] = {
          room_id: row.room_id,
          sync_status: row.sync_status,
          playback_mode: row.playback_mode,
          last_sync_at: row.last_sync_at,
          agent_connection: row.agent_connection,
          current_presentation_id: row.current_presentation_id,
          last_play_started_at: row.last_play_started_at,
          current_file_name: row.current_presentation?.current_version?.file_name ?? null,
        };
      }
      setMap(next);
    };

    void fetchAll();
    const id = window.setInterval(() => void fetchAll(), pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [key, pollIntervalMs]);

  // Se non ci sono sale, ritorna un oggetto vuoto stabile senza coinvolgere lo
  // stato React (cosi' evitiamo setState nell'effect).
  return key ? map : EMPTY_MAP;
}

const EMPTY_MAP: RoomStatesMap = {};
