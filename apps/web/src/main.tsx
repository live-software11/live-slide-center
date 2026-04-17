import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@/lib/i18n';
import '@/index.css';
import { initSentry } from '@/lib/init-sentry';
import { router } from '@/app/routes';
import { Providers } from '@/app/providers';
import { ErrorBoundary } from '@/app/error-boundary';

void initSentry();

// Stale chunk detection: dopo un deploy Vite genera nuovi hash per i chunk
// dynamic-import. Se il browser ha l'index.html vecchio in cache HTTP, prova
// a caricare un chunk che non esiste piu' e fallisce con MIME mismatch o
// "Failed to fetch dynamically imported module". Soluzione: reload one-shot
// (flag in sessionStorage per evitare loop infiniti su errori reali).
const STALE_CHUNK_RELOAD_KEY = 'sc:stale-chunk-reload';
function isStaleChunkError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message)
  );
}
function tryReloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) return false;
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
// Pulisci il flag dopo 30s in caso di reload riuscito ma nuova navigazione
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}, 30_000);

window.addEventListener('unhandledrejection', (event) => {
  if (isStaleChunkError(event.reason) && tryReloadOnce()) {
    event.preventDefault();
    return;
  }
  void (async () => {
    try {
      const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
      if (dsn && dsn.trim()) {
        const Sentry = await import('@sentry/react');
        Sentry.captureException(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
      }
    } catch {
      // Sentry non disponibile — silenzioso
    }
  })();
});

window.addEventListener('error', (event) => {
  if (isStaleChunkError(event.error ?? event.message)) {
    if (tryReloadOnce()) event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </ErrorBoundary>
  </StrictMode>,
);
