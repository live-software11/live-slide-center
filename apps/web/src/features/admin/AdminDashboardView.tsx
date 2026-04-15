import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export default function AdminDashboardView() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-zinc-50">{t('admin.dashboardTitle')}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
        {t('admin.dashboardIntro')}
      </p>
      <p className="mt-6">
        <Link
          to="/admin/tenants"
          className="text-sm font-medium text-blue-500 hover:text-blue-400 hover:underline"
        >
          {t('admin.navTenants')} →
        </Link>
      </p>
    </div>
  );
}

export { AdminDashboardView as Component };
