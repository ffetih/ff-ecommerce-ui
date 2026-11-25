import { apiRequest } from '../../shared/api/httpClient';

export type ShipmentStatus = 'CREATED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';

export interface Shipment {
  id: string;
  orderId: string;
  status: ShipmentStatus;
  trackingNumber: string | null;
  shippingAddress: string;
  lines: Array<{ sku: string; quantity: number }>;
  updatedAt: string;
}

export async function getShipmentByOrder(orderId: string): Promise<Shipment> {
  const result = await apiRequest<Shipment>(`/api/v1/shipments?orderId=${encodeURIComponent(orderId)}`);
  return result.data;
}

export async function getShipment(shipmentId: string): Promise<Shipment> {
  const result = await apiRequest<Shipment>(`/api/v1/shipments/${encodeURIComponent(shipmentId)}`);
  return result.data;
}

export async function dispatchShipment(shipmentId: string): Promise<Shipment> {
  const result = await apiRequest<Shipment>(`/api/v1/shipments/${encodeURIComponent(shipmentId)}/dispatch`, {
    method: 'POST',
  });
  return result.data;
}

export async function deliverShipment(shipmentId: string): Promise<Shipment> {
  const result = await apiRequest<Shipment>(`/api/v1/shipments/${encodeURIComponent(shipmentId)}/deliver`, {
    method: 'POST',
  });
  return result.data;
}
