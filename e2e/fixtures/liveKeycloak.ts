import { expect, type Page } from '@playwright/test';

/**
 * Completes the real Keycloak login page (ecommerce realm, `shop` PKCE client)
 * after an action triggers `signinRedirect()`.
 */
export async function completeKeycloakLogin(
  page: Page,
  username: string,
  password = username,
): Promise<void> {
  await page.waitForURL(/\/realms\/ecommerce\/protocol\/openid-connect\/auth/, { timeout: 15_000 });

  // Keycloak 26 locks the username on `prompt=login` re-authentication until "Restart login" is clicked.
  const restartBtn = page.getByRole('button', { name: 'Restart login' });
  const usernameInput = page.locator('#username');
  await expect(restartBtn.or(usernameInput)).toBeVisible({ timeout: 15_000 });
  if (await restartBtn.isVisible()) {
    await restartBtn.click();
  }

  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  await usernameInput.fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL((url) => url.origin === 'http://localhost:5173' && !url.pathname.startsWith('/callback'), {
    timeout: 15_000,
  });
  await expect(page.locator('header').getByText(username, { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function signInAs(page: Page, username: string, password = username): Promise<void> {
  const switchBtn = page.locator('header').getByRole('button', { name: 'Switch', exact: true });
  if (await switchBtn.isVisible()) {
    await switchBtn.click();
  } else {
    await page.locator('header').getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await completeKeycloakLogin(page, username, password);
}

export async function signOutFromHeader(page: Page): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.origin === 'http://localhost:5173', { timeout: 15_000 });
  await expect(page.locator('header').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
}

/**
 * Registers `/api/v1/customers/me` if this persona has not completed onboarding yet.
 */
export async function ensureCustomerProfile(
  page: Page,
  fullName: string,
  shippingAddress: string,
): Promise<void> {
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'My Customer Profile' })).toBeVisible();

  const createBtn = page.getByRole('button', { name: 'Create profile' });
  const saveBtn = page.getByRole('button', { name: 'Save address' });
  await expect(createBtn.or(saveBtn)).toBeVisible({ timeout: 10_000 });

  if (await createBtn.isVisible()) {
    await page.getByLabel('Full name').fill(fullName);
    await page.getByLabel('Default shipping address').fill(shippingAddress);
    await createBtn.click();
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
  }
}
