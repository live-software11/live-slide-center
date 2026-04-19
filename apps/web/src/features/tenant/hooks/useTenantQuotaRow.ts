import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
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

  // BUGFIX 2026-04-19 (Sprint X-2): cancelledRef + cleanup nell'useEffect.
  //
  // WHY: senza guard, se il componente smonta mentre `fetchTenantQuotaRow`
  // e' in flight, l'`await` risolve dopo l'unmount e i `setState` successivi
  // generano memory leak + React warning ("Can't perform a React state update
  // on an unmounted component"). Lo standard di progetto richiede `cancelled`
  // flag su tutti gli hook dati (vedi `.cursor/rules/02-quality-gate.mdc`
  // sezione "Standard di codice"). Pattern equivalente a `useTenantWarnings.ts`:
  // ref invece di local var perche' `load`/`reload` e' esposta al consumer e
  // va protetta anche su invocazioni esterne fuori dal lifecycle dell'effect.
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    if (cancelledRef.current) return;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    const { data, error } = await fetchTenantQuotaRow(supabase, tenantId);
    if (cancelledRef.current) return;
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
    cancelledRef.current = false;
    if (!tenantId) return;
    startTransition(() => {
      void load();
    });
    return () => {
      cancelledRef.current = true;
    };
  }, [load, tenantId]);

  return { state, reload: load };
}
