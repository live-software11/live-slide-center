/**
 * Sprint E2 (GUIDA_OPERATIVA_v3 §2.E2) — telemetry minimale per errori
 * critici Room Player.
 *
 * Sentry e' gia' inizializzato in `lib/init-sentry.ts` (Phase 14, lazy
 * import quando `VITE_SENTRY_DSN` e' presente). Gli `unhandledrejection`
 * e gli errori React sono gia' catturati da `error-boundary.tsx` e
 * `main.tsx`. Questa helper serve per gli errori "expected" che oggi
 * vengono silenziati con `try/catch` ma vorremmo comunque tracciare con
 * `level: 'warning'` per spottare regressioni in field.
 *
 * Esempi d'uso:
 *  - download fallito 3 volte → `reportError(err, { tag: 'sync.download_failed', extra: { roomId, versionId, retries: 3 } })`
 *  - hash SHA-256 mismatch dopo retry → `reportError(new Error('verify_mismatch'), { tag: 'sync.verify_mismatch', extra: { fileHashSha256 } })`
 *  - storage quota piena → `reportError(new Error('storage_full'), { tag: 'sync.storage_full', extra: { neededBytes, availableBytes } })`
 *  - Realtime disconnesso a lungo → `reportError(new Error('realtime_dead'), { tag: 'sync.realtime_dead', level: 'warning' })`
 *
 * E' deliberatamente fire-and-forget: nessuna await, nessun throw, nessun
 * controllo se Sentry e' inizializzato (l'import dinamico ritorna comunque,
 * e `captureException` e' no-op se non ce DSN).
 */
type Level = 'fatal' | 'error' | 'warning' | 'info';

interface ReportContext {
  /** Tag breve, es. `sync.download_failed`. Visibile nei filtri Sentry. */
  tag: string;
  /** Severita'. Default: `'warning'` (gli "errori critici silenziati" non sono fatal). */
  level?: Level;
  /** Contesto extra, JSON-friendly. */
  extra?: Record<string, unknown>;
  /** Tag aggiuntivi per filtraggio. */
  tags?: Record<string, string>;
}

export function reportError(error: unknown, context: ReportContext): void {
  void (async () => {
    try {
      const Sentry = await import('@sentry/react');
      const err = error instanceof Error ? error : new Error(String(error));
      Sentry.captureException(err, {
        level: context.level ?? 'warning',
        tags: { feature: context.tag, ...(context.tags ?? {}) },
        extra: context.extra,
      });
    } catch {
      // Se Sentry non e' disponibile (DSN assente, bundle escluso) ignoriamo.
      // In dev possiamo loggare in console per debug.
      if (import.meta.env.DEV) {
        console.warn('[telemetry] reportError fallback', context.tag, error, context);
      }
    }
  })();
}
