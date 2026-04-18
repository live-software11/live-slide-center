import { AppShell } from './shell/AppShell';

/**
 * Sprint U-1 (UX redesign): RootLayout e' diventato un thin wrapper
 * sull'AppShell shadcn. La logica navigazione/auth/sidebar live qui:
 * `apps/web/src/app/shell/AppShell.tsx`.
 */
export function RootLayout() {
  return <AppShell variant="tenant" />;
}
