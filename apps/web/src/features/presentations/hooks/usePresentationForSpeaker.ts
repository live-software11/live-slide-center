import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import {
  fetchPresentationForSpeaker,
  type PresentationBundle,
} from '@/features/presentations/repository';

// Hook dati per una presentation legata a uno speaker.
// Integra Supabase Realtime su presentations + presentation_versions:
// qualsiasi upload dal portale relatore o cambio stato si riflette in UI
// senza refresh manuale.
export function usePresentationForSpeaker(speakerId: string | null, enabled: boolean) {
  const [bundle, setBundle] = useState<PresentationBundle>({ presentation: null, versions: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => void>(() => {});

  const reload = useCallback(async () => {
    if (!speakerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPresentationForSpeaker(speakerId);
      setBundle(res);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [speakerId]);
  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled || !speakerId) return;
    void reload();
  }, [enabled, speakerId, reload]);

  useEffect(() => {
    if (!enabled || !speakerId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`presentation-speaker-${speakerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presentations', filter: `speaker_id=eq.${speakerId}` },
        () => {
          reloadRef.current();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presentation_versions' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { presentation_id?: string } | null;
          if (!row?.presentation_id) return;
          if (bundle.presentation && row.presentation_id === bundle.presentation.id) {
            reloadRef.current();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, speakerId, bundle.presentation]);

  return { bundle, loading, error, reload };
}
