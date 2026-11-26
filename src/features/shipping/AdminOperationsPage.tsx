import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Boxes,
  CheckCircle2,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { deliverShipment, dispatchShipment, getShipmentByOrder } from './api';
import { getOrder, isOrderInFlight, listOrders } from '../orders/api';
import { SagaTimeline } from '../orders/SagaTimeline';
import { getReservation } from '../catalog/api';
import {
  getReturn,
  isReturnInFlight,
  receiveReturn,
  rejectReturn,
  type ReturnRecord,
} from '../returns/api';
import { OrderReturnsSection } from '../returns/OrderReturnsSection';
import { DEMO_ACCOUNTS } from '../auth/authContext';
import { RequireRole } from '../auth/RequireRole';
import { ApiError } from '../../shared/api/types';
import { getObservabilityLinks } from '../../shared/config/runtimeConfig';
import { ModalDialog } from '../../shared/ui/ModalDialog';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
import {
  useAccessibleValidation,
  validateAndFocusFirstInvalid,
} from '../../shared/ui/useAccessibleValidation';
import { formatDateTime, formatMoney, shortId } from '../../shared/utils/format';

const DEMO_CUSTOMERS = DEMO_ACCOUNTS.filter((a) => a.role === 'customer');

function AdminOperationsContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const initialCustomer = searchParams.get('customerId') || DEMO_CUSTOMERS[0]?.id || '';
  const [customerInput, setCustomerInput] = useState(initialCustomer);
  const [activeCustomerId, setActiveCustomerId] = useState(initialCustomer);
  const [selectedOrderId, setSelectedOrderId] = useState<string>(searchParams.get('orderId') || '');
  const [orderInput, setOrderInput] = useState<string>(searchParams.get('orderId') || '');
  const [returnInput, setReturnInput] = useState<string>(searchParams.get('returnId') || '');
  const [selectedReturnId, setSelectedReturnId] = useState<string>(searchParams.get('returnId') || '');
  const [rejectTarget, setRejectTarget] = useState<ReturnRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const rejectFormRef = useRef<HTMLFormElement>(null);
  useAccessibleValidation(rejectFormRef);
  const rejectReasonId = useId();
  const rejectReasonErrId = useId();

  const ordersQuery = useQuery({
    queryKey: ['orders', 'admin', activeCustomerId],
    queryFn: () => listOrders(activeCustomerId),
    enabled: activeCustomerId.trim().length > 0,
    refetchInterval: (query) =>
      query.state.data?.some((o) => isOrderInFlight(o.status, o.paymentStatus)) ? 2000 : false,
  });

  const listOrder = (ordersQuery.data ?? []).find((o) => o.id === selectedOrderId) ?? null;

  const directOrderQuery = useQuery({
    queryKey: ['orders', 'detail', selectedOrderId],
    queryFn: () => getOrder(selectedOrderId),
    enabled: selectedOrderId.trim().length > 0 && listOrder === null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data && isOrderInFlight(query.state.data.status, query.state.data.paymentStatus)
        ? 2000
        : false,
  });

  const selectedOrder = listOrder ?? directOrderQuery.data ?? null;

  const shipmentQuery = useQuery({
    queryKey: ['shipment', 'byOrder', selectedOrderId],
    queryFn: () => getShipmentByOrder(selectedOrderId),
    enabled: selectedOrderId.trim().length > 0,
    retry: false,
  });

  const reservationQuery = useQuery({
    queryKey: ['reservation', selectedOrderId],
    queryFn: () => getReservation(selectedOrderId),
    enabled: selectedOrderId.trim().length > 0,
    retry: false,
  });

  const directReturnQuery = useQuery({
    queryKey: ['returns', 'detail', selectedReturnId],
    queryFn: () => getReturn(selectedReturnId),
    enabled: selectedReturnId.trim().length > 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data && isReturnInFlight(query.state.data.status) ? 1500 : false,
  });

  const dispatchMutation = useMutation({
    mutationFn: (shipmentId: string) => dispatchShipment(shipmentId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['shipment', 'byOrder', updated.orderId], updated);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['reservation', updated.orderId] });
      notify(`Shipment dispatched — tracking ${updated.trackingNumber}`, 'success');
    },
  });

  const deliverMutation = useMutation({
    mutationFn: (shipmentId: string) => deliverShipment(shipmentId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['shipment', 'byOrder', updated.orderId], updated);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', updated.orderId] });
      notify(`Shipment ${shortId(updated.id)} marked DELIVERED`, 'success');
    },
  });

  const receiveReturnMutation = useMutation({
    mutationFn: (returnId: string) => receiveReturn(returnId),
    onSuccess: (result) => {
      queryClient.setQueryData(['returns', 'detail', result.data.id], result.data);
      void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', result.data.orderId] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      notify(`Return ${shortId(result.data.id)} marked RECEIVED — restock & refund started`, 'info');
    },
  });

  const rejectReturnMutation = useMutation({
    mutationFn: ({ returnId, reason }: { returnId: string; reason: string }) =>
      rejectReturn(returnId, reason),
    onSuccess: (result) => {
      queryClient.setQueryData(['returns', 'detail', result.data.id], result.data);
      void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', result.data.orderId] });
      setRejectTarget(null);
      setRejectReason('');
      notify(`Return ${shortId(result.data.id)} rejected`, 'warning');
    },
  });

  const observabilityLinks = getObservabilityLinks();

  function selectCustomer(id: string) {
    setCustomerInput(id);
    setActiveCustomerId(id);
    setSearchParams({ customerId: id });
  }

  function handleCustomerSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    selectCustomer(customerInput.trim());
  }

  function handleOrderLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectedOrderId(orderInput.trim());
  }

  function handleReturnLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    receiveReturnMutation.reset();
    rejectReturnMutation.reset();
    setSelectedReturnId(returnInput.trim());
  }

  function handleRejectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectTarget) return;
    if (!validateAndFocusFirstInvalid(event.currentTarget)) return;
    rejectReturnMutation.mutate({ returnId: rejectTarget.id, reason: rejectReason.trim() });
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Admin: Orders, Shipments, Returns &amp; Reservations</h1>
          <p className="page-subtitle">
            End-to-end saga operations across <code>order-service</code>,{' '}
            <code>shipping-service</code>, <code>payment-service</code>, and{' '}
            <code>catalog-service</code> (<code>ROLE_admin</code>).
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void ordersQuery.refetch();
            if (selectedOrderId) {
              void shipmentQuery.refetch();
              void reservationQuery.refetch();
              void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', selectedOrderId] });
            }
            if (selectedReturnId) {
              void directReturnQuery.refetch();
            }
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Refresh all
        </button>
      </div>

      {observabilityLinks.length > 0 ? (
        <div className="card row-between" style={{ padding: '0.8rem 1rem' }}>
          <div className="row" style={{ gap: '0.5rem' }}>
            <Activity size={16} aria-hidden="true" />
            <strong style={{ fontSize: '0.88rem' }}>Cluster Observability (s10 / s12)</strong>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              Traces, Grafana dashboard, Prometheus alerts &amp; Alertmanager mail
            </span>
          </div>
          <div className="row" style={{ gap: '0.4rem' }}>
            {observabilityLinks.map((tool) => (
              <a
                key={tool.id}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
                title={tool.description}
              >
                <ExternalLink size={12} aria-hidden="true" />
                {tool.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card stack-sm">
          <strong style={{ fontSize: '0.9rem' }}>1. Inspect Orders by Customer</strong>
          <div className="row">
            {DEMO_CUSTOMERS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                className={`btn btn-sm ${activeCustomerId === demo.id ? 'btn-primary' : ''}`}
                onClick={() => selectCustomer(demo.id)}
              >
                <Users size={13} aria-hidden="true" />
                {demo.username}
              </button>
            ))}
          </div>
          <form onSubmit={handleCustomerSearch} className="row">
            <label htmlFor="ops-customer-id" className="visually-hidden">
              Customer ID
            </label>
            <input
              id="ops-customer-id"
              type="text"
              className="input mono"
              placeholder="Customer UUID…"
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-sm btn-primary">
              <Search size={14} aria-hidden="true" />
              List orders
            </button>
          </form>
        </div>

        <div className="card stack-sm">
          <strong style={{ fontSize: '0.9rem' }}>2. Direct Order &amp; Return Lookup</strong>
          <form onSubmit={handleOrderLookup} className="row">
            <label htmlFor="ops-order-id" className="visually-hidden">
              Order ID
            </label>
            <input
              id="ops-order-id"
              type="text"
              className="input mono"
              placeholder="Order UUID (shipment, stock hold & returns)…"
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-sm btn-primary">
              <Search size={14} aria-hidden="true" />
              Inspect
            </button>
          </form>
          <form onSubmit={handleReturnLookup} className="row">
            <label htmlFor="ops-return-id" className="visually-hidden">
              Return ID
            </label>
            <input
              id="ops-return-id"
              type="text"
              className="input mono"
              placeholder="Return UUID (receive or reject directly)…"
              value={returnInput}
              onChange={(e) => setReturnInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-sm">
              <RotateCcw size={14} aria-hidden="true" />
              Lookup return
            </button>
          </form>
        </div>
      </div>

      {selectedReturnId ? (
        <div className="card stack-md">
          <div className="row-between">
            <div className="row">
              <RotateCcw size={18} aria-hidden="true" />
              <h2 className="card-title">Return Lookup ({shortId(selectedReturnId)})</h2>
              {directReturnQuery.data ? <StatusBadge status={directReturnQuery.data.status} /> : null}
            </div>
            {directReturnQuery.data ? (
              <Link to={`/orders/${directReturnQuery.data.orderId}`} className="btn btn-sm">
                Open parent order
              </Link>
            ) : null}
          </div>

          {directReturnQuery.isLoading ? (
            <div className="muted">Loading return…</div>
          ) : directReturnQuery.error ? (
            <ProblemBanner error={directReturnQuery.error} />
          ) : directReturnQuery.data ? (
            <div className="stack-md">
              {receiveReturnMutation.error ? (
                <ProblemBanner error={receiveReturnMutation.error} />
              ) : null}
              <div className="kpi-grid">
                <div className="kpi-box">
                  <div className="kpi-label">Refund Amount</div>
                  <div className="kpi-value">
                    {formatMoney(directReturnQuery.data.refundAmount, directReturnQuery.data.currency)}
                  </div>
                </div>
                <div className="kpi-box">
                  <div className="kpi-label">Lines</div>
                  <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>
                    {directReturnQuery.data.lines.map((l) => `${l.sku} ×${l.quantity}`).join(', ')}
                  </div>
                </div>
                <div className="kpi-box">
                  <div className="kpi-label">Reason</div>
                  <div style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>
                    {directReturnQuery.data.reason}
                  </div>
                </div>
              </div>
              {directReturnQuery.data.status === 'REQUESTED' ? (
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={receiveReturnMutation.isPending}
                    onClick={() => receiveReturnMutation.mutate(directReturnQuery.data!.id)}
                  >
                    <PackageCheck size={14} aria-hidden="true" />
                    Mark received
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={rejectReturnMutation.isPending}
                    onClick={() => {
                      rejectReturnMutation.reset();
                      setRejectReason('');
                      setRejectTarget(directReturnQuery.data!);
                    }}
                  >
                    <XCircle size={14} aria-hidden="true" />
                    Reject return
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {ordersQuery.error ? <ProblemBanner error={ordersQuery.error} /> : null}

      <ResponsiveTable
        caption={`Orders for customer ${shortId(activeCustomerId)}`}
        headers={['Order ID', 'Status', 'Payment', 'Items', 'Total', 'Placed', 'Actions']}
      >
        {(ordersQuery.data ?? []).map((order) => (
          <tr key={order.id}>
            <th scope="row">
              <code>{shortId(order.id)}</code>
            </th>
            <td data-label="Status">
              <StatusBadge status={order.status} />
            </td>
            <td data-label="Payment">
              {order.paymentStatus ? <StatusBadge status={order.paymentStatus} /> : <span className="muted">—</span>}
            </td>
            <td data-label="Items">{order.lines.map((l) => `${l.sku} ×${l.quantity}`).join(', ')}</td>
            <td data-label="Total">
              <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
            </td>
            <td data-label="Placed">{formatDateTime(order.createdAt)}</td>
            <td data-label="Actions">
              <div className="row">
                <button
                  type="button"
                  className={`btn btn-sm ${selectedOrderId === order.id ? 'btn-primary' : ''}`}
                  onClick={() => {
                    setSelectedOrderId(order.id);
                    setOrderInput(order.id);
                    dispatchMutation.reset();
                    deliverMutation.reset();
                  }}
                >
                  <Truck size={13} aria-hidden="true" />
                  Inspect saga
                </button>
                <Link to={`/orders/${order.id}`} className="btn btn-sm">
                  Order detail
                </Link>
              </div>
            </td>
          </tr>
        ))}
      </ResponsiveTable>

      {selectedOrderId ? (
        <div className="stack-md">
          {selectedOrder ? (
            <div className="card stack-md">
              <div className="row-between">
                <div className="row">
                  <h2 className="card-title">Order {shortId(selectedOrder.id)}</h2>
                  <StatusBadge status={selectedOrder.status} />
                  {selectedOrder.paymentStatus ? (
                    <StatusBadge status={selectedOrder.paymentStatus} />
                  ) : null}
                </div>
                <Link to={`/orders/${selectedOrder.id}`} className="btn btn-sm">
                  Open full order page
                </Link>
              </div>
              {selectedOrder.paymentStatus === 'OVERDUE' ? (
                <div className="banner banner-danger" role="alert">
                  <strong>Payment OVERDUE</strong>
                  <div className="banner-body">
                    Shipment left the warehouse, but capture failed. Follow the payment operations
                    runbook to collect the balance.
                  </div>
                </div>
              ) : null}
              <SagaTimeline
                status={selectedOrder.status}
                paymentStatus={selectedOrder.paymentStatus}
                cancellationReason={selectedOrder.cancellationReason}
              />
            </div>
          ) : null}

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card stack-md">
              <div className="row-between">
                <div className="row">
                  <Truck size={18} aria-hidden="true" />
                  <h2 className="card-title">Shipment (shipping-service)</h2>
                </div>
                {shipmentQuery.data ? <StatusBadge status={shipmentQuery.data.status} /> : null}
              </div>

              {dispatchMutation.error ? <ProblemBanner error={dispatchMutation.error} /> : null}
              {deliverMutation.error ? <ProblemBanner error={deliverMutation.error} /> : null}

              {shipmentQuery.isLoading ? (
                <div className="muted">Loading shipment…</div>
              ) : shipmentQuery.error instanceof ApiError && shipmentQuery.error.status === 404 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No shipment exists yet for order <code>{shortId(selectedOrderId)}</code> (created
                  asynchronously after <code>order.order-confirmed</code>).
                </p>
              ) : shipmentQuery.error ? (
                <ProblemBanner error={shipmentQuery.error} />
              ) : shipmentQuery.data ? (
                <div className="stack-md">
                  <div className="kpi-grid">
                    <div className="kpi-box">
                      <div className="kpi-label">Tracking Number</div>
                      <code>{shipmentQuery.data.trackingNumber ?? 'Not assigned yet'}</code>
                    </div>
                    <div className="kpi-box">
                      <div className="kpi-label">Updated</div>
                      <div style={{ fontSize: '0.86rem' }}>
                        {formatDateTime(shipmentQuery.data.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.88rem' }}>
                    <span className="muted">Destination: </span>
                    {shipmentQuery.data.shippingAddress}
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        shipmentQuery.data.status !== 'CREATED' || dispatchMutation.isPending
                      }
                      onClick={() => dispatchMutation.mutate(shipmentQuery.data!.id)}
                    >
                      <Truck size={15} aria-hidden="true" />
                      {dispatchMutation.isPending ? 'Dispatching…' : 'Dispatch parcel'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        shipmentQuery.data.status !== 'DISPATCHED' || deliverMutation.isPending
                      }
                      onClick={() => deliverMutation.mutate(shipmentQuery.data!.id)}
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {deliverMutation.isPending ? 'Confirming…' : 'Mark delivered'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="card stack-md">
              <div className="row-between">
                <div className="row">
                  <Boxes size={18} aria-hidden="true" />
                  <h2 className="card-title">Stock Reservation (catalog-service)</h2>
                </div>
                {reservationQuery.data ? <StatusBadge status={reservationQuery.data.status} /> : null}
              </div>

              {reservationQuery.isLoading ? (
                <div className="muted">Loading reservation…</div>
              ) : reservationQuery.error instanceof ApiError && reservationQuery.error.status === 404 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No reservation stored for order <code>{shortId(selectedOrderId)}</code> (e.g.
                  reservation failed due to insufficient stock).
                </p>
              ) : reservationQuery.error ? (
                <ProblemBanner error={reservationQuery.error} />
              ) : reservationQuery.data ? (
                <ul className="stack-sm" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {reservationQuery.data.lines.map((line) => (
                    <li key={line.sku}>
                      <code>{line.sku}</code> — <strong>{line.quantity}</strong> unit(s)
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {selectedOrder ? <OrderReturnsSection order={selectedOrder} /> : null}
        </div>
      ) : null}

      <ModalDialog
        open={rejectTarget !== null}
        title="Reject return request"
        onClose={() => {
          rejectReturnMutation.reset();
          setRejectTarget(null);
        }}
      >
        <div className="stack-md">
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Rejecting return <code>{rejectTarget ? shortId(rejectTarget.id) : ''}</code> frees its
            units so they can be returned again within the 14-day window.
          </p>
          {rejectReturnMutation.error ? <ProblemBanner error={rejectReturnMutation.error} /> : null}
          <form ref={rejectFormRef} onSubmit={handleRejectSubmit} className="stack-md" noValidate>
            <div className="field">
              <label htmlFor={rejectReasonId}>Rejection reason</label>
              <span className="hint">Required, up to 500 characters.</span>
              <textarea
                id={rejectReasonId}
                name="rejectionReason"
                className="textarea"
                required
                maxLength={500}
                placeholder="e.g. Parcel never arrived"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                data-error={rejectReasonErrId}
              />
              <div id={rejectReasonErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Please enter a rejection reason (max 500 characters).
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" autoFocus onClick={() => setRejectTarget(null)}>
                Keep open
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={rejectReturnMutation.isPending}
              >
                {rejectReturnMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>
    </div>
  );
}

export function AdminOperationsPage() {
  return (
    <RequireRole role="admin">
      <AdminOperationsContent />
    </RequireRole>
  );
}
