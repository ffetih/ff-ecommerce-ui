import { expect, test } from '@playwright/test';
import {
  completeKeycloakLogin,
  ensureCustomerProfile,
  signInAs,
  signOutFromHeader,
} from '../fixtures/liveKeycloak';

/**
 * Live full-stack smoke suite against the real k3d/Flux cluster (default: *.localtest.me:8888)
 * or Docker Compose (`npm run dev:compose`):
 * - Keycloak (`keycloak.localtest.me:8888`, realm `ecommerce`, client `shop`)
 * - Gateway (`shop.localtest.me:8888`) + all 5 backend services + Kafka + PostgreSQL + Jaeger
 *
 * Run with: npm run test:e2e:live
 */
test.describe.serial('Live full-stack smoke (k3d/Flux + Keycloak PKCE + Saga + Payments + Returns)', () => {
  const runSuffix = Date.now().toString(36).toUpperCase().slice(-6);
  const sku = `E2E-${runSuffix}`;
  const productName = `Playwright Smoke Item ${runSuffix}`;
  let deliveredOrderId = '';
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

  test('2. guest cart survives Keycloak PKCE login and 2-unit order completes PLACED -> CONFIRMED -> DELIVERED', async ({
    page,
  }) => {
    await page.goto('/');

    // Add item as anonymous visitor
    const productCard = page.locator('article', { hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(1\)/i }).click();

    // Increase quantity to 2 so test 3 can verify partial return + reject
    await page.getByRole('button', { name: `Increase quantity for ${sku}` }).click();
    await expect(page.locator('header').getByRole('link', { name: /Cart\s*2/i })).toBeVisible();

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
    await expect(page.getByRole('link', { name: 'Open trace in Jaeger' })).toBeVisible();

    await page.getByRole('button', { name: 'Track order saga', exact: true }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
    deliveredOrderId = new URL(page.url()).pathname.split('/').pop()!;

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
    await page.getByLabel('Order ID', { exact: true }).fill(deliveredOrderId);
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();

    const dispatchBtn = page.getByRole('button', { name: 'Dispatch parcel', exact: true });
    await expect(dispatchBtn).toBeEnabled({ timeout: 15_000 });
    await dispatchBtn.click();

    const deliverBtn = page.getByRole('button', { name: 'Mark delivered', exact: true });
    await expect(deliverBtn).toBeEnabled({ timeout: 15_000 });
    await deliverBtn.click();

    // Open full order detail (SPA route), then switch back to Alice so returnTo lands directly on /orders/:id
    await page.getByRole('link', { name: 'Open full order page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${deliveredOrderId}$`));
    await signInAs(page, 'alice');
    await expect(page.locator('.page-header').getByText('DELIVERED', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.page-header').getByText('CAPTURED', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await signOutFromHeader(page);
  });

  test('3. s09 partial return -> admin receive -> REFUNDED + catalog restock, and reject releases quota', async ({
    page,
  }) => {
    await page.goto(`/orders/${deliveredOrderId}`);
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
    await completeKeycloakLogin(page, 'alice');

    await expect(page.getByText('0 / 2 returned')).toBeVisible({ timeout: 10_000 });

    // Alice requests a partial return of 1 unit
    await page.getByRole('button', { name: 'Request return', exact: true }).click();
    const requestDialog = page.locator('dialog[open]');
    await expect(requestDialog.getByLabel(sku)).toHaveAttribute('max', '2');
    await requestDialog.getByLabel(sku).fill('1');
    await requestDialog.getByLabel('Return reason').fill('Playwright live partial return');
    await requestDialog.getByRole('button', { name: 'Submit return request' }).click();

    await expect(page.getByText('Return requested (201 Created)')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('1 / 2 returned')).toBeVisible({ timeout: 10_000 });

    // Alice also requests a return for the 2nd unit so admin can reject it
    await page.getByRole('button', { name: 'Request return', exact: true }).click();
    await expect(requestDialog.getByLabel(sku)).toHaveAttribute('max', '1');
    await requestDialog.getByLabel('Return reason').fill('Playwright live rejected return');
    await requestDialog.getByRole('button', { name: 'Submit return request' }).click();

    await expect(page.getByText('2 / 2 returned')).toBeVisible({ timeout: 10_000 });

    // Switch directly to admin on the same order page -> receive first, reject second
    await signInAs(page, 'admin');
    await expect(page).toHaveURL(new RegExp(`/orders/${deliveredOrderId}$`));

    const receiveRow = page.locator('tr', { hasText: 'Playwright live partial return' });
    await receiveRow.getByRole('button', { name: 'Mark received' }).click();
    await expect(receiveRow.getByText('REFUNDED', { exact: true })).toBeVisible({ timeout: 20_000 });

    const rejectRow = page.locator('tr', { hasText: 'Playwright live rejected return' });
    await rejectRow.getByRole('button', { name: 'Reject' }).click();
    const rejectDialog = page.locator('dialog[open]');
    await rejectDialog.getByLabel('Rejection reason').fill('Parcel not returned');
    await rejectDialog.getByRole('button', { name: 'Confirm rejection' }).click();

    await expect(rejectRow.getByText('REJECTED', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('1 / 2 returned')).toBeVisible({ timeout: 10_000 });

    // Verify catalog restocked 1 unit (10 received - 2 dispatched + 1 returned = 9 onHand)
    await page.getByRole('link', { name: 'Admin Catalog', exact: true }).click();
    await page.locator('tr', { hasText: sku }).getByRole('button', { name: 'Stock' }).click();
    await expect(page.locator('.kpi-box', { hasText: 'On Hand' }).getByText('9', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Verify Protocol Inspector shows live W3C traceId and Jaeger deep link
    await page.getByRole('button', { name: /Inspector/i }).click();
    await expect(
      page.locator('aside[aria-label="Protocol inspector"] a', { hasText: 'Open in Jaeger' }),
    ).toBeVisible();
    await signOutFromHeader(page);
  });

  test('4. s06/s08 async cancellation (202 -> CANCELLED + VOIDED) and Bob ownership isolation (404)', async ({
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

  test('5. s08 declined card (tok_decline) cancels order and releases stock', async ({ page }) => {
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
