import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { fetchTenantQuotaRow, type TenantQuotaRow } from '../repository';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; row: TenantQuotaRow };

export function useTenantQuotaRow(supabase: SupabaseClient<Database>, tenantId: string | null) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const load = useCallback(async () => {
    if (!tenantId) return;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    const { data, error } = await fetchTenantQuotaRow(supabase, tenantId);
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    if (!data) {
      setState({ status: 'error', message: 'no_tenant_row' });
      return;
    }
    setState({ status: 'ready', row: data });
  }, [supabase, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    startTransition(() => {
      void load();
    });
  }, [load, tenantId]);

  return { state, reload: load };
}
