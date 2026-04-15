import { useTranslation } from 'react-i18next';
import { Link, Outlet, useNavigate } from 'react-router';
import { Suspense } from 'react';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export function RootLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const isSuperAdmin = session?.user?.app_metadata?.role === 'super_admin';

  async function handleLogout() {
    await getSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="hidden w-64 border-r border-zinc-800 bg-zinc-900 lg:block">
        <nav className="flex flex-col gap-1 p-4" aria-label={t('a11y.mainNav')}>
          <Link
            to="/"
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            {t('nav.dashboard')}
          </Link>
          <Link
            to="/events"
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            {t('nav.events')}
          </Link>
          <Link
            to="/settings"
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            {t('nav.settings')}
          </Link>
          {isSuperAdmin ? (
            <Link
              to="/admin"
              className="rounded-md px-3 py-2 text-sm font-medium text-amber-500/90 hover:bg-zinc-800 hover:text-amber-400"
            >
              {t('admin.navOverview')}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-4 rounded-md px-3 py-2 text-left text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {t('auth.logout')}
          </button>
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
