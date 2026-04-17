import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useAuth } from '@/app/use-auth';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import {
  fetchLicenseSummary,
  fetchStorageSummary,
  type LicenseSummary,
  type StorageSummary,
} from '../repository';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minuti

interface UseTenantWarningsResult {
  license: LicenseSummary | null;
  storage: StorageSummary | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Polling delle metriche licenza/storage del tenant per banner warning.
 * Skipping per super_admin (non hanno tenant_id) e in assenza di sessione.
 */
export function useTenantWarnings(): UseTenantWarningsResult {
  const { session } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tenantId = getTenantIdFromSession(session);
  const role = session?.user?.app_metadata?.role as string | undefined;
  const enabled = Boolean(tenantId) && role !== 'super_admin';

  const [license, setLicense] = useState<LicenseSummary | null>(null);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [licResult, stoResult] = await Promise.allSettled([
        fetchLicenseSummary(supabase),
        fetchStorageSummary(supabase),
      ]);
      if (cancelledRef.current) return;
      if (licResult.status === 'fulfilled') setLicense(licResult.value);
      if (stoResult.status === 'fulfilled') setStorage(stoResult.value);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [enabled, supabase]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled) {
      setLicense(null);
      setStorage(null);
      return;
    }
    void refresh();
    const handle = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(handle);
    };
  }, [enabled, refresh]);

  return { license, storage, loading, refresh };
}
