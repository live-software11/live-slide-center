import { AppShell } from './shell/AppShell';

/**
 * Sprint U-1 (UX redesign): AdminRootLayout e' diventato un thin wrapper
 * sull'AppShell shadcn con `variant="admin"` (palette accent + sezione
 * "Amministrazione" + link rapido "Torna al tenant").
 */
export function AdminRootLayout() {
  return <AppShell variant="admin" />;
}
