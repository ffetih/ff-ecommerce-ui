import { expect, test } from '@playwright/test';
import { installMockOidc, PERSONAS } from '../fixtures/mockOidc';

test.describe('s09 Returns and s10 W3C traceparent observability', () => {
  test('clamps return quantities to remaining units, surfaces 422 verbatim, rotates Idempotency-Key, and links traces to Jaeger', async ({
    page,
  }) => {
    await installMockOidc(page, 'alice');

    const orderId = '66666666-6666-4666-8666-666666666666';
    const existingReturnId = '77777777-7777-4777-8777-777777777771';
    const createdReturnId = '77777777-7777-4777-8777-777777777772';

    const returnsList: Array<Record<string, unknown>> = [
      {
        id: existingReturnId,
        orderId,
        customerId: PERSONAS.alice.sub,
        status: 'REFUNDED',
        lines: [{ sku: 'KB-MECH-01', quantity: 1, unitPrice: 89.9, lineTotal: 89.9 }],
        refundAmount: 89.9,
        currency: 'EUR',
        reason: 'Keycap scratched',
        rejectionReason: null,
        createdAt: '2026-11-26T09:00:00Z',
      },
    ];
    const returnedUnits: Record<string, number> = { 'KB-MECH-01': 1 };
    const capturedTraceparents: Array<string | undefined> = [];
    const capturedIdemKeys: Array<string | undefined> = [];
    let postAttempts = 0;

    await page.route(`**/api/v1/orders/${orderId}`, async (route) => {
      capturedTraceparents.push(route.request().headers()['traceparent']);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: orderId,
          customerId: PERSONAS.alice.sub,
          status: 'DELIVERED',
          paymentStatus: 'CAPTURED',
          totalAmount: 269.7,
          currency: 'EUR',
          shippingAddress: 'Bağdat Cd. 1, İstanbul',
          cancellationReason: null,
          lines: [{ sku: 'KB-MECH-01', quantity: 3, unitPrice: 89.9, lineTotal: 269.7 }],
          createdAt: '2026-11-25T20:00:00Z',
        }),
      });
    });

    await page.route(`**/api/v1/orders/${orderId}/returns`, async (route) => {
      capturedTraceparents.push(route.request().headers()['traceparent']);
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ returns: returnsList, returnedUnits }),
        });
        return;
      }

      postAttempts += 1;
      capturedIdemKeys.push(route.request().headers()['idempotency-key']);
      const payload = route.request().postDataJSON() as {
        lines: Array<{ sku: string; quantity: number }>;
        reason: string;
      };

      if (postAttempts === 1) {
        await route.fulfill({
          status: 422,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Return refused',
            status: 422,
            detail: 'Not that many units of KB-MECH-01 can still be returned: 3 ordered, some already returned',
          }),
        });
        return;
      }

      const qty = payload.lines[0]?.quantity ?? 1;
      returnedUnits['KB-MECH-01'] = (returnedUnits['KB-MECH-01'] ?? 0) + qty;
      const created = {
        id: createdReturnId,
        orderId,
        customerId: PERSONAS.alice.sub,
        status: 'REQUESTED',
        lines: [{ sku: 'KB-MECH-01', quantity: qty, unitPrice: 89.9, lineTotal: 89.9 * qty }],
        refundAmount: 89.9 * qty,
        currency: 'EUR',
        reason: payload.reason,
        rejectionReason: null,
        createdAt: '2026-11-26T10:00:00Z',
      };
      returnsList.unshift(created);
      await route.fulfill({
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          Location: `/api/v1/returns/${createdReturnId}`,
        },
        body: JSON.stringify(created),
      });
    });

    await page.goto(`/orders/${orderId}`);
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();

    await expect(page.getByText('1 / 3 returned')).toBeVisible();
    await expect(page.getByText('2 unit(s) returnable')).toBeVisible();

    // Open Request return dialog and check max clamping + Idempotency-Key rotation
    await page.getByRole('button', { name: 'Request return', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    const qtyInput = dialog.getByLabel('KB-MECH-01');
    await expect(qtyInput).toHaveAttribute('max', '2');

    const keyCode = dialog.locator('.card', { hasText: 'Idempotency-Key' }).locator('code').first();
    const initialKey = await keyCode.textContent();
    await qtyInput.fill('2');
    const rotatedKey = await keyCode.textContent();
    expect(rotatedKey).not.toBe(initialKey);

    await dialog.getByLabel('Return reason').fill('Too loud for office');

    // Attempt 1 -> 422 ProblemDetail shown verbatim
    await dialog.getByRole('button', { name: 'Submit return request' }).click();
    await expect(dialog.getByText(/Not that many units of KB-MECH-01 can still be returned/i)).toBeVisible();

    // Retry with same key -> 201 Created
    await dialog.getByRole('button', { name: 'Retry same Idempotency-Key' }).click();
    await expect(dialog).toHaveCount(0);
    expect(capturedIdemKeys).toHaveLength(2);
    expect(capturedIdemKeys[0]).toBeTruthy();
    expect(capturedIdemKeys[1]).toBe(capturedIdemKeys[0]);

    await expect(page.getByText('Return requested (201 Created)')).toBeVisible();
    await expect(page.getByText('3 / 3 returned')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request return', exact: true })).toBeDisabled();

    // Verify W3C traceparent was propagated on every request and Jaeger link is exposed
    expect(capturedTraceparents.length).toBeGreaterThanOrEqual(3);
    for (const tp of capturedTraceparents) {
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }

    await page.getByRole('button', { name: /Inspector/i }).click();
    const jaegerLink = page.locator('aside[aria-label="Protocol inspector"] a', {
      hasText: 'Open in Jaeger',
    });
    await expect(jaegerLink).toBeVisible();
    await expect(jaegerLink).toHaveAttribute(
      'href',
      /^http:\/\/jaeger\.localtest\.me:8888\/trace\/[0-9a-f]{32}$/,
    );
    await expect(
      page.locator('aside[aria-label="Protocol inspector"]').getByRole('link', { name: 'Grafana' }),
    ).toBeVisible();
    await expect(
      page.locator('aside[aria-label="Protocol inspector"]').getByRole('link', { name: 'Mailpit' }),
    ).toBeVisible();
  });

  test('admin receives and rejects returns, polls RECEIVED -> REFUNDED, and hides returns on OVERDUE orders', async ({
    page,
  }) => {
    await installMockOidc(page, 'admin');

    const deliveredOrderId = '88881111-8888-4888-8888-888888888881';
    const overdueOrderId = '88882222-8888-4888-8888-888888888882';
    const retReceiveId = '99991111-9999-4999-8999-999999999991';
    const retRejectId = '99992222-9999-4999-8999-999999999992';

    let retReceiveStatus: 'REQUESTED' | 'RECEIVED' | 'REFUNDED' = 'REQUESTED';
    let retRejectStatus: 'REQUESTED' | 'REJECTED' = 'REQUESTED';
    let retRejectionReason: string | null = null;
    let pollAfterReceive = 0;

    await page.route('**/api/v1/orders?customerId=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: deliveredOrderId,
            customerId: PERSONAS.alice.sub,
            status: 'DELIVERED',
            paymentStatus: 'CAPTURED',
            totalAmount: 100.0,
            currency: 'EUR',
            shippingAddress: 'Bağdat Cd. 1, İstanbul',
            cancellationReason: null,
            lines: [{ sku: 'KB-01', quantity: 2, unitPrice: 50.0, lineTotal: 100.0 }],
            createdAt: '2026-11-26T09:00:00Z',
          },
          {
            id: overdueOrderId,
            customerId: PERSONAS.alice.sub,
            status: 'DELIVERED',
            paymentStatus: 'OVERDUE',
            totalAmount: 50.0,
            currency: 'EUR',
            shippingAddress: 'Bağdat Cd. 1, İstanbul',
            cancellationReason: null,
            lines: [{ sku: 'KB-01', quantity: 1, unitPrice: 50.0, lineTotal: 50.0 }],
            createdAt: '2026-11-26T08:00:00Z',
          },
        ]),
      });
    });

    await page.route('**/api/v1/shipments?orderId=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '12121212-1212-4121-8121-121212121212',
          orderId: deliveredOrderId,
          status: 'DELIVERED',
          trackingNumber: 'TRK-1234',
          shippingAddress: 'Bağdat Cd. 1, İstanbul',
          lines: [{ sku: 'KB-01', quantity: 2 }],
          updatedAt: '2026-11-26T09:30:00Z',
        }),
      });
    });

    await page.route('**/api/v1/reservations/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          orderId: deliveredOrderId,
          status: 'COMMITTED',
          lines: [{ sku: 'KB-01', quantity: 2 }],
        }),
      });
    });

    await page.route(`**/api/v1/orders/${deliveredOrderId}/returns`, async (route) => {
      if (retReceiveStatus === 'RECEIVED') {
        pollAfterReceive += 1;
        if (pollAfterReceive >= 2) {
          retReceiveStatus = 'REFUNDED';
        }
      }
      const returnedCount = 1 + (retRejectStatus === 'REQUESTED' ? 1 : 0);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          returns: [
            {
              id: retReceiveId,
              orderId: deliveredOrderId,
              customerId: PERSONAS.alice.sub,
              status: retReceiveStatus,
              lines: [{ sku: 'KB-01', quantity: 1, unitPrice: 50.0, lineTotal: 50.0 }],
              refundAmount: 50.0,
              currency: 'EUR',
              reason: 'Wrong layout',
              rejectionReason: null,
              createdAt: '2026-11-26T10:00:00Z',
            },
            {
              id: retRejectId,
              orderId: deliveredOrderId,
              customerId: PERSONAS.alice.sub,
              status: retRejectStatus,
              lines: [{ sku: 'KB-01', quantity: 1, unitPrice: 50.0, lineTotal: 50.0 }],
              refundAmount: 50.0,
              currency: 'EUR',
              reason: 'Second unit',
              rejectionReason: retRejectionReason,
              createdAt: '2026-11-26T10:05:00Z',
            },
          ],
          returnedUnits: { 'KB-01': returnedCount },
        }),
      });
    });

    await page.route(`**/api/v1/orders/${overdueOrderId}/returns`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ returns: [], returnedUnits: {} }),
      });
    });

    await page.route(`**/api/v1/returns/${retReceiveId}/receive`, async (route) => {
      retReceiveStatus = 'RECEIVED';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: retReceiveId,
          orderId: deliveredOrderId,
          customerId: PERSONAS.alice.sub,
          status: 'RECEIVED',
          lines: [{ sku: 'KB-01', quantity: 1, unitPrice: 50.0, lineTotal: 50.0 }],
          refundAmount: 50.0,
          currency: 'EUR',
          reason: 'Wrong layout',
          rejectionReason: null,
          createdAt: '2026-11-26T10:00:00Z',
        }),
      });
    });

    await page.route(`**/api/v1/returns/${retRejectId}/reject`, async (route) => {
      const payload = route.request().postDataJSON() as { reason: string };
      retRejectStatus = 'REJECTED';
      retRejectionReason = payload.reason;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: retRejectId,
          orderId: deliveredOrderId,
          customerId: PERSONAS.alice.sub,
          status: 'REJECTED',
          lines: [{ sku: 'KB-01', quantity: 1, unitPrice: 50.0, lineTotal: 50.0 }],
          refundAmount: 50.0,
          currency: 'EUR',
          reason: 'Second unit',
          rejectionReason: retRejectionReason,
          createdAt: '2026-11-26T10:05:00Z',
        }),
      });
    });

    await page.goto('/admin/operations');
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();

    await page.locator('tr', { hasText: deliveredOrderId.slice(0, 8) }).getByRole('button', { name: 'Inspect saga' }).click();
    await expect(page.getByText('Returns & Refunds (s09)')).toBeVisible();

    // Receive first return -> polls RECEIVED -> REFUNDED
    const receiveRow = page.locator('tr', { hasText: retReceiveId.slice(0, 8) });
    await receiveRow.getByRole('button', { name: 'Mark received' }).click();
    await expect(receiveRow.getByText('REFUNDED', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Reject second return -> REJECTED + quota drops from 2/2 to 1/2
    const rejectRow = page.locator('tr', { hasText: retRejectId.slice(0, 8) });
    await rejectRow.getByRole('button', { name: 'Reject' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Rejection reason').fill('Parcel never arrived');
    await dialog.getByRole('button', { name: 'Confirm rejection' }).click();

    await expect(rejectRow.getByText('REJECTED', { exact: true })).toBeVisible();
    await expect(rejectRow.getByText(/Parcel never arrived/)).toBeVisible();
    await expect(page.getByText('1 / 2 returned')).toBeVisible();

    // Switch to DELIVERED + OVERDUE order -> Request return button must not appear
    await page.locator('tr', { hasText: overdueOrderId.slice(0, 8) }).getByRole('button', { name: 'Inspect saga' }).click();
    await expect(page.getByText('Returns unavailable for this payment state')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request return', exact: true })).toHaveCount(0);
  });
});
