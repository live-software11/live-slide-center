import { createBrowserRouter } from 'react-router';
import { RootLayout } from './root-layout';
import { RequireAuth } from './require-auth';

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
