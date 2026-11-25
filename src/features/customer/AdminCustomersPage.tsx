import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserX, Users } from 'lucide-react';
import { deactivateCustomer, getCustomerById } from './api';
import { DEMO_ACCOUNTS } from '../auth/authContext';
import { RequireRole } from '../auth/RequireRole';
import { ModalDialog } from '../../shared/ui/ModalDialog';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';

const DEMO_CUSTOMERS = DEMO_ACCOUNTS.filter((a) => a.role === 'customer');

function AdminCustomersContent() {
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const [inputId, setInputId] = useState(DEMO_CUSTOMERS[0]?.id ?? '');
  const [activeId, setActiveId] = useState(DEMO_CUSTOMERS[0]?.id ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const customerQuery = useQuery({
    queryKey: ['customer', 'admin', activeId],
    queryFn: () => getCustomerById(activeId),
    enabled: activeId.trim().length > 0,
    retry: false,
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateCustomer(activeId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['customer', 'admin', activeId], updated);
      setConfirmOpen(false);
      notify(`Customer ${updated.fullName} deactivated`, 'warning');
    },
  });

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveId(inputId.trim());
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Admin: Customer Directory</h1>
          <p className="page-subtitle">
            Inspect customer profiles by UUID (<code>GET /api/v1/customers/{'{id}'}</code>) and
            deactivate accounts (<code>ROLE_admin</code>).
          </p>
        </div>
      </div>

      <div className="card stack-md">
        <div className="row">
          <span className="hint">Quick select realm customer:</span>
          {DEMO_CUSTOMERS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              className={`btn btn-sm ${activeId === demo.id ? 'btn-primary' : ''}`}
              onClick={() => {
                setInputId(demo.id);
                setActiveId(demo.id);
              }}
            >
              <Users size={13} aria-hidden="true" />
              {demo.username} ({demo.email})
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="row">
          <label htmlFor="admin-customer-id" className="visually-hidden">
            Customer UUID
          </label>
          <input
            id="admin-customer-id"
            type="text"
            className="input mono"
            placeholder="Customer UUID (Keycloak sub)"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button type="submit" className="btn btn-primary">
            <Search size={15} aria-hidden="true" />
            Lookup
          </button>
        </form>
      </div>

      {customerQuery.error ? (
        <ProblemBanner error={customerQuery.error} onRetry={() => void customerQuery.refetch()} />
      ) : null}

      {customerQuery.data ? (
        <div className="card stack-md">
          <div className="row-between">
            <div className="row">
              <h2 className="card-title">{customerQuery.data.fullName}</h2>
              <StatusBadge status={customerQuery.data.active ? 'ACTIVE' : 'DEACTIVATED'} />
            </div>
            <div className="row">
              <Link
                to={`/admin/operations?customerId=${encodeURIComponent(customerQuery.data.id)}`}
                className="btn btn-sm"
              >
                View Orders
              </Link>
              {customerQuery.data.active ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    deactivateMutation.reset();
                    setConfirmOpen(true);
                  }}
                >
                  <UserX size={14} aria-hidden="true" />
                  Deactivate
                </button>
              ) : null}
            </div>
          </div>

          <div className="kpi-grid">
            <div className="kpi-box">
              <div className="kpi-label">Customer ID</div>
              <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{customerQuery.data.id}</code>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Email</div>
              <code>{customerQuery.data.email}</code>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Shipping Address</div>
              <div>{customerQuery.data.shippingAddress}</div>
            </div>
          </div>
        </div>
      ) : null}

      <ModalDialog
        open={confirmOpen}
        title="Deactivate customer account?"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="btn" autoFocus onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivateMutation.mutate()}
            >
              {deactivateMutation.isPending ? 'Deactivating…' : 'Confirm deactivation'}
            </button>
          </>
        }
      >
        <div className="stack-md">
          {deactivateMutation.error ? <ProblemBanner error={deactivateMutation.error} /> : null}
          <p className="muted" style={{ margin: 0 }}>
            Deactivating <strong>{customerQuery.data?.fullName}</strong> preserves their order
            history but blocks new orders (<code>422</code>) and shipping address updates (
            <code>409</code>).
          </p>
        </div>
      </ModalDialog>
    </div>
  );
}

export function AdminCustomersPage() {
  return (
    <RequireRole role="admin">
      <AdminCustomersContent />
    </RequireRole>
  );
}
