import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './use-auth';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchTenantSuspended } from '@/features/admin/repository';
import { AppBrandLogo } from '@/components/AppBrandLogo';

function TenantSuspendedScreen({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg px-4 text-center">
      <AppBrandLogo size="md" className="shrink-0" />
      <h1 className="mt-6 text-xl font-bold text-sc-danger">{t('auth.tenantSuspendedTitle')}</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-sc-text-muted">{t('auth.tenantSuspendedBody')}</p>
      <button
        type="button"
        className="mt-8 rounded-xl bg-sc-elevated px-5 py-2.5 text-sm font-semibold text-sc-text hover:bg-sc-primary/10"
        onClick={() => void onSignOut()}
      >
        {t('auth.logout')}
      </button>
    </div>
  );
}

/** Solo utenti autenticati con sessione già valida: verifica sospensione tenant senza setState sincrono nell'effect. */
function RequireAuthSessionGate({ session, children }: { session: Session; children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const isSuperAdmin = session.user.app_metadata?.role === 'super_admin';
  const tenantId = getTenantIdFromSession(session);
  const needsSuspensionCheck = !isSuperAdmin && Boolean(tenantId);
  const [suspended, setSuspended] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!needsSuspensionCheck || !tenantId) return;
    let cancelled = false;
    void fetchTenantSuspended(supabase, tenantId).then(({ suspended: value, error }) => {
      if (cancelled) return;
      if (error || value === null) setSuspended(false);
      else setSuspended(value);
    });
    return () => {
      cancelled = true;
    };
  }, [needsSuspensionCheck, tenantId, supabase]);

  if (needsSuspensionCheck && suspended === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
        <RequireAuthLoading />
      </div>
    );
  }

  if (needsSuspensionCheck && suspended === true) {
    return <TenantSuspendedScreen onSignOut={() => void supabase.auth.signOut()} />;
  }

  return <>{children}</>;
}

function RequireAuthLoading() {
  const { t } = useTranslation();
  return <>{t('auth.loadingSession')}</>;
}

export function RequireAuth() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
        <RequireAuthLoading />
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

  return (
    <RequireAuthSessionGate key={session.user.id} session={session}>
      <Outlet />
    </RequireAuthSessionGate>
  );
}
