/** Fase 14: inizializza Sentry solo se `VITE_SENTRY_DSN` è definito. Import dinamico evita bundle cost quando DSN assente. */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof dsn !== 'string' || dsn.trim() === '') return;

  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn: dsn.trim(),
    environment: import.meta.env.MODE,
    release: `slidecenter-web@${import.meta.env.VITE_APP_VERSION ?? '0.0.0'}`,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });
}
