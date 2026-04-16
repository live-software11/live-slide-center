import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@/lib/i18n';
import '@/index.css';
import { initSentry } from '@/lib/init-sentry';
import { router } from '@/app/routes';
import { Providers } from '@/app/providers';

void initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
