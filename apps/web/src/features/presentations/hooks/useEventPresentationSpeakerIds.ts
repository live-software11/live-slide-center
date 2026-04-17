import { useCallback, useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';

// Hook leggero: ritorna l'insieme degli `speaker_id` che hanno una presentation
// nell'evento corrente. Usato per filtrare i target del dialog "Sposta presentazione"
// (uno speaker target NON puo' avere gia' una presentation).
//
// Realtime-aware: re-fetch quando arrivano eventi su `presentations` con event_id
// corrispondente.

async function fetchSpeakerIdsWithPresentation(eventId: string): Promise<Set<string> | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('presentations')
    .select('speaker_id')
    .eq('event_id', eventId);
  if (error || !data) return null;
  const ids = new Set<string>();
  for (const r of data) {
    if (r.speaker_id) ids.add(r.speaker_id);
  }
  return ids;
}

export function useEventPresentationSpeakerIds(eventId: string | null) {
  // Pattern "derived state during render" raccomandato da React docs:
  // se l'eventId cambia, resettiamo lo state durante il render senza chiamare
  // setState dentro useEffect (vietato dalla regola react-hooks/set-state-in-effect).
  const [trackedEventId, setTrackedEventId] = useState<string | null>(eventId);
  const [speakerIds, setSpeakerIds] = useState<Set<string>>(new Set());

  if (trackedEventId !== eventId) {
    setTrackedEventId(eventId);
    setSpeakerIds(new Set());
  }

  const reload = useCallback(async () => {
    if (!eventId) return;
    const next = await fetchSpeakerIdsWithPresentation(eventId);
    if (next) setSpeakerIds(next);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => {
      void (async () => {
        const next = await fetchSpeakerIdsWithPresentation(eventId);
        if (!cancelled && next) setSpeakerIds(next);
      })();
    };
    refresh();
    const channel = supabase
      .channel(`event-presentations-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presentations', filter: `event_id=eq.${eventId}` },
        refresh,
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { speakerIdsWithPresentation: speakerIds, reload };
}
