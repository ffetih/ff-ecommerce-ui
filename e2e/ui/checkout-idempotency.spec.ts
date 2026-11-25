import { expect, test } from '@playwright/test';
import { installMockOidc, PERSONAS } from '../fixtures/mockOidc';

const MIXED_PRODUCTS = [
  { sku: 'KB-EUR', name: 'Keyboard EUR', unitPrice: 80.0, currency: 'EUR', active: true },
  { sku: 'PAD-USD', name: 'Desk Pad USD', unitPrice: 25.0, currency: 'USD', active: true },
];

test.describe('Cart and idempotent checkout protocol', () => {
  test('blocks mixed currencies and rotates Idempotency-Key whenever cart contents change', async ({ page }) => {
    await installMockOidc(page, 'alice');
    await page.route('**/api/v1/products', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MIXED_PRODUCTS),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('header').getByText('alice')).toBeVisible();

    await page.locator('article', { hasText: 'Keyboard EUR' }).getByRole('button', { name: /add to cart/i }).click();
    await page.locator('article', { hasText: 'Desk Pad USD' }).getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(2\)/i }).click();

    await expect(page.getByText('Mixed currencies detected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();

    const keyCode = page.locator('.card', { hasText: 'Idempotency-Key' }).locator('code').first();
    const keyBeforeRemove = await keyCode.textContent();

    await page.getByRole('button', { name: 'Remove PAD-USD' }).click();
    await expect(page.getByText('Mixed currencies detected')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();

    const keyAfterRemove = await keyCode.textContent();
    expect(keyAfterRemove).not.toBe(keyBeforeRemove);

    await page.getByRole('button', { name: 'Increase quantity for KB-EUR' }).click();
    const keyAfterQty = await keyCode.textContent();
    expect(keyAfterQty).not.toBe(keyAfterRemove);
  });

  test('reuses exact Idempotency-Key on 503 Retry-After and surfaces 200 Idempotent-Replayed', async ({
    page,
  }) => {
    await installMockOidc(page, 'alice');
    await page.route('**/api/v1/products', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([MIXED_PRODUCTS[0]]),
      });
    });

    const receivedKeys: (string | undefined)[] = [];
    let attempt = 0;
    const orderId = '22222222-2222-4222-8222-222222222222';
    const orderPayload = {
      id: orderId,
      customerId: PERSONAS.alice.sub,
      status: 'PLACED',
      totalAmount: 80.0,
      currency: 'EUR',
      shippingAddress: 'Bağdat Cd. 1, İstanbul',
      cancellationReason: null,
      lines: [{ sku: 'KB-EUR', quantity: 1, unitPrice: 80.0, lineTotal: 80.0 }],
      createdAt: '2026-11-25T20:00:00Z',
    };

    await page.route('**/api/v1/orders', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      attempt += 1;
      receivedKeys.push(route.request().headers()['idempotency-key']);

      if (attempt === 1) {
        await route.fulfill({
          status: 503,
          headers: {
            'Content-Type': 'application/problem+json',
            'Retry-After': '5',
          },
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Service Unavailable',
            status: 503,
            detail: 'catalog-service is temporarily unreachable; retry with the same Idempotency-Key',
          }),
        });
        return;
      }

      if (attempt === 2) {
        await route.fulfill({
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            Location: `/api/v1/orders/${orderId}`,
          },
          body: JSON.stringify(orderPayload),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Idempotent-Replayed': 'true',
        },
        body: JSON.stringify(orderPayload),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('header').getByText('alice')).toBeVisible();

    await page.locator('article', { hasText: 'Keyboard EUR' }).getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /Cart \(1\)/i }).click();

    // Attempt 1 -> 503 + Retry-After
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText(/temporarily unreachable/i)).toBeVisible();
    await expect(page.getByText(/Retry-After:\s*5/i)).toBeVisible();

    // Attempt 2 -> Retry with the exact same Idempotency-Key -> 201 Created
    await page.getByRole('button', { name: 'Retry same Idempotency-Key' }).click();
    await expect(page.getByText('Order created (201 Created)')).toBeVisible();

    // Attempt 3 -> Replay same key -> 200 + Idempotent-Replayed: true
    await page.getByRole('button', { name: 'Replay same key' }).click();
    await expect(page.getByText('Idempotent replay (200 — Idempotent-Replayed: true)')).toBeVisible();

    // Every attempt carried the exact same non-empty UUID key
    expect(receivedKeys).toHaveLength(3);
    expect(receivedKeys[0]).toBeTruthy();
    expect(receivedKeys[1]).toBe(receivedKeys[0]);
    expect(receivedKeys[2]).toBe(receivedKeys[0]);
  });
});
