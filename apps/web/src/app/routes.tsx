import { Outlet } from 'react-router';
import { createBrowserRouter } from 'react-router';
import { AdminRootLayout } from './admin-root-layout';
import { HydrateFallback } from './hydrate-fallback';
import { RootLayout } from './root-layout';
import { RequireAuth } from './require-auth';
import { RequireSuperAdmin } from './require-super-admin';
import { RequireTenantAdmin } from './require-tenant-admin';

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
                path: 'events/:eventId/live',
                lazy: () => import('@/features/live-view/LiveRegiaView'),
              },
              {
                path: 'settings',
                lazy: () => import('@/features/settings/SettingsView'),
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
