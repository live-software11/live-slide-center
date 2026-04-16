import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type TenantRow = Database['public']['Tables']['tenants']['Row'];

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tenants: TenantRow[] };

export function useAdminTenants(supabase: SupabaseClient<Database>) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tenants').select('*').order('name').limit(500);
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    setState({ status: 'ready', tenants: data ?? [] });
  }, [supabase]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  return { state, reload: load };
}
