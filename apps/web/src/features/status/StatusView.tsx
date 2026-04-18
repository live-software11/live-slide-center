import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCcw,
  Clock,
  ArrowLeft,
} from 'lucide-react';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { fetchSystemStatus, type ServiceStatus, type SystemStatusResponse } from './repository';

const POLL_INTERVAL_MS = 30_000;

/**
 * Sprint 8 — pagina pubblica /status.
 *
 * Mostra in tempo reale lo stato dei servizi Slide Center (Database, Auth,
 * Storage, Edge Functions) interrogando l'Edge Function `system-status`.
 * Polling automatico ogni 30 secondi. Accessibile senza login.
 *
 * Usata da:
 *   - utenti finali (clienti / relatori) per verificare se un disservizio e'
 *     dalla loro parte o dalla nostra
 *   - uptime monitor esterni (UptimeRobot, BetterStack) via la versione JSON
 *     dell'endpoint sottostante
 *   - link nel footer del login per trasparenza
 */
export default function StatusView() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await fetchSystemStatus();
      setData(result);
      setLastFetched(new Date());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handle = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [refresh]);

  const overall = data?.status ?? (errorMsg ? 'major_outage' : 'operational');
  const palette = useMemo(() => OVERALL_PALETTE[overall], [overall]);
  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';

  return (
    <div className="min-h-screen bg-sc-bg text-sc-text">
      <header className="border-b border-sc-primary/10 bg-sc-surface/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <AppBrandLogo className="h-8 w-auto" />
            <span className="text-sm font-semibold text-sc-text-secondary">
              {t('status.headerProduct')}
            </span>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-sc-text-muted transition-colors hover:text-sc-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('status.backToLogin')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <section
          className={`rounded-2xl border ${palette.border} ${palette.bg} p-6 shadow-sm`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={palette.iconClass} aria-hidden>
                {palette.icon}
              </span>
              <div>
                <h1 className="text-2xl font-bold text-sc-text">{t(palette.titleKey)}</h1>
                <p className="mt-1 text-sm text-sc-text-muted">{t(palette.bodyKey)}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/20 bg-sc-bg/50 px-3 py-1.5 text-xs font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/10 disabled:opacity-60"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </button>
          </div>
          {lastFetched ? (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-sc-text-dim">
              <Clock className="h-3 w-3" />
              {t('status.lastChecked', { time: lastFetched.toLocaleTimeString(locale) })}
            </p>
          ) : null}
          {errorMsg ? (
            <p className="mt-3 rounded-lg border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger">
              {t('status.fetchError')}: {errorMsg}
            </p>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sc-text-dim">
            {t('status.servicesTitle')}
          </h2>
          {data?.services && data.services.length > 0 ? (
            <ul className="space-y-2">
              {data.services.map((svc) => (
                <ServiceRow key={svc.id} svc={svc} />
              ))}
            </ul>
          ) : loading ? (
            <p className="rounded-lg border border-sc-primary/15 bg-sc-surface px-4 py-6 text-sm text-sc-text-muted">
              {t('common.loading')}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed border-sc-primary/20 px-4 py-6 text-sm text-sc-text-muted">
              {t('status.noData')}
            </p>
          )}
        </section>

        <section className="mt-8 rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-sc-text-dim">
            {t('status.helpTitle')}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-sc-text-muted">
            {t('status.helpBody')}
          </p>
          <a
            href="mailto:live.software11@gmail.com"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-sc-primary transition-colors hover:text-sc-primary-strong"
          >
            live.software11@gmail.com →
          </a>
        </section>

        <footer className="mt-10 border-t border-sc-primary/10 pt-6 text-center text-xs text-sc-text-dim">
          <p>
            {t('status.footerProduct')} ·{' '}
            <a
              href="https://www.liveworksapp.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sc-primary"
            >
              www.liveworksapp.com
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

function ServiceRow({ svc }: { svc: ServiceStatus }) {
  const { t } = useTranslation();
  const tone = SERVICE_PALETTE[svc.status];

  return (
    <li
      className={`flex items-center justify-between rounded-xl border ${tone.border} ${tone.bg} px-4 py-3`}
    >
      <div className="flex items-center gap-3">
        <span className={tone.iconClass} aria-hidden>
          {tone.icon}
        </span>
        <div>
          <p className="text-sm font-semibold text-sc-text">{svc.name}</p>
          <p className="mt-0.5 text-xs text-sc-text-muted">
            {t(`status.service.status.${svc.status}`)}
            {svc.latency_ms !== null ? ` · ${svc.latency_ms} ms` : ''}
          </p>
        </div>
      </div>
      {svc.detail ? (
        <span className="text-xs text-sc-text-dim" title={svc.detail}>
          {svc.detail.slice(0, 24)}
          {svc.detail.length > 24 ? '…' : ''}
        </span>
      ) : null}
    </li>
  );
}

const OVERALL_PALETTE = {
  operational: {
    border: 'border-sc-success/30',
    bg: 'bg-sc-success/5',
    iconClass: 'text-sc-success',
    icon: <CheckCircle2 className="h-8 w-8" />,
    titleKey: 'status.overall.operational.title',
    bodyKey: 'status.overall.operational.body',
  },
  degraded: {
    border: 'border-sc-warning/30',
    bg: 'bg-sc-warning/5',
    iconClass: 'text-sc-warning',
    icon: <AlertTriangle className="h-8 w-8" />,
    titleKey: 'status.overall.degraded.title',
    bodyKey: 'status.overall.degraded.body',
  },
  major_outage: {
    border: 'border-sc-danger/30',
    bg: 'bg-sc-danger/5',
    iconClass: 'text-sc-danger',
    icon: <XCircle className="h-8 w-8" />,
    titleKey: 'status.overall.outage.title',
    bodyKey: 'status.overall.outage.body',
  },
} as const;

const SERVICE_PALETTE = {
  operational: {
    border: 'border-sc-success/20',
    bg: 'bg-sc-success/5',
    iconClass: 'text-sc-success',
    icon: <CheckCircle2 className="h-5 w-5" />,
  },
  degraded: {
    border: 'border-sc-warning/30',
    bg: 'bg-sc-warning/10',
    iconClass: 'text-sc-warning',
    icon: <AlertTriangle className="h-5 w-5" />,
  },
  down: {
    border: 'border-sc-danger/30',
    bg: 'bg-sc-danger/10',
    iconClass: 'text-sc-danger',
    icon: <XCircle className="h-5 w-5" />,
  },
} as const;

export { StatusView as Component };
