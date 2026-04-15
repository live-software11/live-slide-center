import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export default function AdminDashboardView() {
  const { t } = useTranslation();
  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-sc-text">{t('admin.dashboardTitle')}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sc-text-muted">
        {t('admin.dashboardIntro')}
      </p>
      <p className="mt-6">
        <Link
          to="/admin/tenants"
          className="text-sm font-semibold text-sc-primary hover:text-sc-primary-deep hover:underline"
        >
          {t('admin.navTenants')} →
        </Link>
      </p>
    </div>
  );
}

export { AdminDashboardView as Component };
