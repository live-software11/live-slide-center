import { i18n } from '@slidecenter/shared/i18n';
import { Outlet } from 'react-router';
import { createBrowserRouter } from 'react-router';
import { AdminRootLayout } from './admin-root-layout';
import { RootLayout } from './root-layout';
import { RequireAuth } from './require-auth';
import { RequireSuperAdmin } from './require-super-admin';
import { RequireTenantAdmin } from './require-tenant-admin';

function HydrateFallback() {
  return <p className="p-8 text-sc-text-muted">{i18n.t('common.loading')}</p>;
}

export const router = createBrowserRouter([
  {
    HydrateFallback,
    Component: Outlet,
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
      {
        path: '/login',
        lazy: () => import('@/features/auth/LoginView'),
      },
      {
        path: '/signup',
        lazy: () => import('@/features/auth/SignupView'),
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
                path: 'events/:eventId/live',
                lazy: () => import('@/features/live-view/LiveRegiaView'),
              },
              {
                path: 'settings',
                lazy: () => import('@/features/settings/SettingsView'),
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
