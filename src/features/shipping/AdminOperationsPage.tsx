import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, CheckCircle2, RefreshCw, Search, Truck, Users } from 'lucide-react';
import { deliverShipment, dispatchShipment, getShipmentByOrder } from './api';
import { isOrderInFlight, listOrders } from '../orders/api';
import { SagaTimeline } from '../orders/SagaTimeline';
import { getReservation } from '../catalog/api';
import { DEMO_ACCOUNTS } from '../auth/authContext';
import { RequireRole } from '../auth/RequireRole';
import { ApiError } from '../../shared/api/types';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
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

  const ordersQuery = useQuery({
    queryKey: ['orders', 'admin', activeCustomerId],
    queryFn: () => listOrders(activeCustomerId),
    enabled: activeCustomerId.trim().length > 0,
    refetchInterval: (query) =>
      query.state.data?.some((o) => isOrderInFlight(o.status)) ? 2000 : false,
  });

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
      notify(`Shipment ${shortId(updated.id)} marked DELIVERED`, 'success');
    },
  });

  const selectedOrder = (ordersQuery.data ?? []).find((o) => o.id === selectedOrderId) ?? null;

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

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Admin: Orders, Shipments &amp; Reservations</h1>
          <p className="page-subtitle">
            End-to-end saga operations across <code>order-service</code>,{' '}
            <code>shipping-service</code>, and <code>catalog-service</code> (<code>ROLE_admin</code>).
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
            }
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Refresh all
        </button>
      </div>

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
          <strong style={{ fontSize: '0.9rem' }}>2. Direct Shipment &amp; Reservation Lookup</strong>
          <span className="hint">Paste any Order UUID to inspect its shipment &amp; stock hold directly.</span>
          <form onSubmit={handleOrderLookup} className="row">
            <label htmlFor="ops-order-id" className="visually-hidden">
              Order ID
            </label>
            <input
              id="ops-order-id"
              type="text"
              className="input mono"
              placeholder="Order UUID…"
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-sm btn-primary">
              <Search size={14} aria-hidden="true" />
              Inspect
            </button>
          </form>
        </div>
      </div>

      {ordersQuery.error ? <ProblemBanner error={ordersQuery.error} /> : null}

      <ResponsiveTable
        caption={`Orders for customer ${shortId(activeCustomerId)}`}
        headers={['Order ID', 'Status', 'Items', 'Total', 'Placed', 'Actions']}
      >
        {(ordersQuery.data ?? []).map((order) => (
          <tr key={order.id}>
            <th scope="row">
              <code>{shortId(order.id)}</code>
            </th>
            <td data-label="Status">
              <StatusBadge status={order.status} />
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
                </div>
                <Link to={`/orders/${selectedOrder.id}`} className="btn btn-sm">
                  Open full order page
                </Link>
              </div>
              <SagaTimeline
                status={selectedOrder.status}
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
        </div>
      ) : null}
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
