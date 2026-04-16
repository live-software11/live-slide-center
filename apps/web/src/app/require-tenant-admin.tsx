import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '@/app/use-auth';

function Loading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
      {t('auth.loadingSession')}
    </div>
  );
}

/** Solo `role=admin` sul tenant (JWT `app_metadata`). `super_admin` → console /admin. Altri ruoli → home. */
export function RequireTenantAdmin() {
  const { session, loading } = useAuth();

  if (loading) {
    return <Loading />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const role = session.user.app_metadata?.role;
  if (role === 'super_admin') {
    return <Navigate to="/admin" replace />;
  }
  if (role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
