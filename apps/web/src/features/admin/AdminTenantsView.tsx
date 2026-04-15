import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatBytes } from './lib/format-bytes';
import { useAdminTenants } from './hooks/useAdminTenants';

export default function AdminTenantsView() {
  const { t } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { state, reload } = useAdminTenants(supabase);

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
      <h1 className="text-2xl font-bold text-sc-text">{t('admin.tenantsTitle')}</h1>
      <p className="mt-2 max-w-2xl text-sm text-sc-text-muted">{t('admin.tenantsIntro')}</p>

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
              </tr>
            </thead>
            <tbody className="divide-y divide-sc-primary/12">
              {state.tenants.map((row) => (
                <tr key={row.id} className="hover:bg-sc-surface/60">
                  <td className="px-4 py-3 font-medium text-sc-text">{row.name}</td>
                  <td className="px-4 py-3 text-sc-text-muted">{row.slug}</td>
                  <td className="px-4 py-3 text-sc-text-secondary">{row.plan}</td>
                  <td className="px-4 py-3 text-sc-text-muted">
                    {formatBytes(row.storage_used_bytes)} / {formatBytes(row.storage_limit_bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { AdminTenantsView as Component };
