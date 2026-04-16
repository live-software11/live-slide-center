import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { fetchCrossTenantAudit, type ActivityRow } from '../repository';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: ActivityRow[] };

export function useAdminAuditLog(supabase: SupabaseClient<Database>) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    const { data, error } = await fetchCrossTenantAudit(supabase, 200);
    if (error || !data) {
      setState({ status: 'error', message: error ?? 'unknown' });
      return;
    }
    setState({ status: 'ready', rows: data });
  }, [supabase]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  return { state, reload: load };
}
