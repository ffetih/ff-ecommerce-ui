import { apiRequest } from '../../shared/api/httpClient';

export interface CustomerProfile {
  id: string;
  email: string;
  fullName: string;
  shippingAddress: string;
  active: boolean;
}

export interface RegisterProfileInput {
  fullName: string;
  shippingAddress: string;
}

export async function getMyProfile(): Promise<CustomerProfile> {
  const result = await apiRequest<CustomerProfile>('/api/v1/customers/me');
  return result.data;
}

export async function registerMyProfile(input: RegisterProfileInput): Promise<CustomerProfile> {
  const result = await apiRequest<CustomerProfile>('/api/v1/customers/me', {
    method: 'POST',
    body: input,
  });
  return result.data;
}

export async function updateMyShippingAddress(shippingAddress: string): Promise<CustomerProfile> {
  const result = await apiRequest<CustomerProfile>('/api/v1/customers/me/shipping-address', {
    method: 'PUT',
    body: { shippingAddress },
  });
  return result.data;
}

export async function getCustomerById(id: string): Promise<CustomerProfile> {
  const result = await apiRequest<CustomerProfile>(`/api/v1/customers/${encodeURIComponent(id)}`);
  return result.data;
}

export async function deactivateCustomer(id: string): Promise<CustomerProfile> {
  const result = await apiRequest<CustomerProfile>(`/api/v1/customers/${encodeURIComponent(id)}/deactivate`, {
    method: 'POST',
  });
  return result.data;
}
