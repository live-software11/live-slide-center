import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './use-auth';
import { getTenantIdFromSession } from '@/lib/session-tenant';

export function RequireAuth() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        {t('auth.loadingSession')}
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const isSuperAdmin = session.user.app_metadata?.role === 'super_admin';
  if (!isSuperAdmin && !getTenantIdFromSession(session)) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
