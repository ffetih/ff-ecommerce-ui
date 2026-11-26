import type { OrderStatus } from './api';
import type { PaymentStatus } from '../payments/model';

interface SagaTimelineProps {
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  cancellationReason: string | null;
}

type StepState = 'pending' | 'active' | 'done' | 'warning' | 'danger';

interface TimelineStep {
  id: string;
  label: string;
  desc: string;
  state: StepState;
}

/**
 * Visualizes the order saga (ADR-0007 + ADR-0009 payments):
 *   PLACED (reserve -> authorize) -> CONFIRMED -> SHIPPED (capture) -> DELIVERED
 *   CONFIRMED -> CANCELLATION_REQUESTED (shipping decides) -> CANCELLED (void) | SHIPPED
 */
export function SagaTimeline({ status, paymentStatus, cancellationReason }: SagaTimelineProps) {
  let steps: TimelineStep[];

  if (status === 'CANCELLED') {
    const paymentNote =
      paymentStatus === 'DECLINED'
        ? 'Card declined — nothing charged'
        : paymentStatus === 'VOIDED'
          ? 'Payment hold voided'
          : paymentStatus === 'VOIDING'
            ? 'Voiding payment hold…'
            : null;
    const cancelDesc = [
      cancellationReason ? `Reason: ${cancellationReason}` : 'Stock released & shipment stopped',
      paymentNote,
    ]
      .filter(Boolean)
      .join(' · ');

    steps = [
      { id: 'placed', label: '1. Placed', desc: 'Order recorded & outbox event emitted', state: 'done' },
      {
        id: 'cancelled',
        label: '2. Cancelled',
        desc: cancelDesc,
        state: 'danger',
      },
    ];
  } else if (status === 'CANCELLATION_REQUESTED') {
    steps = [
      { id: 'placed', label: '1. Placed', desc: 'Order stored', state: 'done' },
      {
        id: 'confirmed',
        label: '2. Confirmed',
        desc:
          paymentStatus === 'AUTHORIZED'
            ? 'Stock reserved & payment authorized'
            : 'Stock reserved in catalog',
        state: 'done',
      },
      {
        id: 'cancel-req',
        label: '3. Cancellation Requested',
        desc: 'Waiting on shipping-service (202 Accepted) to cancel or refuse',
        state: 'warning',
      },
      {
        id: 'outcome',
        label: '4. Final Outcome',
        desc: 'Cancelled (stock released, payment voided) or Shipped (dispatch won)',
        state: 'pending',
      },
    ];
  } else {
    const orderRank: Record<'PLACED' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED', number> = {
      PLACED: 0,
      CONFIRMED: 1,
      SHIPPED: 2,
      DELIVERED: 3,
    };
    const rank = orderRank[status];
    const stepState = (stepIdx: number): StepState => {
      if (rank > stepIdx) return 'done';
      if (rank === stepIdx) return stepIdx === 3 ? 'done' : 'active';
      return 'pending';
    };

    const placedDesc =
      paymentStatus === 'AUTHORIZING'
        ? 'Stock reserved; waiting for payment authorization'
        : 'Awaiting stock reservation & payment authorization';

    const shippedState: StepState =
      paymentStatus === 'OVERDUE' && rank >= 2 ? 'warning' : stepState(2);
    const shippedDesc =
      paymentStatus === 'OVERDUE'
        ? 'Parcel dispatched; payment capture failed (OVERDUE)'
        : paymentStatus === 'CAPTURING'
          ? 'Parcel dispatched; capturing payment…'
          : paymentStatus === 'CAPTURED'
            ? 'Parcel dispatched; stock committed & payment captured'
            : 'Parcel dispatched; stock committed & capture triggered';

    steps = [
      { id: 'placed', label: '1. Placed', desc: placedDesc, state: stepState(0) },
      {
        id: 'confirmed',
        label: '2. Confirmed',
        desc: 'Stock reserved & payment authorized; shipment prepared',
        state: stepState(1),
      },
      { id: 'shipped', label: '3. Shipped', desc: shippedDesc, state: shippedState },
      { id: 'delivered', label: '4. Delivered', desc: 'Carrier confirmed delivery', state: stepState(3) },
    ];
  }

  return (
    <ol className="saga-steps" aria-label="Order saga progress">
      {steps.map((step) => (
        <li key={step.id} className="saga-step" data-state={step.state}>
          <span className="saga-step-label">{step.label}</span>
          <span className="saga-step-desc">{step.desc}</span>
        </li>
      ))}
    </ol>
  );
}
