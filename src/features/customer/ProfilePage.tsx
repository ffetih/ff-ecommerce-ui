import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, UserCheck, UserPlus } from 'lucide-react';
import { getMyProfile, registerMyProfile, updateMyShippingAddress } from './api';
import { RequireRole } from '../auth/RequireRole';
import { useAuth } from '../auth/authContext';
import { ApiError } from '../../shared/api/types';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
import { useAccessibleValidation } from '../../shared/ui/useAccessibleValidation';

function ProfileContent() {
  const { session } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['customer', 'me', session?.subject],
    queryFn: getMyProfile,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const isNotRegistered = profileQuery.error instanceof ApiError && profileQuery.error.status === 404;

  const [fullName, setFullName] = useState(
    () => (typeof session?.claims.name === 'string' ? session.claims.name : ''),
  );
  const [address, setAddress] = useState('');

  useEffect(() => {
    if (profileQuery.data) {
      setAddress(profileQuery.data.shippingAddress);
    }
  }, [profileQuery.data]);

  const registerFormRef = useRef<HTMLFormElement>(null);
  const updateFormRef = useRef<HTMLFormElement>(null);
  useAccessibleValidation(registerFormRef);
  useAccessibleValidation(updateFormRef);

  const nameId = useId();
  const nameErrId = useId();
  const regAddrId = useId();
  const regAddrErrId = useId();
  const updAddrId = useId();
  const updAddrErrId = useId();

  const registerMutation = useMutation({
    mutationFn: () => registerMyProfile({ fullName: fullName.trim(), shippingAddress: address.trim() }),
    onSuccess: (created) => {
      queryClient.setQueryData(['customer', 'me', session?.subject], created);
      notify('Customer profile created via POST /api/v1/customers/me', 'success');
    },
  });

  const updateAddressMutation = useMutation({
    mutationFn: () => updateMyShippingAddress(address.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(['customer', 'me', session?.subject], updated);
      notify('Shipping address updated', 'success');
    },
  });

  function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return;
    registerMutation.mutate();
  }

  function handleUpdateAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return;
    updateAddressMutation.mutate();
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>My Customer Profile</h1>
          <p className="page-subtitle">
            Your customer id (<code>sub</code>) and email are taken directly from your Keycloak
            access token — never from request parameters.
          </p>
        </div>
      </div>

      {profileQuery.isLoading ? (
        <div className="card muted">Loading profile from customer-service…</div>
      ) : isNotRegistered ? (
        <div className="card stack-md" style={{ maxWidth: 600 }}>
          <div className="row">
            <UserPlus size={20} aria-hidden="true" />
            <h2 className="card-title">Complete your customer registration</h2>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            <code>GET /api/v1/customers/me</code> returned <code>404</code>. Create your shop
            profile once so <code>order-service</code> can validate your account and default
            shipping address.
          </p>

          <div className="kpi-grid">
            <div className="kpi-box">
              <div className="kpi-label">Customer ID (token sub)</div>
              <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{session?.subject}</code>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Email (from token)</div>
              <code style={{ fontSize: '0.84rem' }}>{session?.email ?? 'missing'}</code>
            </div>
          </div>

          {registerMutation.error ? <ProblemBanner error={registerMutation.error} /> : null}

          <form ref={registerFormRef} onSubmit={handleRegister} className="stack-md" noValidate>
            <div className="field">
              <label htmlFor={nameId}>Full name</label>
              <span className="hint">Required, up to 200 characters.</span>
              <input
                id={nameId}
                type="text"
                className="input"
                required
                maxLength={200}
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                data-error={nameErrId}
              />
              <div id={nameErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Please enter your full name (max 200 characters).
              </div>
            </div>

            <div className="field">
              <label htmlFor={regAddrId}>Default shipping address</label>
              <span className="hint">Required, up to 500 characters.</span>
              <textarea
                id={regAddrId}
                className="textarea"
                required
                maxLength={500}
                autoComplete="street-address"
                placeholder="Bağdat Cd. 1, Kadıköy, İstanbul"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                data-error={regAddrErrId}
              />
              <div id={regAddrErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Please provide a shipping address (max 500 characters).
              </div>
            </div>

            <div>
              <button type="submit" className="btn btn-primary" disabled={registerMutation.isPending}>
                <UserPlus size={16} aria-hidden="true" />
                {registerMutation.isPending ? 'Creating profile…' : 'Create profile'}
              </button>
            </div>
          </form>
        </div>
      ) : profileQuery.error ? (
        <ProblemBanner error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />
      ) : profileQuery.data ? (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card stack-md">
            <div className="row-between">
              <div className="row">
                <UserCheck size={20} aria-hidden="true" />
                <h2 className="card-title">{profileQuery.data.fullName}</h2>
              </div>
              <StatusBadge status={profileQuery.data.active ? 'ACTIVE' : 'DEACTIVATED'} />
            </div>
            <dl className="stack-sm" style={{ margin: 0, fontSize: '0.92rem' }}>
              <div>
                <dt className="hint">Customer ID</dt>
                <dd style={{ margin: 0 }}>
                  <code>{profileQuery.data.id}</code>
                </dd>
              </div>
              <div>
                <dt className="hint">Normalized Email</dt>
                <dd style={{ margin: 0 }}>
                  <code>{profileQuery.data.email}</code>
                </dd>
              </div>
              <div>
                <dt className="hint">Current Shipping Address</dt>
                <dd style={{ margin: 0 }}>{profileQuery.data.shippingAddress}</dd>
              </div>
            </dl>
            {!profileQuery.data.active ? (
              <div className="banner banner-warning">
                <strong>Account deactivated</strong>
                <div className="banner-body">
                  Deactivated accounts keep their order history, but cannot change their shipping
                  address (<code>409</code>) or place new orders (<code>422</code>).
                </div>
              </div>
            ) : null}
          </div>

          <div className="card stack-md">
            <h2 className="card-title">Update Shipping Address</h2>
            {updateAddressMutation.error ? <ProblemBanner error={updateAddressMutation.error} /> : null}
            <form ref={updateFormRef} onSubmit={handleUpdateAddress} className="stack-md" noValidate>
              <div className="field">
                <label htmlFor={updAddrId}>Shipping address</label>
                <span className="hint">Used as the default for new orders (max 500 chars).</span>
                <textarea
                  id={updAddrId}
                  className="textarea"
                  required
                  maxLength={500}
                  autoComplete="street-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  data-error={updAddrErrId}
                />
                <div id={updAddrErrId} className="error-msg">
                  <span role="img" aria-label="Error">
                    !
                  </span>{' '}
                  Shipping address is required (max 500 characters).
                </div>
              </div>
              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={updateAddressMutation.isPending}
                >
                  <Save size={15} aria-hidden="true" />
                  {updateAddressMutation.isPending ? 'Saving…' : 'Save address'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProfilePage() {
  return (
    <RequireRole role="customer">
      <ProfileContent />
    </RequireRole>
  );
}
