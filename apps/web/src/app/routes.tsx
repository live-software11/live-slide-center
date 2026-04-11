import { createBrowserRouter } from 'react-router';
import { RootLayout } from './root-layout';

export const router = createBrowserRouter([
  {
    path: '/',
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
]);
