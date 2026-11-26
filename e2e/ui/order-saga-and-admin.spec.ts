import { expect, test } from '@playwright/test';
import { installMockOidc, PERSONAS } from '../fixtures/mockOidc';

test.describe('Order saga lifecycle, async cancel, and role boundaries', () => {
  test('polls PLACED -> CONFIRMED automatically and handles 202 async cancellation modal', async ({
    page,
  }) => {
    await installMockOidc(page, 'alice');

    const orderId = '33333333-3333-4333-8333-333333333333';
    let currentStatus: 'PLACED' | 'CONFIRMED' | 'CANCELLATION_REQUESTED' | 'CANCELLED' = 'PLACED';
    let cancellationReason: string | null = null;
    let getCount = 0;

    await page.route(`**/api/v1/orders/${orderId}`, async (route) => {
      getCount += 1;
      if (currentStatus === 'PLACED' && getCount >= 2) {
        currentStatus = 'CONFIRMED';
      } else if (currentStatus === 'CANCELLATION_REQUESTED' && getCount >= 4) {
        currentStatus = 'CANCELLED';
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: orderId,
          customerId: PERSONAS.alice.sub,
          status: currentStatus,
          totalAmount: 89.9,
          currency: 'EUR',
          shippingAddress: 'Bağdat Cd. 1, İstanbul',
          cancellationReason,
          lines: [{ sku: 'KB-MECH-01', quantity: 1, unitPrice: 89.9, lineTotal: 89.9 }],
          createdAt: '2026-11-25T20:00:00Z',
        }),
      });
    });

    await page.route(`**/api/v1/orders/${orderId}/cancel`, async (route) => {
      const payload = route.request().postDataJSON() as { reason: string };
      currentStatus = 'CANCELLATION_REQUESTED';
      cancellationReason = payload.reason;

      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          id: orderId,
          customerId: PERSONAS.alice.sub,
          status: currentStatus,
          totalAmount: 89.9,
          currency: 'EUR',
          shippingAddress: 'Bağdat Cd. 1, İstanbul',
          cancellationReason,
          lines: [{ sku: 'KB-MECH-01', quantity: 1, unitPrice: 89.9, lineTotal: 89.9 }],
          createdAt: '2026-11-25T20:00:00Z',
        }),
      });
    });

    await page.goto(`/orders/${orderId}`);
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();

    // Auto-polling advances from PLACED to CONFIRMED
    await expect(page.getByRole('button', { name: 'Request cancellation' })).toBeVisible({ timeout: 5_000 });

    // Native <dialog> opens and closes cleanly on Escape
    await page.getByRole('button', { name: 'Request cancellation' }).click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Reopen and submit cancellation -> 202 Accepted -> auto-polls to CANCELLED
    await page.getByRole('button', { name: 'Request cancellation' }).click();
    await dialog.getByLabel('Cancellation reason').fill('Ordered wrong switch type');
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();

    await expect(page.getByText(/Ordered wrong switch type/)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.page-header').getByText('CANCELLED')).toBeVisible({ timeout: 5_000 });
  });

  test('enforces customer vs admin role boundary and renders single-row admin navigation', async ({ page }) => {
    const oidc = await installMockOidc(page, 'alice');
    await page.setViewportSize({ width: 1280, height: 800 });

    const products = [
      { sku: 'KB-MECH-01', name: 'Mechanical Keyboard', unitPrice: 89.9, currency: 'EUR', active: true },
    ];
    await page.route('**/api/v1/products', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          sku: string;
          name: string;
          unitPrice: number;
          currency: string;
        };
        const created = { ...body, sku: body.sku.toUpperCase(), active: true };
        products.push(created);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(products) });
    });

    await page.route('**/api/v1/stock/*', async (route) => {
      const sku = route.request().url().split('/').pop() ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sku, onHand: 12, reserved: 2, available: 10 }),
      });
    });

    // Customer visiting /admin/catalog hits role guard
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
    await expect(page.getByText('Insufficient role (403 boundary)')).toBeVisible();

    // Switch persona to admin (must pass prompt=login to Keycloak)
    oidc.setPersona('admin');
    await page.getByRole('button', { name: 'Switch', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Admin: Catalog & Stock' })).toBeVisible();
    expect(oidc.authRequests.at(-1)?.prompt).toBe('login');

    // All 6 admin topbar links fit cleanly on a single row without horizontal overflow at 1280px
    const navLinks = page.locator('header nav a');
    await expect(navLinks).toHaveCount(6);
    const ys = await navLinks.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4);
    const hasOverflow = await page.locator('header').evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(hasOverflow).toBe(false);

    // Inspect stock counters for KB-MECH-01
    await page.locator('tr', { hasText: 'KB-MECH-01' }).getByRole('button', { name: 'Stock' }).click();
    await expect(page.getByText('Stock & Goods Receipt (KB-MECH-01)')).toBeVisible();
    await expect(page.locator('.kpi-box', { hasText: 'Available' }).getByText('10')).toBeVisible();
  });
});
