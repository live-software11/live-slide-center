// ════════════════════════════════════════════════════════════════════════════
// useMediaQuery — match dinamico di una CSS media query lato client.
// ════════════════════════════════════════════════════════════════════════════
//
// Serve nei casi in cui occorre rendering condizionale per breakpoint (e non
// solo display:none via Tailwind), ad es. per evitare di duplicare componenti
// pesanti o creare problemi di accessibilita' (DOM con due copie dello stesso
// landmark, una nascosta solo via CSS, viene letta due volte dagli screen
// reader).
//
// Uso:
//   const isLgUp = useMediaQuery('(min-width: 1024px)');
//
// Implementazione: useSyncExternalStore — il pattern raccomandato React 19
// per sorgenti dati esterne. Evita il warning `react-hooks/set-state-in-effect`
// che scatterebbe con un useState + useEffect "ingenuo".
//
// SSR-safe: l'app e' SPA Vite (no SSR). In ambienti server-side il valore
// iniziale e' `false` (assenza di window).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useSyncExternalStore } from 'react';

function getServerSnapshot(): boolean {
  return false;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    [query],
  );

  const getSnapshot = useCallback((): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const;
