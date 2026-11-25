import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, RefreshCw } from 'lucide-react';
import { cancelOrder, getOrder, isOrderInFlight } from './api';
import { SagaTimeline } from './SagaTimeline';
import { useAuth } from '../auth/authContext';
import { ModalDialog } from '../../shared/ui/ModalDialog';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
import { useAccessibleValidation } from '../../shared/ui/useAccessibleValidation';
import { formatDateTime, formatMoney } from '../../shared/utils/format';

const POLL_BACKOFF_MS = [500, 1000, 1500, 2000, 3000] as const;
const MAX_POLL_WINDOW_MS = 30_000;

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const { isAuthenticated, hasRole, login } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [lastCancelHttpStatus, setLastCancelHttpStatus] = useState<number | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const pollStartRef = useRef<number | null>(null);
  const pollAttemptRef = useRef(0);
  const trackedStatusRef = useRef<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  useAccessibleValidation(formRef);
  const reasonId = useId();
  const reasonErrId = useId();

  function resetPollWindow() {
    pollStartRef.current = Date.now();
    pollAttemptRef.current = 0;
    setPollTimedOut(false);
  }

  useEffect(() => {
    pollStartRef.current = null;
    pollAttemptRef.current = 0;
    trackedStatusRef.current = null;
    setPollTimedOut(false);
  }, [orderId]);

  const orderQuery = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => getOrder(orderId),
    enabled: isAuthenticated && orderId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || !isOrderInFlight(status)) {
        pollStartRef.current = null;
        pollAttemptRef.current = 0;
        return false;
      }
      if (trackedStatusRef.current !== status) {
        trackedStatusRef.current = status;
        pollStartRef.current = Date.now();
        pollAttemptRef.current = 0;
      }
      const started = pollStartRef.current ?? Date.now();
      if (Date.now() - started >= MAX_POLL_WINDOW_MS) {
        return false;
      }
      const delay = POLL_BACKOFF_MS[Math.min(pollAttemptRef.current, POLL_BACKOFF_MS.length - 1)];
      pollAttemptRef.current += 1;
      return delay;
    },
  });

  const currentStatus = orderQuery.data?.status;
  useEffect(() => {
    if (!currentStatus || !isOrderInFlight(currentStatus)) {
      setPollTimedOut(false);
      return;
    }
    const started = pollStartRef.current ?? Date.now();
    pollStartRef.current = started;
    const remaining = Math.max(0, MAX_POLL_WINDOW_MS - (Date.now() - started));
    const timer = window.setTimeout(() => {
      setPollTimedOut(true);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [currentStatus, orderQuery.dataUpdatedAt]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelOrder(orderId, reason.trim()),
    onSuccess: (result) => {
      setLastCancelHttpStatus(result.status);
      queryClient.setQueryData(['orders', 'detail', orderId], result.data);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      setCancelOpen(false);
      setReason('');
      if (result.status === 202) {
        resetPollWindow();
        notify('Cancellation requested (202 Accepted) — waiting for shipping-service decision', 'warning');
      } else {
        notify('Order cancelled immediately (200 OK)', 'success');
      }
    },
  });

  function handleCancelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return;
    cancelMutation.mutate();
  }

  if (!isAuthenticated) {
    return (
      <div className="card stack-md" style={{ maxWidth: 520, margin: '2rem auto' }}>
        <h2 className="card-title">Sign in to view this order</h2>
        <p className="muted" style={{ margin: 0 }}>
          Order endpoints require the owner&apos;s token or an admin token. Calling for someone
          else&apos;s order always answers <code>404</code> (anti-enumeration, ADR-0008).
        </p>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void login();
            }}
          >
            Sign in with Keycloak
          </button>
        </div>
      </div>
    );
  }

  const order = orderQuery.data;
  const inFlight = Boolean(order && isOrderInFlight(order.status));
  const canCancel = order && (order.status === 'PLACED' || order.status === 'CONFIRMED');
  const backPath = hasRole('admin') ? '/admin/operations' : '/orders';

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div className="stack-sm">
          <Link to={backPath} className="row muted" style={{ fontSize: '0.88rem' }}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back to orders
          </Link>
          <div className="row">
            <h1>Order Details</h1>
            {order ? <StatusBadge status={order.status} /> : null}
            {inFlight && !pollTimedOut ? (
              <span className="badge badge-info">Auto-polling saga…</span>
            ) : null}
          </div>
          <code className="muted">{orderId}</code>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              resetPollWindow();
              void orderQuery.refetch();
            }}
            disabled={orderQuery.isFetching}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
          {canCancel ? (
            <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)}>
              <Ban size={15} aria-hidden="true" />
              {order.status === 'CONFIRMED' ? 'Request cancellation' : 'Cancel order'}
            </button>
          ) : null}
        </div>
      </div>

      {orderQuery.error ? (
        <ProblemBanner error={orderQuery.error} onRetry={() => void orderQuery.refetch()} />
      ) : null}

      {inFlight && pollTimedOut ? (
        <div className="banner banner-info" role="status">
          <strong>Still processing</strong>
          <div className="banner-body">
            The order is still in <code>{order?.status}</code> while asynchronous saga events finish.
            Automatic polling paused after 30 seconds — click <strong>Refresh</strong> to check again.
          </div>
        </div>
      ) : null}

      {lastCancelHttpStatus === 202 && order?.status === 'CANCELLATION_REQUESTED' ? (
        <div className="banner banner-warning">
          <strong>202 Accepted — Waiting on shipping-service</strong>
          <div className="banner-body">
            Because this order was already <code>CONFIRMED</code>, only <code>shipping-service</code>{' '}
            knows whether the parcel has left the warehouse. This page polls automatically until the
            order becomes <code>CANCELLED</code> or <code>SHIPPED</code>.
          </div>
        </div>
      ) : null}

      {order ? (
        <>
          <div className="card stack-md">
            <h2 className="card-title">Order Saga Lifecycle</h2>
            <SagaTimeline status={order.status} cancellationReason={order.cancellationReason} />
          </div>

          <div className="kpi-grid">
            <div className="kpi-box">
              <div className="kpi-label">Server Total</div>
              <div className="kpi-value">{formatMoney(order.totalAmount, order.currency)}</div>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Customer ID</div>
              <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{order.customerId}</code>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Placed At</div>
              <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>{formatDateTime(order.createdAt)}</div>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Shipping Address</div>
              <div style={{ fontWeight: 500, marginTop: '0.2rem' }}>{order.shippingAddress}</div>
            </div>
          </div>

          <ResponsiveTable caption="Order line items" headers={['SKU', 'Quantity', 'Unit Price', 'Line Total']}>
            {order.lines.map((line) => (
              <tr key={line.sku}>
                <th scope="row">
                  <code>{line.sku}</code>
                </th>
                <td data-label="Quantity">{line.quantity}</td>
                <td data-label="Unit Price">{formatMoney(line.unitPrice, order.currency)}</td>
                <td data-label="Line Total">
                  <strong>{formatMoney(line.lineTotal, order.currency)}</strong>
                </td>
              </tr>
            ))}
          </ResponsiveTable>
        </>
      ) : null}

      <ModalDialog
        open={cancelOpen}
        title={order?.status === 'CONFIRMED' ? 'Request order cancellation' : 'Cancel placed order'}
        onClose={() => {
          cancelMutation.reset();
          setCancelOpen(false);
        }}
      >
        <div className="stack-md">
          <p className="muted" style={{ margin: 0 }}>
            {order?.status === 'CONFIRMED'
              ? 'This order is CONFIRMED. Submitting sends a cancellation request (202 Accepted) to shipping-service, which cancels the parcel if not yet dispatched or refuses if already shipped.'
              : 'This order is still PLACED. Cancelling marks it CANCELLED immediately (200 OK) and releases any reserved stock.'}
          </p>

          {cancelMutation.error ? <ProblemBanner error={cancelMutation.error} /> : null}

          <form ref={formRef} onSubmit={handleCancelSubmit} className="stack-md" noValidate>
            <div className="field">
              <label htmlFor={reasonId}>Cancellation reason</label>
              <span className="hint">Required, up to 500 characters.</span>
              <textarea
                id={reasonId}
                className="textarea"
                required
                maxLength={500}
                placeholder="e.g. Changed my mind / ordered wrong model"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-error={reasonErrId}
              />
              <div id={reasonErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Please enter a cancellation reason (max 500 characters).
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn"
                autoFocus
                onClick={() => setCancelOpen(false)}
              >
                Keep order
              </button>
              <button type="submit" className="btn btn-danger" disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? 'Submitting…' : 'Confirm cancellation'}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>
    </div>
  );
}
