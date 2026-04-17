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

// Cattura Promise rifiutate non gestite — wired a Sentry se DSN configurato
window.addEventListener('unhandledrejection', (event) => {
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </ErrorBoundary>
  </StrictMode>,
);
