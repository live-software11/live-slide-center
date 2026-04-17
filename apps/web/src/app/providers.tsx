import type { ReactNode } from 'react';
import { AuthProvider } from './auth-provider';
import { ToastProvider } from '@/components/ToastProvider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
