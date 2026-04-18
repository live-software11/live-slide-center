import { createBrowserRouter } from 'react-router';
import { AdminRootLayout } from './admin-root-layout';
import { DesktopRoleGate } from './desktop-role-gate';
import { HydrateFallback } from './hydrate-fallback';
import { RootLayout } from './root-layout';
import { RequireAuth } from './require-auth';
import { RequireSuperAdmin } from './require-super-admin';
import { RequireTenantAdmin } from './require-tenant-admin';

export const router = createBrowserRouter([
  {
    HydrateFallback,
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
                    index: true,
                    lazy: () => import('@/features/team/TeamView'),
                  },
                ],
              },
              {
                path: 'audit',
                element: <RequireTenantAdmin />,
                children: [
                  {
                    index: true,
                    lazy: () => import('@/features/audit/AuditView'),
                  },
                ],
              },
              {
                path: 'billing',
                element: <RequireTenantAdmin />,
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
]);
