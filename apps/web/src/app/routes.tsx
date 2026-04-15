import { createBrowserRouter } from 'react-router';
import { AdminRootLayout } from './admin-root-layout';
import { RootLayout } from './root-layout';
import { RequireAuth } from './require-auth';
import { RequireSuperAdmin } from './require-super-admin';

export const router = createBrowserRouter([
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
            path: 'settings',
            lazy: () => import('@/features/settings/SettingsView'),
          },
        ],
      },
    ],
  },
]);
