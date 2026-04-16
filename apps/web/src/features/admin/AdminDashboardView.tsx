import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatBytes } from './lib/format-bytes';
import { useAdminPlatformStats } from './hooks/useAdminPlatformStats';

export default function AdminDashboardView() {
  const { t } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { state, reload } = useAdminPlatformStats(supabase);

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-sc-text">{t('admin.dashboardTitle')}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sc-text-muted">{t('admin.dashboardIntro')}</p>

      {state.status === 'loading' ? (
        <p className="mt-8 text-sm text-sc-text-muted">{t('common.loading')}</p>
      ) : null}

      {state.status === 'error' ? (
        <div className="mt-8">
          <p className="text-sc-danger" role="alert">
            {t('admin.dashboardStatsError')}: {state.message}
          </p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-4 rounded-xl bg-sc-elevated px-4 py-2 text-sm hover:bg-sc-primary/10"
          >
            {t('common.refresh')}
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.dashboardCardTenants')}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-sc-text">{state.stats.tenantCount}</p>
          </div>
          <div className="rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.dashboardCardEvents')}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-sc-text">{state.stats.activeEventsCount}</p>
            <p className="mt-1 text-xs text-sc-text-muted">{t('admin.dashboardCardEventsHint')}</p>
          </div>
          <div className="rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.dashboardCardStorage')}</p>
            <p className="mt-2 text-xl font-bold tabular-nums text-sc-text">{formatBytes(state.stats.storageUsedTotalBytes)}</p>
            <p className="mt-1 text-xs text-sc-text-muted">{t('admin.dashboardCardStorageHint')}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-10 rounded-xl border border-sc-accent/15 bg-sc-surface/60 p-5">
        <p className="text-sm font-medium text-sc-text-secondary">{t('admin.dashboardMtdPlaceholder')}</p>
        <p className="mt-1 text-xs text-sc-text-dim">{t('admin.dashboardMtdHint')}</p>
      </div>

      <p className="mt-8">
        <Link
          to="/admin/tenants"
          className="text-sm font-semibold text-sc-primary hover:text-sc-primary-deep hover:underline"
        >
          {t('admin.navTenants')} →
        </Link>
        <span className="mx-3 text-sc-text-dim">·</span>
        <Link
          to="/admin/audit"
          className="text-sm font-semibold text-sc-primary hover:text-sc-primary-deep hover:underline"
        >
          {t('admin.navAudit')} →
        </Link>
      </p>
    </div>
  );
}

export { AdminDashboardView as Component };
