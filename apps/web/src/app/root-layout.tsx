import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { Suspense } from 'react';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { OnboardingGate } from '@/features/onboarding/OnboardingGate';

export function RootLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const role = session?.user?.app_metadata?.role;
  const isSuperAdmin = role === 'super_admin';
  const isTenantAdmin = role === 'admin';

  async function handleLogout() {
    await getSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  function isActive(path: string) {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  const linkClass = (path: string) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive(path)
      ? 'bg-sc-primary/12 text-sc-primary'
      : 'text-sc-text-muted hover:bg-sc-primary/8 hover:text-sc-text'
    }`;

  return (
    <div className="flex min-h-screen bg-sc-bg text-sc-text">
      <aside className="hidden w-64 shrink-0 border-r border-sc-primary/10 bg-sc-surface/80 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2.5 border-b border-sc-primary/10 px-5">
          <AppBrandLogo size="sm" className="shrink-0" />
          <span className="min-w-0 truncate text-sm font-semibold tracking-tight text-sc-text">
            {t('app.displayName')}
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label={t('a11y.mainNav')}>
          <Link to="/" className={linkClass('/')}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" /></svg>
            {t('nav.dashboard')}
          </Link>
          <Link to="/events" className={linkClass('/events')}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            {t('nav.events')}
          </Link>
          <Link to="/settings" className={linkClass('/settings')}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            {t('nav.settings')}
          </Link>
          {isTenantAdmin ? (
            <Link to="/team" className={linkClass('/team')}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {t('nav.team')}
            </Link>
          ) : null}
          {isTenantAdmin ? (
            <Link to="/billing" className={linkClass('/billing')}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              {t('nav.billing')}
            </Link>
          ) : null}
          {isSuperAdmin ? (
            <Link
              to="/admin"
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive('/admin')
                ? 'bg-sc-accent/12 text-sc-accent'
                : 'text-sc-accent/70 hover:bg-sc-accent/8 hover:text-sc-accent'
                }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              {t('admin.navOverview')}
            </Link>
          ) : null}
        </nav>
        <div className="border-t border-sc-primary/10 p-3">
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-sc-text-dim transition-colors hover:bg-sc-primary/8 hover:text-sc-text-muted"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            {t('auth.logout')}
          </button>
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
      <OnboardingGate />
    </div>
  );
}
