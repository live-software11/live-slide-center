import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './use-auth';

function isSuperAdminAppMetadata(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  return user?.app_metadata?.role === 'super_admin';
}

export function RequireSuperAdmin() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
        {t('auth.loadingSession')}
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdminAppMetadata(session.user)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
