import { startTransition, useCallback, useEffect, useState } from 'react';
import type { EventRow } from '../repository';
import { createTenantEvent, listTenantEvents } from '../repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; events: EventRow[] };

export function useEvents(supabase: SupabaseClient<Database>, tenantId: string | null) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await listTenantEvents(supabase);
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    setState({ status: 'ready', events: data ?? [] });
  }, [supabase, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    startTransition(() => {
      void load();
    });
  }, [load, tenantId]);

  const create = useCallback(
    async (input: { name: string; start_date: string; end_date: string }) => {
      if (!tenantId) return { errorMessage: 'missing_tenant' };
      const { error } = await createTenantEvent(supabase, tenantId, input);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  return { state, reload: load, create };
}
