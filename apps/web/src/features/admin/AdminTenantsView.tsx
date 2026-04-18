import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatBytes } from './lib/format-bytes';
import { isUnlimitedStorage } from '@/features/tenant/lib/quota-usage';
import { useAdminTenants } from './hooks/useAdminTenants';
import { CreateTenantDialog } from './components/CreateTenantDialog';

export default function AdminTenantsView() {
  const { t } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { state, reload } = useAdminTenants(supabase);
  const [showCreate, setShowCreate] = useState(false);

  const onCreated = useCallback(
    async (_tenantId: string) => {
      // Aggiorna la lista in background; il dialog rimane aperto sulla schermata
      // di successo finche' l'utente non chiude.
      await reload();
    },
    [reload],
  );

  if (state.status === 'loading') {
    return (
      <div className="p-6 lg:p-8 text-sc-text-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-danger" role="alert">
          {t('admin.tenantsLoadError')}: {state.message}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-4 rounded-xl bg-sc-elevated px-4 py-2 text-sm hover:bg-sc-elevated"
        >
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sc-text">{t('admin.tenantsTitle')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-sc-text-muted">{t('admin.tenantsIntro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sc-primary/20 hover:bg-sc-primary-deep"
        >
          <Plus className="h-4 w-4" />
          {t('admin.createTenant.openCta')}
        </button>
      </div>

      {state.tenants.length === 0 ? (
        <p className="mt-8 text-sm text-sc-text-dim">{t('admin.tenantsEmpty')}</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-sc-primary/12">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-sc-primary/12 bg-sc-surface/80 text-xs uppercase text-sc-text-dim">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.colTenantName')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colSlug')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colPlan')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colStorage')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colStatus')}</th>
                <th className="px-4 py-3 font-medium w-28">{t('admin.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sc-primary/12">
              {state.tenants.map((row) => (
                <tr key={row.id} className="hover:bg-sc-surface/60">
                  <td className="px-4 py-3 font-medium text-sc-text">
                    <Link to={`/admin/tenants/${row.id}`} className="text-sc-primary hover:text-sc-primary-deep hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sc-text-muted">{row.slug}</td>
                  <td className="px-4 py-3 text-sc-text-secondary">{row.plan}</td>
                  <td className="px-4 py-3 text-sc-text-muted">
                    {formatBytes(row.storage_used_bytes)} /{' '}
                    {isUnlimitedStorage(row.plan, row.storage_limit_bytes)
                      ? t('tenantQuota.unlimited')
                      : formatBytes(row.storage_limit_bytes)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.suspended ? (
                      <span className="rounded-full bg-sc-danger/15 px-2 py-0.5 font-semibold text-sc-danger">
                        {t('admin.tenantSuspendedBadge')}
                      </span>
                    ) : (
                      <span className="text-sc-text-dim">{t('admin.tenantActiveBadge')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/tenants/${row.id}`}
                      className="text-xs font-semibold text-sc-primary hover:text-sc-primary-deep hover:underline"
                    >
                      {t('admin.tenantsOpenDetail')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <CreateTenantDialog
          supabase={supabase}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            void onCreated(id);
          }}
        />
      ) : null}
    </div>
  );
}

export { AdminTenantsView as Component };
