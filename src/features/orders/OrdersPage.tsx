import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { isOrderInFlight, listOrders } from './api';
import { customerPaymentLabel } from '../payments/model';
import { RequireRole } from '../auth/RequireRole';
import { useAuth } from '../auth/authContext';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTime, formatMoney, shortId } from '../../shared/utils/format';

function OrdersContent() {
  const { session } = useAuth();

  const ordersQuery = useQuery({
    queryKey: ['orders', 'mine', session?.subject],
    queryFn: () => listOrders(),
    // Poll while any order or payment is in a transitional saga state
    refetchInterval: (query) => {
      const list = query.state.data;
      return list?.some((order) => isOrderInFlight(order.status, order.paymentStatus)) ? 2000 : false;
    },
  });

  const inFlightCount = (ordersQuery.data ?? []).filter((o) =>
    isOrderInFlight(o.status, o.paymentStatus),
  ).length;

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>My Orders</h1>
          <p className="page-subtitle">
            Showing orders owned by <code>{session?.username}</code> (newest first). Orders in{' '}
            <code>PLACED</code> or <code>CANCELLATION_REQUESTED</code> auto-refresh until the saga
            settles.
          </p>
        </div>
        <div className="row">
          {inFlightCount > 0 ? (
            <span className="badge badge-info">Live polling ({inFlightCount} in flight)</span>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => void ordersQuery.refetch()}
            disabled={ordersQuery.isFetching}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {ordersQuery.error ? (
        <ProblemBanner error={ordersQuery.error} onRetry={() => void ordersQuery.refetch()} />
      ) : null}

      {ordersQuery.isLoading ? (
        <div className="card muted">Loading your orders…</div>
      ) : !ordersQuery.data || ordersQuery.data.length === 0 ? (
        <div className="empty-state stack-sm">
          <ClipboardList size={28} style={{ margin: '0 auto' }} aria-hidden="true" />
          <strong>No orders yet</strong>
          <p style={{ margin: 0 }}>Place an order from the storefront to watch the saga run.</p>
          <div>
            <Link to="/" className="btn btn-primary btn-sm">
              Browse catalog
            </Link>
          </div>
        </div>
      ) : (
        <ResponsiveTable
          caption="Customer orders"
          headers={['Order ID', 'Status', 'Payment', 'Items', 'Total', 'Placed at', 'Actions']}
        >
          {ordersQuery.data.map((order) => (
            <tr key={order.id}>
              <th scope="row">
                <Link to={`/orders/${order.id}`}>
                  <code>{shortId(order.id)}</code>
                </Link>
              </th>
              <td data-label="Status">
                <StatusBadge status={order.status} />
              </td>
              <td data-label="Payment">
                <div className="row" style={{ gap: '0.4rem' }}>
                  {order.paymentStatus ? <StatusBadge status={order.paymentStatus} /> : null}
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {customerPaymentLabel(order.paymentStatus)}
                  </span>
                </div>
              </td>
              <td data-label="Items">
                {order.lines.map((l) => `${l.sku} ×${l.quantity}`).join(', ')}
              </td>
              <td data-label="Total">
                <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
              </td>
              <td data-label="Placed at">{formatDateTime(order.createdAt)}</td>
              <td data-label="Actions">
                <Link to={`/orders/${order.id}`} className="btn btn-sm">
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
    </div>
  );
}

export function OrdersPage() {
  return (
    <RequireRole role="customer">
      <OrdersContent />
    </RequireRole>
  );
}
