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
      <div className="p-8 text-zinc-400">
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">
          {t('admin.tenantsLoadError')}: {state.message}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-4 rounded-md bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
        >
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-zinc-50">{t('admin.tenantsTitle')}</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">{t('admin.tenantsIntro')}</p>

      {state.tenants.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">{t('admin.tenantsEmpty')}</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.colTenantName')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colSlug')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colPlan')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.colStorage')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {state.tenants.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3 font-medium text-zinc-100">{row.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{row.slug}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.plan}</td>
                  <td className="px-4 py-3 text-zinc-400">
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
