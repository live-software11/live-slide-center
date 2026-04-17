import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E — Sprint 1 / Fase 14.
 * Esecuzione locale: `pnpm exec playwright test` da apps/web/.
 * Richiede: dev server attivo (`pnpm dev`) o variabile BASE_URL impostata.
 * Variabili d'ambiente (opzionali, da .env.test):
 *   E2E_BASE_URL — default http://localhost:5173
 *   E2E_TENANT_A_EMAIL / E2E_TENANT_A_PASSWORD — credenziali tenant A
 *   E2E_TENANT_B_EMAIL / E2E_TENANT_B_PASSWORD — credenziali tenant B
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,   // evita conflitti su Supabase shared (dev/test)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Avvia il dev server localmente se non specificato altrimenti
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
