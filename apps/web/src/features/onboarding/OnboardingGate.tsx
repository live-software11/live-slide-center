import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/app/use-auth';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getBackendMode } from '@/lib/backend-mode';
import { useTenantOnboardingStatus } from './hooks/useTenantOnboardingStatus';

const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'));

/**
 * Sprint 6: monta il wizard se admin con tenants.onboarded_at NULL.
 * Lazy import per non pesare sul bundle quando il wizard non serve.
 * Tech/coordinator/super-admin: skip silenzioso.
 *
 * Sprint O2: in modalita desktop il tenant locale e' gia' configurato via
 * seed SQLite (Sprint K), non serve onboarding wizard. Skip silenzioso.
 */
export function OnboardingGate() {
  const { session, loading } = useAuth();
  const isDesktop = getBackendMode() === 'desktop';
  const supabase = useMemo(() => (isDesktop ? null : getSupabaseBrowserClient()), [isDesktop]);
  const tenantId = getTenantIdFromSession(session);
  const role = session?.user?.app_metadata?.role;
  const isAdmin = role === 'admin';

  const { isOnboarded, tenantName, refresh } = useTenantOnboardingStatus(
    supabase,
    !isDesktop && isAdmin ? tenantId : null,
  );

  const [forcedClosed, setForcedClosed] = useState(false);

  const handleClose = useCallback(() => {
    setForcedClosed(true);
    void refresh();
  }, [refresh]);

  if (isDesktop) return null;
  if (loading || !isAdmin || !tenantId) return null;
  if (isOnboarded === null) return null;
  if (isOnboarded === true) return null;
  if (forcedClosed) return null;
  if (!supabase) return null; // narrow: in cloud supabase e' sempre valorizzato

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
