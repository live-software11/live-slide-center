import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ShieldCheck, Download, RefreshCcw, ExternalLink, Clock, AlertCircle } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useToast } from '@/components/use-toast';
import { listTenantDataExports, requestGdprExport, type DataExportRow } from './repository';

export default function PrivacyView() {
  const { t, i18n } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const toast = useToast();
  const [exports, setExports] = useState<DataExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [latestUrl, setLatestUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listTenantDataExports(supabase);
      setExports(rows);
    } catch (err) {
      toast.error(t('privacy.history.errorTitle'), {
        description: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      setLoading(false);
    }
  }, [supabase, toast, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setLatestUrl(null);
    try {
      const res = await requestGdprExport(supabase);
      setLatestUrl(res.download_url);
      toast.success(t('privacy.export.successTitle'), {
        description: t('privacy.export.successBody', { mb: Math.round(res.byte_size / 1024 / 1024) }),
      });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      const isRateLimit = /rate_limited/i.test(message);
      toast.error(
        isRateLimit ? t('privacy.export.rateLimitTitle') : t('privacy.export.errorTitle'),
        { description: isRateLimit ? t('privacy.export.rateLimitBody') : message },
      );
    } finally {
      setExporting(false);
    }
  }, [supabase, refresh, toast, t]);

  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-2">
        <Link to="/settings" className="text-xs font-medium text-sc-text-dim hover:text-sc-primary">
          ← {t('nav.settings')}
        </Link>
      </div>
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sc-primary/20 bg-sc-primary/10 text-sc-primary">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-sc-text">{t('privacy.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sc-text-muted">{t('privacy.intro')}</p>
        </div>
      </header>

      <section className="mt-8 max-w-3xl rounded-xl border border-sc-primary/15 bg-sc-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-sc-text">{t('privacy.export.title')}</h2>
            <p className="mt-1 text-sm text-sc-text-muted">{t('privacy.export.body')}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-sc-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sc-primary-strong disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exporting ? t('common.loading') : t('privacy.export.cta')}
          </button>
        </div>
        {latestUrl ? (
          <div className="mt-4 rounded-lg border border-sc-success/40 bg-sc-success/10 px-4 py-3">
            <p className="text-sm font-semibold text-sc-success">{t('privacy.export.readyTitle')}</p>
            <p className="mt-1 text-xs text-sc-text-muted">{t('privacy.export.readyBody')}</p>
            <a
              href={latestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sc-success hover:underline"
            >
              {t('privacy.export.openLink')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : null}
      </section>

      <section className="mt-6 max-w-3xl rounded-xl border border-sc-primary/15 bg-sc-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-sc-text">{t('privacy.history.title')}</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/10 disabled:opacity-60"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t('common.refresh')}
          </button>
        </div>
        <p className="mt-1 text-sm text-sc-text-muted">{t('privacy.history.subtitle')}</p>

        <div className="mt-4 space-y-2">
          {loading && exports.length === 0 ? (
            <p className="text-sm text-sc-text-muted">{t('common.loading')}</p>
          ) : exports.length === 0 ? (
            <p className="rounded-lg border border-dashed border-sc-primary/20 px-4 py-6 text-center text-sm text-sc-text-muted">
              {t('privacy.history.empty')}
            </p>
          ) : (
            exports.map((row) => <ExportRow key={row.id} row={row} locale={locale} />)
          )}
        </div>
      </section>

      <section className="mt-6 max-w-3xl rounded-xl border border-sc-primary/15 bg-sc-surface p-6">
        <h2 className="text-lg font-semibold text-sc-text">{t('privacy.deletion.title')}</h2>
        <p className="mt-1 text-sm text-sc-text-muted">{t('privacy.deletion.body')}</p>
        <p className="mt-3 text-xs text-sc-text-dim">{t('privacy.deletion.contact')}</p>
      </section>

      <section className="mt-6 max-w-3xl rounded-xl border border-sc-primary/15 bg-sc-surface p-6">
        <h2 className="text-lg font-semibold text-sc-text">{t('privacy.legal.title')}</h2>
        <ul className="mt-3 space-y-2 text-sm text-sc-text-muted">
          <li>• {t('privacy.legal.dpo')}</li>
          <li>• {t('privacy.legal.retention')}</li>
          <li>• {t('privacy.legal.subprocessors')}</li>
        </ul>
      </section>
    </div>
  );
}

function ExportRow({ row, locale }: { row: DataExportRow; locale: string }) {
  const { t } = useTranslation();
  const requested = new Date(row.requested_at).toLocaleString(locale);
  const expires = row.expires_at ? new Date(row.expires_at).toLocaleString(locale) : null;

  const palette = (() => {
    switch (row.status) {
      case 'ready':
        return 'border-sc-success/30 bg-sc-success/5 text-sc-text';
      case 'pending':
        return 'border-sc-primary/20 bg-sc-primary/5 text-sc-text-secondary';
      case 'expired':
        return 'border-sc-text/15 bg-sc-text/5 text-sc-text-dim';
      case 'failed':
        return 'border-sc-danger/30 bg-sc-danger/5 text-sc-text';
      default:
        return 'border-sc-primary/15 bg-sc-bg/40 text-sc-text-secondary';
    }
  })();

  const statusLabel = t(`privacy.history.status.${row.status}`, { defaultValue: row.status });

  return (
    <article className={`rounded-lg border px-4 py-3 ${palette}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5 text-sc-text-dim" />
            <span className="font-medium text-sc-text">{requested}</span>
          </div>
          <p className="mt-1 text-xs text-sc-text-muted">
            {t('privacy.history.statusLabel')}: <span className="font-semibold">{statusLabel}</span>
            {row.byte_size ? ` · ${(row.byte_size / 1024 / 1024).toFixed(1)} MB` : ''}
          </p>
          {row.error_message ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-sc-danger">
              <AlertCircle className="h-3 w-3" />
              {row.error_message}
            </p>
          ) : null}
          {expires ? (
            <p className="mt-1 text-xs text-sc-text-dim">
              {t('privacy.history.expiresAt', { date: expires })}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export { PrivacyView as Component };
