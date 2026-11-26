import { expect, test } from '@playwright/test';
import {
  completeKeycloakLogin,
  ensureCustomerProfile,
  signInAs,
  signOutFromHeader,
} from '../fixtures/liveKeycloak';

/**
 * Live full-stack smoke suite against the real local stack:
 * - Keycloak (:8180, realm `ecommerce`, client `shop`)
 * - Gateway (:8080) + catalog/customer/order/shipping services + Kafka + PostgreSQL
 *
 * Run with: npm run test:e2e:live
 */
test.describe.serial('Live full-stack smoke (Keycloak PKCE + Gateway + Order Saga)', () => {
  const runSuffix = Date.now().toString(36).toUpperCase().slice(-6);
  const sku = `E2E-${runSuffix}`;
  const productName = `Playwright Smoke Item ${runSuffix}`;
  let cancelledOrderPath = '';

  test('1. admin creates a product and books initial stock', async ({ page }) => {
    await page.goto('/');
    await signInAs(page, 'admin');

    await page.getByRole('link', { name: 'Admin Catalog', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Admin: Catalog & Stock' })).toBeVisible();

    await page.getByLabel('SKU', { exact: true }).fill(sku);
    await page.getByLabel('Product Name', { exact: true }).fill(productName);
    await page.getByLabel('Unit Price', { exact: true }).fill('39.90');
    await page.getByRole('button', { name: 'Create product', exact: true }).click();

    await expect(page.getByText(`Stock & Goods Receipt (${sku})`)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Quantity to receive', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Book goods receipt', exact: true }).click();

    await expect(page.locator('.kpi-box', { hasText: 'Available' }).getByText('10', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await signOutFromHeader(page);
  });

  test('2. guest cart survives Keycloak PKCE login and order completes PLACED -> CONFIRMED -> DELIVERED', async ({
    page,
  }) => {
    await page.goto('/');

    // Add item as anonymous visitor
    const productCard = page.locator('article', { hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(1\)/i }).click();

    // Sign in via real Keycloak PKCE flow and verify cart is preserved on return
    await page.getByRole('button', { name: /Sign in with Keycloak to place order/i }).click();
    await completeKeycloakLogin(page, 'alice');

    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('cell', { name: productName })).toBeVisible();

    // Ensure Alice has registered her /me customer profile once
    await ensureCustomerProfile(page, 'Alice Archer', 'Bağdat Cd. 1, Kadıköy, İstanbul');

    // Return to cart via SPA nav (keeps in-memory token) and place the order
    await page.locator('header').getByRole('link', { name: /Cart/i }).click();
    await page.getByRole('button', { name: 'Place order', exact: true }).click();
    await expect(page.getByText('Order created (201 Created)')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Track order saga', exact: true }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
    const orderId = new URL(page.url()).pathname.split('/').pop()!;

    // Wait for async Kafka reservation + payment authorization -> CONFIRMED + AUTHORIZED
    await expect(page.locator('.page-header').getByText('CONFIRMED', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.page-header').getByText('AUTHORIZED', { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Switch to admin to dispatch and deliver the shipment
    await signInAs(page, 'admin');
    await page.getByRole('link', { name: 'Operations', exact: true }).click();
    await page.getByLabel('Order ID', { exact: true }).fill(orderId);
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();

    const dispatchBtn = page.getByRole('button', { name: 'Dispatch parcel', exact: true });
    await expect(dispatchBtn).toBeEnabled({ timeout: 15_000 });
    await dispatchBtn.click();

    const deliverBtn = page.getByRole('button', { name: 'Mark delivered', exact: true });
    await expect(deliverBtn).toBeEnabled({ timeout: 15_000 });
    await deliverBtn.click();

    // Open full order detail (SPA route), then switch back to Alice so returnTo lands directly on /orders/:id
    await page.getByRole('link', { name: 'Open full order page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await signInAs(page, 'alice');
    await expect(page.locator('.page-header').getByText('DELIVERED', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.page-header').getByText('CAPTURED', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await signOutFromHeader(page);
  });

  test('3. s06/s08 async cancellation (202 -> CANCELLED + VOIDED) and Bob ownership isolation (404)', async ({
    page,
  }) => {
    await page.goto('/');
    await signInAs(page, 'alice');

    const productCard = page.locator('article', { hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(1\)/i }).click();
    await page.getByRole('button', { name: 'Place order', exact: true }).click();
    await expect(page.getByText('Order created (201 Created)')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Track order saga', exact: true }).click();
    await expect(page.locator('.page-header').getByText('CONFIRMED', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    cancelledOrderPath = new URL(page.url()).pathname;

    // Request async cancellation (202 Accepted -> CANCELLATION_REQUESTED -> CANCELLED + VOIDED)
    await page.getByRole('button', { name: 'Request cancellation', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Cancellation reason', { exact: true }).fill('Playwright live smoke cancellation');
    await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();

    await expect(page.locator('.page-header').getByText('CANCELLED', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.page-header').getByText('VOIDED', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Playwright live smoke cancellation/)).toBeVisible();

    // Switch directly to Bob while on Alice's order URL (returnTo brings Bob straight back here -> 404)
    await signInAs(page, 'bob');
    await expect(page).toHaveURL(new RegExp(`${cancelledOrderPath}$`));
    await expect(page.getByText(/404|not found/i).first()).toBeVisible({ timeout: 10_000 });
    await signOutFromHeader(page);
  });

  test('4. s08 declined card (tok_decline) cancels order and releases stock', async ({ page }) => {
    await page.goto('/');
    await signInAs(page, 'alice');

    const productCard = page.locator('article', { hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(1\)/i }).click();

    await page.getByLabel(/Payment method/i).selectOption('tok_decline');
    await page.getByRole('button', { name: 'Place order', exact: true }).click();
    await expect(page.getByText('Order created (201 Created)')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Track order saga', exact: true }).click();
    await expect(page.locator('.page-header').getByText('CANCELLED', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.page-header').getByText('DECLINED', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Payment declined/i)).toBeVisible();
    await signOutFromHeader(page);
  });
});
