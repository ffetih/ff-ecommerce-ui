import { expect, test } from '@playwright/test';
import { installMockOidc } from '../fixtures/mockOidc';

const SAMPLE_PRODUCTS = [
  { sku: 'KB-MECH-01', name: 'Mechanical Keyboard', unitPrice: 89.9, currency: 'EUR', active: true },
  { sku: 'MOUSE-01', name: 'Wireless Mouse', unitPrice: 24.5, currency: 'EUR', active: true },
  { sku: 'OLD-MOUSE', name: 'Retired Ball Mouse', unitPrice: 9.0, currency: 'EUR', active: false },
];

test.describe('Public catalog and Keycloak PKCE flow', () => {
  test('browses public catalog without sending an Authorization header and respects off-sale items', async ({
    page,
  }) => {
    const seenAuthHeaders: (string | undefined)[] = [];
    await page.route('**/api/v1/products', async (route) => {
      seenAuthHeaders.push(route.request().headers()['authorization']);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SAMPLE_PRODUCTS),
      });
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Product Catalog' })).toBeVisible();
    await expect(page.getByText('Mechanical Keyboard')).toBeVisible();
    await expect(page.getByText('Retired Ball Mouse')).toBeVisible();

    // Public catalog call must not send any Authorization header while logged out
    expect(seenAuthHeaders.length).toBeGreaterThan(0);
    expect(seenAuthHeaders.every((h) => h === undefined)).toBe(true);

    // Off-sale product cannot be added to cart
    const retiredCard = page.locator('article', { hasText: 'Retired Ball Mouse' });
    await expect(retiredCard.getByRole('button', { name: /add to cart/i })).toBeDisabled();

    // Hiding off-sale products removes it from the grid
    await page.getByLabel('Show off-sale products').uncheck();
    await expect(page.getByText('Retired Ball Mouse')).toHaveCount(0);

    // Search filters by SKU or name
    await page.getByLabel('Filter by product name or SKU').fill('KB-MECH');
    await expect(page.getByText('Mechanical Keyboard')).toBeVisible();
    await expect(page.getByText('Wireless Mouse')).toHaveCount(0);
  });

  test('preserves guest cart across S256 PKCE login redirect, keeps tokens out of localStorage, and signs out cleanly', async ({
    page,
  }) => {
    const oidc = await installMockOidc(page, 'alice');
    await page.route('**/api/v1/products', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SAMPLE_PRODUCTS),
      });
    });

    await page.goto('/');

    // Add item as anonymous guest and navigate to cart
    const keyboardCard = page.locator('article', { hasText: 'Mechanical Keyboard' });
    await keyboardCard.getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(1\)/i }).click();

    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('button', { name: /Sign in with Keycloak to place order/i })).toBeVisible();

    // Trigger real oidc-client-ts Authorization Code + PKCE flow
    await page.getByRole('button', { name: /Sign in with Keycloak to place order/i }).click();

    // Returned back to /cart after /callback with cart intact and alice authenticated
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.locator('header').getByText('alice')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
    await expect(page.getByRole('cell', { name: 'Mechanical Keyboard' })).toBeVisible();

    // Verify PKCE S256 contract parameters sent to Keycloak
    expect(oidc.authRequests).toHaveLength(1);
    expect(oidc.authRequests[0]).toMatchObject({
      clientId: 'shop',
      responseType: 'code',
      scope: 'openid',
      codeChallengeMethod: 'S256',
      redirectUri: 'http://localhost:5173/callback',
    });
    expect(oidc.authRequests[0]?.codeChallenge).toBeTruthy();

    expect(oidc.tokenRequests).toHaveLength(1);
    expect(oidc.tokenRequests[0]).toMatchObject({
      grantType: 'authorization_code',
      clientId: 'shop',
      redirectUri: 'http://localhost:5173/callback',
    });
    expect(oidc.tokenRequests[0]?.codeVerifier).toBeTruthy();

    // Tokens stay strictly in memory (never written to localStorage)
    const localStorageKeys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(localStorageKeys).toEqual([]);

    // Protocol Inspector displays decoded claims and client flow
    await page.getByRole('button', { name: /Inspector/i }).click();
    await expect(page.getByText('shop (Authorization Code + PKCE S256)')).toBeVisible();
    await expect(page.getByText('order-service')).toBeVisible();

    // Sign out runs RP-initiated logout and clears session
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(oidc.logoutRequests).toHaveLength(1);
    expect(oidc.logoutRequests[0]?.postLogoutRedirectUri).toBe('http://localhost:5173/');
  });
});
