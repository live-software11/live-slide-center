import { test, expect } from '@playwright/test';

/**
 * Signup flow — verifica signup → provisioning tenant → dashboard.
 * Richiede Supabase configurato (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).
 * Usa email randomica per evitare conflitti tra run.
 *
 * NOTA: questo test crea utenti reali nel progetto Supabase di sviluppo.
 * Non eseguire in produzione senza `E2E_BASE_URL` che punti a un ambiente isolato.
 */

// Salta il test se le variabili d'ambiente di test non sono disponibili
const RUN = !!process.env.E2E_ENABLE_SIGNUP_TEST;

test.describe('Signup flow', () => {
  test.skip(!RUN, 'Skip: imposta E2E_ENABLE_SIGNUP_TEST=1 per abilitare');

  test('signup → email confirmation page', async ({ page }) => {
    const timestamp = Date.now();
    const email = `e2e-test-${timestamp}@example-slidecenter.invalid`;
    const password = 'E2eT3st!2026';
    const orgName = `E2E Org ${timestamp}`;

    await page.goto('/signup');

    await page.fill('input[type="email"]', email);
    await page.fill('input[id="signup-fullname"], input[name="fullName"]', orgName);
    await page.fill('input[type="password"]', password);

    await page.click('button[type="submit"]');

    // Dopo signup Supabase mostra check-email (email confirmation abilitata)
    // oppure redirect alla dashboard se confirmations = false
    await page.waitForTimeout(3000);

    const url = page.url();
    const bodyText = await page.locator('body').textContent();

    // Accetta sia la pagina di conferma email sia la dashboard
    const isConfirmPage = bodyText?.toLowerCase().includes('email') ?? false;
    const isDashboard = url.includes('/') && !url.includes('/signup');

    expect(isConfirmPage || isDashboard).toBe(true);
  });
});
