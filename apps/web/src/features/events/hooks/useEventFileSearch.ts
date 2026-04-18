import { useEffect, useState } from 'react';
import {
  MAX_RESULTS,
  MIN_QUERY_LENGTH,
  searchEventFiles,
  type EventFileSearchResult,
} from '../lib/event-file-search';

/**
 * Sprint F (GUIDA_OPERATIVA_v3 §3.A) — hook per la search file.
 *
 * Comportamento:
 *  - Debounce 250ms: l'utente puo' digitare velocemente senza far partire una
 *    chiamata per ogni keystroke. Sotto 250ms tra due tasti, la query parte
 *    solo all'ultimo. Soglia testata su touch-typers (~150-200 tasti/min).
 *  - Abort: ogni rerun dell'effect (cambio query) cancella l'AbortController
 *    della run precedente (cleanup di useEffect). Niente race "vince l'ultima
 *    che ritorna".
 *  - Sotto la soglia minima (`MIN_QUERY_LENGTH`), ritorniamo subito vuoto
 *    senza chiamare il DB e con `loading: false`.
 *  - Errori: catturati, esposti come `error`, non lanciati. La UI mostra il
 *    fallback ("ricerca non disponibile, riprova").
 *
 * Esposto:
 *  - `results`: array (max `MAX_RESULTS`).
 *  - `loading`: true durante una chiamata in volo (incluso il debounce wait).
 *  - `error`: messaggio di errore o null.
 *  - `truncated`: true se `results.length === MAX_RESULTS` (probabilmente ci
 *    sono altri risultati, l'utente deve raffinare la query).
 */

export interface UseEventFileSearchResult {
  results: EventFileSearchResult[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  /** True se la query e' troppo corta per partire (sotto MIN_QUERY_LENGTH). */
  belowMinLength: boolean;
}

const DEBOUNCE_MS = 250;

export function useEventFileSearch(eventId: string, query: string): UseEventFileSearchResult {
  const trimmed = query.trim();
  const belowMinLength = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const queryActive = Boolean(eventId) && trimmed.length >= MIN_QUERY_LENGTH;
  const queryKey = `${eventId}|${trimmed}`;

  // Pattern "derived state during render" (React docs): se la query effettiva
  // cambia, resettiamo lo state qui invece di farlo dentro un useEffect (regola
  // lint `react-hooks/set-state-in-effect`). Tracciamo (eventId|trimmed) come
  // chiave: cambia → resetta tutto. Usiamo `useState` per il tracking — NON
  // `useRef`, perche' la regola `react-hooks/refs` vieta l'accesso ai ref in
  // render.
  const [trackedKey, setTrackedKey] = useState(queryKey);
  const [results, setResults] = useState<EventFileSearchResult[]>([]);
  const [loading, setLoading] = useState(queryActive);
  const [error, setError] = useState<string | null>(null);

  if (trackedKey !== queryKey) {
    setTrackedKey(queryKey);
    setResults([]);
    setError(null);
    setLoading(queryActive);
  }

  useEffect(() => {
    if (!queryActive) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await searchEventFiles(eventId, trimmed, controller.signal);
          if (controller.signal.aborted) return;
          setResults(data);
          setLoading(false);
        } catch (err) {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : 'search_failed');
          setResults([]);
          setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      // Cleanup: aborta sia il debounce timer che la fetch in volo. Il cleanup
      // viene chiamato anche quando il componente smonta o quando cambia la
      // query (= rerun dell'effect).
      controller.abort();
    };
  }, [eventId, trimmed, queryActive]);

  return {
    results,
    loading,
    error,
    truncated: results.length === MAX_RESULTS,
    belowMinLength,
  };
}
