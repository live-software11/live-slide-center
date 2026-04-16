import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { fetchTenantDetailBundle, type TenantDetailBundle } from '../repository';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'ready'; bundle: TenantDetailBundle };

export function useAdminTenantDetail(supabase: SupabaseClient<Database>, tenantId: string | undefined) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!tenantId) {
      setState({ status: 'error', message: 'missing_id' });
      return;
    }
    setState({ status: 'loading' });
    const { data, error } = await fetchTenantDetailBundle(supabase, tenantId);
    if (error && error !== 'not_found') {
      setState({ status: 'error', message: error });
      return;
    }
    if (!data) {
      setState({ status: 'not_found' });
      return;
    }
    setState({ status: 'ready', bundle: data });
  }, [supabase, tenantId]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  return { state, reload: load };
}
