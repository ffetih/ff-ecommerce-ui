import { apiRequest } from '../../shared/api/httpClient';

export interface Product {
  sku: string;
  name: string;
  unitPrice: number;
  currency: string;
  active: boolean;
}

export interface StockLevel {
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
}

export type ReservationStatus = 'RESERVED' | 'COMMITTED' | 'RELEASED';

export interface Reservation {
  orderId: string;
  status: ReservationStatus;
  lines: Array<{ sku: string; quantity: number }>;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  unitPrice: number;
  currency: string;
}

export interface ChangePriceInput {
  unitPrice: number;
  currency: string;
}

export interface GoodsReceiptInput {
  referenceId: string;
  quantity: number;
}

export async function listProducts(skus?: string[]): Promise<Product[]> {
  const params = new URLSearchParams();
  skus?.forEach((sku) => params.append('sku', sku));
  const query = params.toString();
  const path = query ? `/api/v1/products?${query}` : '/api/v1/products';
  // Public endpoint; still safe with valid token, skipAuth prevents failure if stale token exists
  const result = await apiRequest<Product[]>(path, { skipAuth: true });
  return result.data;
}

export async function getProduct(sku: string): Promise<Product> {
  const result = await apiRequest<Product>(`/api/v1/products/${encodeURIComponent(sku)}`, { skipAuth: true });
  return result.data;
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const result = await apiRequest<Product>('/api/v1/products', {
    method: 'POST',
    body: input,
  });
  return result.data;
}

export async function changeProductPrice(sku: string, input: ChangePriceInput): Promise<Product> {
  const result = await apiRequest<Product>(`/api/v1/products/${encodeURIComponent(sku)}/price`, {
    method: 'PUT',
    body: input,
  });
  return result.data;
}

export async function deactivateProduct(sku: string): Promise<Product> {
  const result = await apiRequest<Product>(`/api/v1/products/${encodeURIComponent(sku)}/deactivate`, {
    method: 'POST',
  });
  return result.data;
}

export async function getStock(sku: string): Promise<StockLevel> {
  const result = await apiRequest<StockLevel>(`/api/v1/stock/${encodeURIComponent(sku)}`);
  return result.data;
}

export async function receiveStock(sku: string, input: GoodsReceiptInput): Promise<StockLevel> {
  const result = await apiRequest<StockLevel>(`/api/v1/stock/${encodeURIComponent(sku)}/receipts`, {
    method: 'POST',
    body: input,
  });
  return result.data;
}

export async function getReservation(orderId: string): Promise<Reservation> {
  const result = await apiRequest<Reservation>(`/api/v1/reservations/${encodeURIComponent(orderId)}`);
  return result.data;
}
