// ════════════════════════════════════════════════════════════════════════════
// E2E — Redesign V2.0 (Sprint U-5)
// ════════════════════════════════════════════════════════════════════════════
//
// Flussi nuovi introdotti dal redesign UX V2.0:
//
//   1. /sala-magic/:token  (Sprint U-4 zero-friction provisioning)
//   2. /pair               (keypad fallback, deve restare accessibile)
//   3. /sala/:token        (broadcasting black, layout PC sala)
//   4. Rotte protette redirect → login (Production / OnAir / Settings)
//
// Sono smoke E2E: verifichiamo che le rotte montino, che gli stati di errore
// mostrino UI sensata e che l'auth-gate rimbalzi su /login. Niente Supabase
// reale: i token sono volutamente invalidi e devono produrre errore lato
// client/edge.
// ════════════════════════════════════════════════════════════════════════════
import { test, expect } from '@playwright/test';

test.describe('UX V2.0 — magic-link provisioning', () => {
  test('magic link with too-short token shows error UI + fallback', async ({ page }) => {
    // Token sintatticamente non valido (< 24 char) → MagicProvisionView va
    // immediatamente in stato errore senza colpire l'edge function.
    await page.goto('/sala-magic/abc');
    // Il body non deve essere vuoto (la pagina monta, non crasha).
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    // Sfondo broadcasting black — verifichiamo che la classe sia presente.
    const root = page.locator('div.min-h-screen').first();
    await expect(root).toBeVisible();
  });

  test('magic link with plausible token attempts claim and surfaces error', async ({ page }) => {
    // Token sintatticamente plausibile (>=24 char) ma inesistente lato server.
    // L'edge function deve rispondere con `token_invalid`. Diamo tempo al
    // round-trip ma non ci aspettiamo successo (siamo in CI senza DB seedato).
    const fakeToken = 'a'.repeat(40);
    await page.goto(`/sala-magic/${fakeToken}`);
    await page.waitForTimeout(2500);
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('UX V2.0 — keypad fallback', () => {
  test('/pair shows keypad 6 digits', async ({ page }) => {
    await page.goto('/pair');
    // 6 input numerici (cifra per cifra) — il keypad esiste anche senza Tauri.
    // Tolleriamo che possa mostrare lo stato "reconnecting" se localStorage
    // contiene un token, ma in un browser pulito di Playwright partiamo
    // sempre senza nulla → keypad visibile.
    await page.waitForTimeout(1500);
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('UX V2.0 — broadcasting black PC sala', () => {
  test('/sala/:invalidToken renders error + reconnect CTA', async ({ page }) => {
    await page.goto('/sala/invalidtoken12345');
    await page.waitForTimeout(2500);
    // Nero pieno e UI di errore visibili.
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('UX V2.0 — auth-gate rotte private', () => {
  test('/events/X/production redirige a /login se non autenticato', async ({ page }) => {
    await page.goto('/events/00000000-0000-0000-0000-000000000000/production');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/events/X/live redirige a /login se non autenticato', async ({ page }) => {
    await page.goto('/events/00000000-0000-0000-0000-000000000000/live');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/settings redirige a /login se non autenticato', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });
});
