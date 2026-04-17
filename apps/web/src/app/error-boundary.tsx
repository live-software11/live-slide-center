import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Componente fallback alternativo. Se assente, mostra UI minima inline. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  eventId: string | null;
}

/**
 * ErrorBoundary con integrazione Sentry opzionale (Fase 14).
 * Sentry viene importato dinamicamente per evitare costi di bundle quando DSN non è configurato.
 * `captureException` è no-op se Sentry non è inizializzato.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, eventId: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Sentry capture asincrono — non blocca il rendering del fallback
    void (async () => {
      try {
        const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
        if (dsn && dsn.trim()) {
          const Sentry = await import('@sentry/react');
          const eventId = Sentry.captureException(error, {
            contexts: { react: { componentStack: info.componentStack ?? '' } },
          });
          this.setState({ eventId: eventId ?? null });
        }
      } catch {
        // Sentry non disponibile — silenzioso
      }
    })();
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-sc-bg px-4 text-sc-text">
          <p className="text-lg font-semibold">Si è verificato un errore imprevisto.</p>
          <p className="text-sm text-sc-text-muted">
            Ricarica la pagina o contatta il supporto.
          </p>
          {this.state.eventId ? (
            <p className="font-mono text-xs text-sc-text-dim">
              Ref: {this.state.eventId}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white hover:bg-sc-primary-deep"
          >
            Ricarica
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
