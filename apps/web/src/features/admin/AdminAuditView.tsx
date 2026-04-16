import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useAdminAuditLog } from './hooks/useAdminAuditLog';

export default function AdminAuditView() {
  const { t } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { state, reload } = useAdminAuditLog(supabase);

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
          {t('admin.auditLoadError')}: {state.message}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-4 rounded-xl bg-sc-elevated px-4 py-2 text-sm hover:bg-sc-primary/10"
        >
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-sc-text">{t('admin.auditTitle')}</h1>
      <p className="mt-2 max-w-3xl text-sm text-sc-text-muted">{t('admin.auditIntro')}</p>

      {state.rows.length === 0 ? (
        <p className="mt-8 text-sm text-sc-text-dim">{t('admin.auditEmpty')}</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-sc-primary/12">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-sc-primary/12 bg-sc-surface/80 text-xs uppercase text-sc-text-dim">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.auditColWhen')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.auditColTenant')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.auditColAction')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.auditColActor')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.auditColEntity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sc-primary/12">
              {state.rows.map((row) => (
                <tr key={row.id} className="hover:bg-sc-surface/60">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-sc-text-muted">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/tenants/${row.tenant_id}`}
                      className="font-mono text-xs text-sc-primary hover:text-sc-primary-deep hover:underline"
                    >
                      {row.tenant_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sc-text">{row.action}</td>
                  <td className="px-4 py-3 text-sc-text-secondary">
                    {row.actor}
                    {row.actor_name ? (
                      <span className="block text-xs text-sc-text-dim">{row.actor_name}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-sc-text-muted">
                    {row.entity_type ?? '—'}
                    {row.entity_id ? <span className="block text-sc-text-dim">{row.entity_id.slice(0, 12)}…</span> : null}
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

export { AdminAuditView as Component };
