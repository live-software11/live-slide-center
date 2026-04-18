import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthContext } from './auth-context';
import { SupabaseEnvMissingScreen } from './supabase-env-missing-screen';
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from '@/lib/supabase';
import { getBackendMode } from '@/lib/backend-mode';
import { getCachedDesktopBackendInfo } from '@/lib/desktop-backend-init';
import { buildDesktopAdminSession } from '@/lib/desktop-fake-session';

/**
 * Sprint J/cloud → esteso in Sprint O2 (GUIDA_OPERATIVA_v3 §4.G).
 *
 * Tre flussi possibili:
 *   • cloud: comportamento originale (Supabase Auth + onAuthStateChange).
 *   • desktop+admin: sessione fittizia locale (LOCAL_TENANT_ID + LOCAL_ADMIN_USER_ID).
 *     Salta TUTTO il flow Supabase Auth — il backend Rust locale non ha auth.
 *   • desktop+sala: questa branch non viene mai raggiunta perche'
 *     `DesktopRoleGate` redirige le sale a `/sala/:token` prima del
 *     `<RequireAuth>` (il PairView/RoomPlayer non usano `useAuth`).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (getBackendMode() === 'desktop') {
    return <DesktopAuthProvider>{children}</DesktopAuthProvider>;
  }
  if (!isSupabaseBrowserConfigured()) {
    return <SupabaseEnvMissingScreen />;
  }
  return <CloudAuthProvider>{children}</CloudAuthProvider>;
}

function CloudAuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo(() => ({ session, loading }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const session = useMemo<Session | null>(() => {
    const info = getCachedDesktopBackendInfo();
    if (!info?.admin_token) return null;
    if (info.role !== 'admin') return null;
    return buildDesktopAdminSession(info.admin_token);
  }, []);

  const value = useMemo(() => ({ session, loading: false }), [session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
