import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchTenantOnboardingRow, type TenantOnboardingRow } from '../repository';

type State =
  | { status: 'loading' }
  | { status: 'ready'; row: TenantOnboardingRow }
  | { status: 'error'; message: string };

/**
 * Sprint 6: legge tenants.onboarded_at per il tenant del JWT.
 * Ritorna { isOnboarded, loading, error, refresh }.
 * - isOnboarded === null: ancora in caricamento o tenant assente
 * - isOnboarded === true: wizard chiuso
 * - isOnboarded === false: wizard da mostrare (admin)
 */
export function useTenantOnboardingStatus(
  supabase: SupabaseClient | null,
  tenantId: string | null,
): {
  state: State;
  isOnboarded: boolean | null;
  tenantName: string | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<State>({ status: 'loading' });

  const refresh = useCallback(async () => {
    if (!tenantId || !supabase) {
      setState({ status: 'error', message: 'missing_tenant' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const row = await fetchTenantOnboardingRow(supabase, tenantId);
      setState({ status: 'ready', row });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'fetch_error';
      setState({ status: 'error', message });
    }
  }, [supabase, tenantId]);

  useEffect(() => {
    if (!tenantId || !supabase) {
      // Stato iniziale 'loading' va lasciato com'e': nessun setState sync nel body dell'effect.
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const row = await fetchTenantOnboardingRow(supabase, tenantId);
        if (!cancelled) setState({ status: 'ready', row });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'fetch_error';
          setState({ status: 'error', message });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId]);

  const isOnboarded = useMemo<boolean | null>(() => {
    if (state.status !== 'ready') return null;
    return state.row.onboarded_at !== null;
  }, [state]);

  const tenantName = useMemo<string | null>(() => {
    if (state.status !== 'ready') return null;
    return state.row.name;
  }, [state]);

  return { state, isOnboarded, tenantName, refresh };
}
