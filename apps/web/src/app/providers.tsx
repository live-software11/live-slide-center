import type { ReactNode } from 'react';
import { AuthProvider } from './auth-provider';
import { SupabaseEnvMissingScreen } from './supabase-env-missing-screen';
import { isSupabaseBrowserConfigured } from '@/lib/supabase';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  if (!isSupabaseBrowserConfigured()) {
    return <SupabaseEnvMissingScreen />;
  }
  return <AuthProvider>{children}</AuthProvider>;
}
