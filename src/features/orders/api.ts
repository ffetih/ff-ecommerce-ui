import { apiRequest } from '../../shared/api/httpClient';
import type { ApiResult } from '../../shared/api/types';

export type OrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'CANCELLATION_REQUESTED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderLine {
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: OrderLine[];
  totalAmount: number;
  currency: string;
  shippingAddress: string;
  cancellationReason: string | null;
  createdAt: string;
}

export interface PlaceOrderInput {
  lines: Array<{ sku: string; quantity: number }>;
  shippingAddress?: string;
}

export function isOrderInFlight(status: OrderStatus): boolean {
  return status === 'PLACED' || status === 'CANCELLATION_REQUESTED';
}

export async function placeOrder(
  input: PlaceOrderInput,
  idempotencyKey: string,
): Promise<ApiResult<Order>> {
  return apiRequest<Order>('/api/v1/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: input.shippingAddress?.trim()
      ? { lines: input.lines, shippingAddress: input.shippingAddress.trim() }
      : { lines: input.lines },
  });
}

export async function listOrders(customerId?: string): Promise<Order[]> {
  const path = customerId
    ? `/api/v1/orders?customerId=${encodeURIComponent(customerId)}`
    : '/api/v1/orders';
  const result = await apiRequest<Order[]>(path);
  return result.data;
}

export async function getOrder(orderId: string): Promise<Order> {
  const result = await apiRequest<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}`);
  return result.data;
}

/**
 * Returns 200 (CANCELLED immediately for PLACED orders) or 202 (CANCELLATION_REQUESTED for CONFIRMED
 * orders while shipping-service decides).
 */
export async function cancelOrder(orderId: string, reason: string): Promise<ApiResult<Order>> {
  return apiRequest<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}
