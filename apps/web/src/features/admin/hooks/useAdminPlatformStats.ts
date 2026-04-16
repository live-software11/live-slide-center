import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { fetchPlatformAdminStats, type PlatformAdminStats } from '../repository';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stats: PlatformAdminStats };

export function useAdminPlatformStats(supabase: SupabaseClient<Database>) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    const { data, error } = await fetchPlatformAdminStats(supabase);
    if (error || !data) {
      setState({ status: 'error', message: error ?? 'unknown' });
      return;
    }
    setState({ status: 'ready', stats: data });
  }, [supabase]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  return { state, reload: load };
}
