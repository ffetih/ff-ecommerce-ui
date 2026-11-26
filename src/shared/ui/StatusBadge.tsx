interface StatusBadgeProps {
  status: string;
}

const TONE_MAP: Record<string, string> = {
  // Order statuses
  PLACED: 'badge-info',
  CONFIRMED: 'badge-brand',
  CANCELLATION_REQUESTED: 'badge-warning',
  SHIPPED: 'badge-info',
  DELIVERED: 'badge-success',
  CANCELLED: 'badge-danger',
  // Shipment statuses
  CREATED: 'badge-brand',
  DISPATCHED: 'badge-info',
  // Reservation statuses
  RESERVED: 'badge-brand',
  COMMITTED: 'badge-success',
  RELEASED: 'badge-warning',
  // Payment statuses (s08)
  NOT_REQUESTED: 'badge-neutral',
  AUTHORIZING: 'badge-info',
  AUTHORIZED: 'badge-brand',
  DECLINED: 'badge-danger',
  VOIDING: 'badge-warning',
  VOIDED: 'badge-warning',
  CAPTURING: 'badge-info',
  CAPTURED: 'badge-success',
  OVERDUE: 'badge-danger',
  // Return statuses (s09)
  REQUESTED: 'badge-warning',
  RECEIVED: 'badge-info',
  REFUNDED: 'badge-success',
  REFUND_FAILED: 'badge-danger',
  REJECTED: 'badge-danger',
  // Active flags / roles
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-danger',
  DEACTIVATED: 'badge-danger',
  OFF_SALE: 'badge-warning',
  admin: 'badge-warning',
  customer: 'badge-brand',
  service: 'badge-info',
  monitoring: 'badge-info',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone = TONE_MAP[status] ?? 'badge-neutral';
  const label = status.replace(/_/g, ' ');
  return <span className={`badge ${tone}`}>{label}</span>;
}
