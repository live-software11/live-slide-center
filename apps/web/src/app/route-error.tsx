// ════════════════════════════════════════════════════════════════════════════
// Sprint U-7 — RouteErrorView
// ════════════════════════════════════════════════════════════════════════════
//
// Componente fallback per:
//   1. `errorElement` al root del browser router (cattura ogni throw nei
//      `Component` / `loader` / `action` di React Router v7).
//   2. Catch-all route `path: '*'` per URL che non matchano nessuna rotta
//      definita (es. `/foo/bar` o link rotti).
//
// Sostituisce il banner di default di React Router ("Hey developer 👋")
// con UI brand-coerente in italiano + bottoni "Ricarica" e "Vai alla home".
//
// Casi tipici gestiti:
//   - Utente con PWA cache vecchia che apre URL di una route nuova non
//     ancora presente nel bundle cached → 404 client-side → reload risolve.
//   - Errore di rete durante lazy-load di un chunk di route → reload.
//   - Path digitato male o link condiviso con typo.
// ════════════════════════════════════════════════════════════════════════════
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

export function RouteErrorView() {
  const error = useRouteError();
  const { t } = useTranslation();

  // Distinguiamo 404 (path inesistente o resource not found) da altri errori
  // (es. crash del Component, throw nel loader): UX leggermente diversa.
  const is404 =
    isRouteErrorResponse(error) && error.status === 404;

  const title = is404
    ? t('routeError.notFoundTitle', 'Pagina non trovata')
    : t('routeError.title', 'Si è verificato un errore');

  const description = is404
    ? t(
      'routeError.notFoundDesc',
      'La pagina richiesta non esiste o e\' stata rimossa. Se hai aperto un magic link vecchio, chiedi all\'admin di generarne uno nuovo. Se l\'app sembra disallineata dopo un aggiornamento, prova a ricaricare la pagina.',
    )
    : t(
      'routeError.description',
      'Qualcosa e\' andato storto durante il caricamento. Ricarica la pagina; se il problema persiste contatta il supporto.',
    );

  // In sviluppo mostriamo il messaggio tecnico per debug rapido.
  // In produzione lo nascondiamo (tanto Sentry l'ha gia' catturato lato
  // ErrorBoundary di React in main.tsx).
  const technicalMessage = (() => {
    if (!import.meta.env.DEV) return null;
    if (isRouteErrorResponse(error)) {
      return `${error.status} ${error.statusText}`;
    }
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return null;
  })();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-sc-bg px-6 text-sc-text">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sc-danger/15 text-sc-danger">
        <AlertCircle className="h-7 w-7" aria-hidden />
      </div>

      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-sc-text-secondary">{description}</p>

        {technicalMessage ? (
          <p className="mt-4 rounded-md border border-sc-primary/15 bg-sc-surface px-3 py-2 font-mono text-xs text-sc-text-dim">
            {technicalMessage}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-md bg-sc-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sc-accent-light focus-visible:outline-2 focus-visible:outline-sc-accent"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('routeError.reload', 'Ricarica')}
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-md border border-sc-primary/20 px-4 py-2 text-sm font-medium text-sc-text transition hover:bg-sc-primary/10"
        >
          <Home className="h-4 w-4" aria-hidden />
          {t('routeError.home', 'Vai alla home')}
        </Link>
      </div>
    </div>
  );
}

// Esporta anche come `Component` per potere usare `lazy` con la stessa
// convenzione delle altre view (anche se qui lo usiamo direttamente come
// `errorElement` / `element`).
export { RouteErrorView as Component };
export default RouteErrorView;
