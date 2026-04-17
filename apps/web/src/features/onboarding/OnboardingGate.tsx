import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/app/use-auth';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useTenantOnboardingStatus } from './hooks/useTenantOnboardingStatus';

const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'));

/**
 * Sprint 6: monta il wizard se admin con tenants.onboarded_at NULL.
 * Lazy import per non pesare sul bundle quando il wizard non serve.
 * Tech/coordinator/super-admin: skip silenzioso.
 */
export function OnboardingGate() {
  const { session, loading } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tenantId = getTenantIdFromSession(session);
  const role = session?.user?.app_metadata?.role;
  const isAdmin = role === 'admin';

  const { isOnboarded, tenantName, refresh } = useTenantOnboardingStatus(
    supabase,
    isAdmin ? tenantId : null,
  );

  const [forcedClosed, setForcedClosed] = useState(false);

  const handleClose = useCallback(() => {
    setForcedClosed(true);
    void refresh();
  }, [refresh]);

  if (loading || !isAdmin || !tenantId) return null;
  if (isOnboarded === null) return null;
  if (isOnboarded === true) return null;
  if (forcedClosed) return null;

  return (
    <Suspense fallback={null}>
      <OnboardingWizard
        supabase={supabase}
        tenantId={tenantId}
        tenantName={tenantName ?? ''}
        onClose={handleClose}
      />
    </Suspense>
  );
}
