export type PaymentStatus =
  | 'NOT_REQUESTED'
  | 'AUTHORIZING'
  | 'AUTHORIZED'
  | 'DECLINED'
  | 'VOIDING'
  | 'VOIDED'
  | 'CAPTURING'
  | 'CAPTURED'
  | 'OVERDUE';

export interface SimulatedCardOption {
  token: string;
  label: string;
  outcome: string;
}

export const DEFAULT_CARD_TOKEN = 'tok_ok';

/**
 * Simulated card tokens recognized by payment-service's SimulatedPaymentProvider (ADR-0009).
 * Card numbers never reach the backend; the token selects the deterministic provider outcome.
 */
export const SIMULATED_CARD_TOKENS: readonly SimulatedCardOption[] = [
  {
    token: 'tok_ok',
    label: 'Approved card (tok_ok)',
    outcome: 'Authorizes hold on reserve, captures money when warehouse dispatches.',
  },
  {
    token: 'tok_decline',
    label: 'Declined card (tok_decline)',
    outcome: 'Declined during authorization; stock is released and order becomes CANCELLED.',
  },
  {
    token: 'tok_slow',
    label: 'Slow / timeout provider (tok_slow)',
    outcome: 'First authorize times out (stays AUTHORIZING); resolver retries with same key and approves.',
  },
  {
    token: 'tok_capture_fails',
    label: 'Capture fails at dispatch (tok_capture_fails)',
    outcome: 'Authorizes & confirms, but capture declines at dispatch; order stays SHIPPED and payment becomes OVERDUE.',
  },
];

export function isPaymentInFlight(status?: PaymentStatus): boolean {
  return status === 'AUTHORIZING' || status === 'VOIDING' || status === 'CAPTURING';
}

export function customerPaymentLabel(status?: PaymentStatus): string {
  switch (status) {
    case 'CAPTURED':
      return 'Paid';
    case 'AUTHORIZED':
      return 'Authorized (held)';
    case 'AUTHORIZING':
      return 'Waiting for payment';
    case 'CAPTURING':
      return 'Capturing payment';
    case 'VOIDING':
      return 'Releasing hold';
    case 'VOIDED':
      return 'Not charged (voided)';
    case 'DECLINED':
      return 'Declined (not charged)';
    case 'OVERDUE':
      return 'Payment overdue';
    case 'NOT_REQUESTED':
    default:
      return 'Not charged yet';
  }
}

export function paymentStatusDescription(status?: PaymentStatus): string {
  switch (status) {
    case 'NOT_REQUESTED':
      return 'Waiting for catalog-service to reserve stock before authorizing payment.';
    case 'AUTHORIZING':
      return 'Authorization command sent to payment-service; waiting for provider decision.';
    case 'AUTHORIZED':
      return 'Funds are held on the card; money will be captured when the parcel is dispatched.';
    case 'DECLINED':
      return 'Card was declined by the provider; nothing was charged and stock is released.';
    case 'VOIDING':
      return 'Order cancelled; releasing the card authorization hold.';
    case 'VOIDED':
      return 'Card authorization hold was released; customer was not charged.';
    case 'CAPTURING':
      return 'Parcel dispatched; capturing funds from the card authorization.';
    case 'CAPTURED':
      return 'Funds captured and booked to the double-entry ledger.';
    case 'OVERDUE':
      return 'Parcel left the warehouse, but capture failed. Order remains SHIPPED; requires back-office collection.';
    default:
      return 'Payment status not reported.';
  }
}
