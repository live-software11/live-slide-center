import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { Suspense } from 'react';

export function AdminRootLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="hidden w-56 border-r border-amber-900/30 bg-zinc-900 lg:block">
        <nav className="flex flex-col gap-1 p-4" aria-label={t('a11y.adminNav')}>
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-amber-500/90">
            {t('admin.badge')}
          </p>
          <Link
            to="/admin"
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            {t('admin.navOverview')}
          </Link>
          <Link
            to="/admin/tenants"
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            {t('admin.navTenants')}
          </Link>
          <Link
            to="/"
            className="mt-4 rounded-md px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            {t('admin.backToTenant')}
          </Link>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-zinc-500">
              {t('auth.loadingSession')}
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
