import { apiRequest } from '../../shared/api/httpClient';
import type { ApiResult } from '../../shared/api/types';
import type { Order } from '../orders/api';

export type ReturnStatus = 'REQUESTED' | 'RECEIVED' | 'REJECTED' | 'REFUNDED' | 'REFUND_FAILED';

export interface ReturnLine {
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReturnRecord {
  id: string;
  orderId: string;
  customerId: string;
  status: ReturnStatus;
  lines: ReturnLine[];
  refundAmount: number;
  currency: string;
  reason: string;
  rejectionReason: string | null;
  createdAt: string;
}

export interface OrderReturnsResponse {
  returns: ReturnRecord[];
  returnedUnits: Record<string, number>;
}

export interface RequestReturnInput {
  lines: Array<{ sku: string; quantity: number }>;
  reason: string;
}

export interface ReturnableLineQuota {
  sku: string;
  ordered: number;
  returned: number;
  remaining: number;
  unitPrice: number;
}

export function isReturnInFlight(status: ReturnStatus): boolean {
  return status === 'RECEIVED';
}

export function canOrderBeReturned(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  return order.status === 'DELIVERED' && order.paymentStatus === 'CAPTURED';
}

export function remainingReturnableUnits(
  order: Pick<Order, 'lines'>,
  returnedUnits: Record<string, number> = {},
): ReturnableLineQuota[] {
  return order.lines.map((line) => {
    const returned = Math.max(0, returnedUnits[line.sku] ?? 0);
    const remaining = Math.max(0, line.quantity - returned);
    return {
      sku: line.sku,
      ordered: line.quantity,
      returned,
      remaining,
      unitPrice: line.unitPrice,
    };
  });
}

export async function listOrderReturns(orderId: string): Promise<OrderReturnsResponse> {
  const result = await apiRequest<OrderReturnsResponse>(
    `/api/v1/orders/${encodeURIComponent(orderId)}/returns`,
  );
  return result.data;
}

export async function getReturn(returnId: string): Promise<ReturnRecord> {
  const result = await apiRequest<ReturnRecord>(`/api/v1/returns/${encodeURIComponent(returnId)}`);
  return result.data;
}

/**
 * Requests a return of delivered order lines (ADR-0010).
 * Answers 201 Created, 200 + Idempotent-Replayed: true on identical key replay,
 * 409 on non-delivered order or key reuse with different payload, or 422 on business rule violation.
 */
export async function requestReturn(
  orderId: string,
  input: RequestReturnInput,
  idempotencyKey: string,
): Promise<ApiResult<ReturnRecord>> {
  return apiRequest<ReturnRecord>(`/api/v1/orders/${encodeURIComponent(orderId)}/returns`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      lines: input.lines,
      reason: input.reason.trim(),
    },
  });
}

/** Back office marks parcel arrived: triggers catalog restock and payment refund asynchronously. */
export async function receiveReturn(returnId: string): Promise<ApiResult<ReturnRecord>> {
  return apiRequest<ReturnRecord>(`/api/v1/returns/${encodeURIComponent(returnId)}/receive`, {
    method: 'POST',
  });
}

/** Back office rejects a requested return: releases its units back into the returnable quota. */
export async function rejectReturn(returnId: string, reason: string): Promise<ApiResult<ReturnRecord>> {
  return apiRequest<ReturnRecord>(`/api/v1/returns/${encodeURIComponent(returnId)}/reject`, {
    method: 'POST',
    body: { reason: reason.trim() },
  });
}
