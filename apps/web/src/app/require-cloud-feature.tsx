import { Outlet } from 'react-router';
import { isCloudFeatureAvailable, type CloudOnlyFeature } from '@/lib/backend-mode';
import { FeatureNotAvailableView } from '@/components/FeatureNotAvailableView';

/**
 * Sprint W D3 — route guard per le feature cloud-only.
 *
 * Si usa come layout component in `routes.tsx`:
 *
 *   {
 *     path: 'billing',
 *     element: <RequireTenantAdmin />,
 *     children: [
 *       {
 *         element: <RequireCloudFeature feature="billing" />,
 *         children: [{ index: true, lazy: () => import('./BillingView') }],
 *       },
 *     ],
 *   }
 *
 * Discriminante runtime: `getBackendMode()`. In cloud → `<Outlet />` (passa
 * oltre). In desktop → `<FeatureNotAvailableView />` con CTA "apri versione
 * cloud".
 *
 * Ordine consigliato: `RequireCloudFeature` DOPO le auth/role guards
 * (RequireAuth, RequireTenantAdmin) perche' la decisione "feature
 * disponibile?" e' indipendente dal ruolo dell'utente.
 */
export function RequireCloudFeature({ feature }: { feature: CloudOnlyFeature }) {
  if (!isCloudFeatureAvailable(feature)) {
    return <FeatureNotAvailableView feature={feature} />;
  }
  return <Outlet />;
}
