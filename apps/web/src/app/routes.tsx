import { createBrowserRouter } from 'react-router';
import { AdminRootLayout } from './admin-root-layout';
import { DesktopRoleGate } from './desktop-role-gate';
import { HydrateFallback } from './hydrate-fallback';
import { RootLayout } from './root-layout';
import { RequireAuth } from './require-auth';
import { RequireCloudFeature } from './require-cloud-feature';
import { RequireSuperAdmin } from './require-super-admin';
import { RequireTenantAdmin } from './require-tenant-admin';
import { RouteErrorView } from './route-error';

export const router = createBrowserRouter([
  {
    HydrateFallback,
    // Sprint U-7 — `errorElement` al root del router cattura ogni throw nei
    // Component/loader/action delle route figlie e mostra una UI brand-coerente
    // ("RouteErrorView") al posto del banner default di React Router
    // ("Hey developer 👋"). Cura anche il caso "PWA cache vecchia che non
    // conosce route nuove": il bottone "Ricarica" forza l'aggiornamento.
    errorElement: <RouteErrorView />,
    // Sprint L1: in modalita Tauri, intercetta la SPA per chiedere il ruolo
    // (admin | sala) UNA volta sola e ridirigere i PC sala su /pair. In
    // modalita cloud (browser) e' un no-op che monta direttamente <Outlet/>.
    Component: DesktopRoleGate,
    children: [
      {
        path: '/u/:token',
        lazy: () => import('@/features/upload-portal/UploadPortalView'),
      },
      {
        path: '/pair',
        lazy: () => import('@/features/devices/PairView'),
      },
      {
        path: '/sala/:token',
        lazy: () => import('@/features/devices/RoomPlayerView'),
      },
      // Sprint U-4 (UX V2.0) — magic-link "zero-friction": il PC sala apre
      // questo URL UNA volta, viene paired in background e rimbalzato su
      // /sala/:token. Niente keypad, niente conferma manuale.
      {
        path: '/sala-magic/:token',
        lazy: () => import('@/features/devices/MagicProvisionView'),
      },
      {
        // Sprint D1 — Pagina licenza desktop (bind, verify, reset).
        // Accessibile in modalita desktop sia da admin che da PC sala (e' uno
        // stato del PC stesso, non del tenant). In cloud mostra un avviso.
        path: '/centro-slide/licenza',
        lazy: () => import('@/features/desktop-license/DesktopLicenseView'),
      },
      {
        // Sprint D5 — Deep-link "/centro-slide/bind?t=<token>" aperto dai
        // magic-link generati dal pannello Centri Slide. In modalita
        // desktop fa il bind in automatico; in modalita cloud mostra
        // istruzioni "apri questo URL sul PC server".
        path: '/centro-slide/bind',
        lazy: () => import('@/features/desktop-license/DesktopBindAutoView'),
      },
      // Sprint T-3-G (G10): telecomando remoto via tablet. Rotta pubblica
      // (auth via token nel path), nessun JWT richiesto.
      {
        path: '/remote/:token',
        lazy: () => import('@/features/remote-control/RemoteControlView'),
      },
      {
        path: '/login',
        lazy: () => import('@/features/auth/LoginView'),
      },
      {
        path: '/status',
        lazy: () => import('@/features/status/StatusView'),
      },
      {
        path: '/signup',
        lazy: () => import('@/features/auth/SignupView'),
      },
      {
        path: '/forgot-password',
        lazy: () => import('@/features/auth/ForgotPasswordView'),
      },
      {
        path: '/reset-password',
        lazy: () => import('@/features/auth/ResetPasswordView'),
      },
      {
        path: '/accept-invite/:token',
        lazy: () => import('@/features/auth/AcceptInviteView'),
      },
      {
        path: '/admin',
        element: <RequireSuperAdmin />,
        children: [
          {
            element: <AdminRootLayout />,
            children: [
              {
                index: true,
                lazy: () => import('@/features/admin/AdminDashboardView'),
              },
              {
                path: 'tenants',
                lazy: () => import('@/features/admin/AdminTenantsView'),
              },
              {
                path: 'tenants/:tenantId',
                lazy: () => import('@/features/admin/AdminTenantDetailView'),
              },
              {
                path: 'audit',
                lazy: () => import('@/features/admin/AdminAuditView'),
              },
              {
                path: 'health',
                lazy: () => import('@/features/admin/AdminHealthView'),
              },
            ],
          },
        ],
      },
      {
        path: '/',
        element: <RequireAuth />,
        children: [
          {
            element: <RootLayout />,
            children: [
              {
                index: true,
                lazy: () => import('@/features/dashboard/DashboardView'),
              },
              {
                path: 'events',
                lazy: () => import('@/features/events/EventsView'),
              },
              {
                path: 'events/:eventId',
                lazy: () => import('@/features/events/EventDetailView'),
              },
              {
                path: 'events/:eventId/production',
                lazy: () => import('@/features/events/ProductionView'),
              },
              {
                path: 'events/:eventId/live',
                lazy: () => import('@/features/live-view/OnAirView'),
              },
              {
                path: 'settings',
                lazy: () => import('@/features/settings/SettingsView'),
              },
              {
                path: 'settings/privacy',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    index: true,
                    lazy: () => import('@/features/settings/privacy/PrivacyView'),
                  },
                ],
              },
              {
                path: 'team',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    // Sprint W D3: gestione team/inviti utenti dipende da
                    // tenants cloud + Auth Supabase → cloud-only.
                    element: <RequireCloudFeature feature="tenant-admin" />,
                    children: [
                      {
                        index: true,
                        lazy: () => import('@/features/team/TeamView'),
                      },
                    ],
                  },
                ],
              },
              {
                // Sprint D5 — Pannello admin "Centri Slide": gestisce PC
                // desktop server (licenze) + magic-link bind + ruolo PC sala
                // (room ↔ control_center). Solo tenant admin.
                path: 'centri-slide',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    index: true,
                    lazy: () => import('@/features/desktop-devices/DesktopDevicesView'),
                  },
                ],
              },
              {
                // Sprint Z (post-field-test) Gap A — Network Map del tenant.
                // Vista unificata di TUTTI i PC node (paired + desktop server)
                // con stato online/degraded/offline derivato lato DB e azione
                // "sposta PC sull'evento X" (Gap B). Solo tenant admin.
                path: 'network-map',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    index: true,
                    lazy: () => import('@/features/network-map/NetworkMapView'),
                  },
                ],
              },
              {
                path: 'audit',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    // Sprint W D3: audit log multi-evento → cloud-only.
                    element: <RequireCloudFeature feature="audit-log-export" />,
                    children: [
                      {
                        index: true,
                        lazy: () => import('@/features/audit/AuditView'),
                      },
                    ],
                  },
                ],
              },
              {
                path: 'billing',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    // Sprint W D3: checkout Lemon Squeezy + webhook → cloud-only.
                    element: <RequireCloudFeature feature="billing" />,
                    children: [
                      {
                        index: true,
                        lazy: () => import('@/features/billing/BillingView'),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // Sprint U-7 — Catch-all route. Sta DOPO tutte le altre per evitare di
      // shadoware i path validi. Mostra `RouteErrorView` per qualsiasi URL non
      // riconosciuto (typo, magic-link rotti, link condivisi a route rimosse,
      // PWA cache vecchia che apre URL di route nuove non ancora bundled).
      {
        path: '*',
        element: <RouteErrorView />,
      },
    ],
  },
]);
