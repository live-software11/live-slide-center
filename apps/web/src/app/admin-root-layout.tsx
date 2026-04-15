import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { Suspense } from 'react';

export function AdminRootLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  function isActive(path: string) {
    return location.pathname === path;
  }

  const linkClass = (path: string) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive(path)
        ? 'bg-sc-accent/12 text-sc-accent'
        : 'text-sc-text-muted hover:bg-sc-accent/8 hover:text-sc-text'
    }`;

  return (
    <div className="flex min-h-screen bg-sc-bg text-sc-text">
      <aside className="hidden w-56 shrink-0 border-r border-sc-accent/15 bg-sc-surface/80 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-sc-accent/15 px-5">
          <p className="text-xs font-bold uppercase tracking-widest text-sc-accent">
            {t('admin.badge')}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label={t('a11y.adminNav')}>
          <Link to="/admin" className={linkClass('/admin')}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            {t('admin.navOverview')}
          </Link>
          <Link to="/admin/tenants" className={linkClass('/admin/tenants')}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
            {t('admin.navTenants')}
          </Link>
        </nav>
        <div className="border-t border-sc-accent/15 p-3">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-sc-text-dim transition-colors hover:bg-sc-accent/8 hover:text-sc-text-muted"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" /></svg>
            {t('admin.backToTenant')}
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sc-text-muted">
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
