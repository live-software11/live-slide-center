import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, X } from 'lucide-react';
import { useEventFileSearch } from '../hooks/useEventFileSearch';
import type { EventFileSearchResult } from '../lib/event-file-search';

/**
 * Sprint F (GUIDA_OPERATIVA_v3 §3.A) — search file globale per evento.
 *
 * Pattern: combobox WAI-ARIA 1.2 (`role="combobox"` su input, `role="listbox"`
 * sul dropdown, `role="option"` su ogni risultato). Tastiera:
 *  - ↓ / ↑: muove l'highlight nel dropdown (con wrap-around).
 *  - Enter: seleziona (chiama `onSelectResult` + chiude).
 *  - Esc: chiude e riporta focus all'input.
 *  - Click esterno: chiude.
 *
 * Sticky: il container ha `sticky top-0 z-30` (z sopra agli `EventDetailView`
 * panel ma sotto i modal/dialog). Backdrop blur per leggibilita' su contenuto
 * scrollante sotto.
 *
 * NB: NON spostiamo il focus al risultato selezionato dopo Enter — l'utente
 * deve restare sull'input se vuole cercare ancora. Lo scroll lo fa la pagina,
 * il focus segue al `<li>` della sessione (vedi `EventDetailView`).
 */

interface EventSearchBarProps {
  eventId: string;
  /** Chiamato quando l'utente seleziona un risultato (Enter o click). */
  onSelectResult: (result: EventFileSearchResult) => void;
}

export function EventSearchBar({ eventId, onSelectResult }: EventSearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const { results, loading, error, truncated, belowMinLength } = useEventFileSearch(
    eventId,
    query,
  );

  // Quando cambiano i risultati resettiamo l'highlight: il primo elemento
  // della nuova lista e' il piu' rilevante (sort version_number desc).
  // Pattern "derived state during render" via useState (React docs): evita la
  // lint rule `react-hooks/set-state-in-effect` (no setState in useEffect)
  // e la lint rule `react-hooks/refs` (no ref access in render).
  const [trackedResults, setTrackedResults] = useState(results);
  if (trackedResults !== results) {
    setTrackedResults(results);
    setActiveIndex(results.length > 0 ? 0 : -1);
  }

  // Click esterno → chiudi dropdown ma NON resettare la query (l'utente
  // potrebbe rifocalizzare e continuare).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else setOpen(false);
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIndex >= 0 ? activeIndex : 0];
      if (r) {
        onSelectResult(r);
        setOpen(false);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(results.length - 1);
    }
  };

  const showDropdown =
    open && (loading || error !== null || results.length > 0 || query.trim().length > 0);
  const activeOptionId = useMemo(
    () => (activeIndex >= 0 && results[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined),
    [activeIndex, results, listboxId],
  );

  return (
    <div ref={containerRef} className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 lg:-mx-8 lg:-mt-8">
      <div className="border-b border-sc-primary/10 bg-sc-bg/85 px-6 py-3 backdrop-blur lg:px-8">
        <div className="relative max-w-3xl">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sc-text-muted"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeOptionId}
              placeholder={t('eventSearch.placeholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKey}
              className="w-full rounded-xl border border-sc-primary/20 bg-sc-surface py-2 pl-9 pr-9 text-sm outline-none ring-sc-ring/30 focus:ring-2"
            />
            {query && (
              <button
                type="button"
                aria-label={t('eventSearch.clear')}
                onClick={() => {
                  setQuery('');
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-sc-text-muted hover:bg-sc-elevated"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {showDropdown && (
            <div
              role="listbox"
              id={listboxId}
              className="absolute left-0 right-0 top-full mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-sc-primary/15 bg-sc-surface shadow-xl"
            >
              {belowMinLength && (
                <p className="px-4 py-3 text-xs text-sc-text-dim">
                  {t('eventSearch.belowMinLength')}
                </p>
              )}
              {!belowMinLength && loading && results.length === 0 && (
                <p className="flex items-center gap-2 px-4 py-3 text-xs text-sc-text-dim">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  {t('eventSearch.loading')}
                </p>
              )}
              {!belowMinLength && error && (
                <p className="px-4 py-3 text-xs text-sc-danger" role="alert">
                  {t('eventSearch.error')}
                </p>
              )}
              {!belowMinLength && !loading && !error && results.length === 0 && query.trim().length > 0 && (
                <p className="px-4 py-3 text-xs text-sc-text-dim">
                  {t('eventSearch.noResults', { query: query.trim() })}
                </p>
              )}
              {results.length > 0 && (
                <ul className="divide-y divide-sc-primary/10">
                  {results.map((r, i) => {
                    const active = i === activeIndex;
                    return (
                      <li
                        key={r.versionId}
                        role="option"
                        id={`${listboxId}-opt-${i}`}
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(i)}
                        onMouseDown={(e) => {
                          // mousedown invece di click: previene il blur dell'input
                          // che chiuderebbe il dropdown prima dell'onClick.
                          e.preventDefault();
                          onSelectResult(r);
                          setOpen(false);
                        }}
                        className={`cursor-pointer px-4 py-2 text-sm ${active ? 'bg-sc-elevated' : 'hover:bg-sc-elevated/60'}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate font-medium text-sc-text">
                            {r.fileName}
                          </p>
                          {r.isCurrent && (
                            <span className="shrink-0 rounded-md bg-sc-success/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sc-success">
                              {t('eventSearch.current')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-sc-text-dim">
                          {[r.roomName, r.sessionTitle, r.speakerName]
                            .filter((x): x is string => Boolean(x))
                            .join(' · ')}
                          {' · v'}
                          {r.versionNumber}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {truncated && (
                <p className="border-t border-sc-primary/10 px-4 py-2 text-[11px] text-sc-text-muted">
                  {t('eventSearch.truncated')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
