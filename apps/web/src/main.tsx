import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@/lib/i18n';
import '@/index.css';
import { initSentry } from '@/lib/init-sentry';
import { router } from '@/app/routes';
import { Providers } from '@/app/providers';
import { ErrorBoundary } from '@/app/error-boundary';
import { ensureDesktopBackendReady } from '@/lib/desktop-backend-init';
import { getBackendMode } from '@/lib/backend-mode';

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

// Sprint O2 (GUIDA_OPERATIVA_v3 §4.G): in modalita desktop il client Supabase JS
// e' configurato per parlare al backend Rust locale. Il `base_url` + `admin_token`
// arrivano da `cmd_backend_info` (async). Aspettiamo l'init prima di renderizzare
// cosi' il primo `getSupabaseBrowserClient()` da qualsiasi feature trova il cache
// gia' popolato. In cloud questa funzione e' un no-op immediato.
async function bootstrap() {
  if (getBackendMode() === 'desktop') {
    try {
      await ensureDesktopBackendReady();
    } catch (err) {
      // Backend Rust non risponde / non bootato: mostra errore esplicito invece
      // di crashare con stack trace incomprensibile. L'utente puo' riavviare l'app.
      const message = err instanceof Error ? err.message : String(err);
      const root = document.getElementById('root')!;
      root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0e1a;color:#e2e8f0;font-family:system-ui;padding:2rem;text-align:center;flex-direction:column;gap:1rem;">
        <h1 style="font-size:1.5rem;margin:0;">Backend desktop non disponibile</h1>
        <p style="opacity:0.7;max-width:480px;">Il server locale Slide Center non risponde. Riavvia l'applicazione. Se il problema persiste, controlla i log in <code>~/SlideCenter/</code>.</p>
        <code style="opacity:0.5;font-size:0.75rem;background:#1e293b;padding:0.5rem 1rem;border-radius:6px;">${message}</code>
      </div>`;
      return;
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <Providers>
          <RouterProvider router={router} />
        </Providers>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
