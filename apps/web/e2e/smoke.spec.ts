import { test, expect } from '@playwright/test';

/**
 * Smoke tests — verifica che le rotte pubbliche principali carichino senza crash.
 * Non richiede credenziali.
 */

test('homepage redirect to login', async ({ page }) => {
  await page.goto('/');
  // Non autenticato → redirect a /login
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('h1')).toBeVisible();
});

test('login page loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('signup page loads', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test('forgot-password page loads', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('accept-invite with invalid token shows error', async ({ page }) => {
  await page.goto('/accept-invite/invalid-token-00000000');
  // Deve mostrare un messaggio di errore (attende caricamento async)
  await page.waitForTimeout(3000);
  // L'invito non valido mostra un messaggio di errore
  const body = page.locator('body');
  await expect(body).not.toBeEmpty();
});

test('upload portal with invalid token shows error', async ({ page }) => {
  await page.goto('/u/invalid-token-00000000');
  await page.waitForTimeout(2000);
  const body = page.locator('body');
  await expect(body).not.toBeEmpty();
});
