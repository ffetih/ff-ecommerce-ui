import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, KeyRound, Minus, Plus, RotateCw, ShoppingBag, Trash2 } from 'lucide-react';
import { useCart } from './cartContext';
import { placeOrder, type Order } from '../orders/api';
import { SIMULATED_CARD_TOKENS } from '../payments/model';
import { useAuth } from '../auth/authContext';
import { jaegerTraceUrl } from '../../shared/config/runtimeConfig';
import { CopyButton } from '../../shared/ui/CopyButton';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { useToast } from '../../shared/ui/ToastRegion';
import {
  useAccessibleValidation,
  validateAndFocusFirstInvalid,
} from '../../shared/ui/useAccessibleValidation';
import { formatMoney } from '../../shared/utils/format';
import { ApiError } from '../../shared/api/types';

export function CartPage() {
  const { items, idempotencyKey, cardToken, setQuantity, removeItem, setCardToken, clearCart, rotateIdempotencyKey } =
    useCart();
  const { isAuthenticated, hasRole, login } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [shippingAddress, setShippingAddress] = useState('');
  const [lastPlaced, setLastPlaced] = useState<{
    order: Order;
    replayed: boolean;
    keyUsed: string;
    traceId: string;
  } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  useAccessibleValidation(formRef);
  const idemCodeId = useId();
  const cardId = useId();
  const cardHintId = useId();
  const addressId = useId();
  const addressHintId = useId();
  const addressErrId = useId();

  const selectedCard = SIMULATED_CARD_TOKENS.find((c) => c.token === cardToken) ?? SIMULATED_CARD_TOKENS[0];

  const currencies = useMemo(() => new Set(items.map((item) => item.currency)), [items]);
  const hasMixedCurrencies = currencies.size > 1;
  const primaryCurrency = items[0]?.currency ?? 'EUR';
  const estimatedTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items],
  );

  const placeMutation = useMutation({
    mutationFn: (key: string) =>
      placeOrder(
        {
          lines: items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
          cardToken,
          shippingAddress: shippingAddress.trim() || undefined,
        },
        key,
      ),
    onSuccess: (result, keyUsed) => {
      setLastPlaced({
        order: result.data,
        replayed: result.headers.idempotentReplayed,
        keyUsed,
        traceId: result.headers.traceId,
      });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      notify(
        result.headers.idempotentReplayed
          ? `Idempotent replay: returned existing order ${result.data.id.slice(0, 8)}`
          : `Order ${result.data.id.slice(0, 8)} placed (status: PLACED)`,
        'success',
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateAndFocusFirstInvalid(event.currentTarget)) return;
    if (items.length === 0 || hasMixedCurrencies) return;
    placeMutation.mutate(idempotencyKey);
  }

  const placedTraceUrl = lastPlaced ? jaegerTraceUrl(lastPlaced.traceId) : null;

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Cart &amp; Idempotent Checkout</h1>
          <p className="page-subtitle">
            Each checkout attempt carries a UUID <code>Idempotency-Key</code>. Retrying after a{' '}
            <code>503</code> or timeout returns the same order (<code>200</code> +{' '}
            <code>Idempotent-Replayed: true</code>); modifying lines rotates the key automatically.
          </p>
        </div>
        <Link to="/" className="btn">
          Continue browsing
        </Link>
      </div>

      {lastPlaced ? (
        <div className="banner banner-success">
          <div className="row-between">
            <strong>
              {lastPlaced.replayed
                ? 'Idempotent replay (200 — Idempotent-Replayed: true)'
                : 'Order created (201 Created)'}
            </strong>
            <div className="row">
              {placedTraceUrl ? (
                <a
                  href={placedTraceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Open trace in Jaeger
                </a>
              ) : null}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => placeMutation.mutate(lastPlaced.keyUsed)}
                disabled={placeMutation.isPending || items.length === 0}
              >
                <RotateCw size={14} aria-hidden="true" />
                Replay same key
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const orderId = lastPlaced.order.id;
                  clearCart();
                  navigate(`/orders/${orderId}`);
                }}
              >
                Track order saga
              </button>
            </div>
          </div>
          <div className="banner-body">
            Order <code>{lastPlaced.order.id}</code> — status <strong>{lastPlaced.order.status}</strong>,
            server total{' '}
            <strong>{formatMoney(lastPlaced.order.totalAmount, lastPlaced.order.currency)}</strong>.
            You can click <em>Replay same key</em> to observe safe idempotency before clearing the cart.
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="empty-state stack-sm">
          <ShoppingBag size={28} style={{ margin: '0 auto' }} aria-hidden="true" />
          <strong>Your cart is empty</strong>
          <p style={{ margin: 0 }}>Add products from the catalog to place a multi-line order.</p>
          <div>
            <Link to="/" className="btn btn-primary btn-sm">
              Browse catalog
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="stack-md">
            <ResponsiveTable caption="Cart items" headers={['SKU', 'Product', 'Unit price', 'Qty', 'Subtotal', '']}>
              {items.map((item) => (
                <tr key={item.sku}>
                  <th scope="row">
                    <code>{item.sku}</code>
                  </th>
                  <td data-label="Product">{item.name}</td>
                  <td data-label="Unit price">{formatMoney(item.unitPrice, item.currency)}</td>
                  <td data-label="Qty">
                    <div className="row" style={{ gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Decrease quantity for ${item.sku}`}
                        onClick={() => setQuantity(item.sku, item.quantity - 1)}
                      >
                        <Minus size={13} aria-hidden="true" />
                      </button>
                      <span style={{ minWidth: '1.5rem', textAlign: 'center', fontWeight: 600 }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Increase quantity for ${item.sku}`}
                        onClick={() => setQuantity(item.sku, item.quantity + 1)}
                      >
                        <Plus size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  <td data-label="Subtotal">
                    <strong>{formatMoney(item.unitPrice * item.quantity, item.currency)}</strong>
                  </td>
                  <td data-label="Remove">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Remove ${item.sku}`}
                      onClick={() => removeItem(item.sku)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </ResponsiveTable>

            <div className="row-between">
              <button type="button" className="btn btn-sm" onClick={clearCart}>
                Clear cart
              </button>
              <div style={{ fontSize: '1.1rem' }}>
                Estimated total:{' '}
                <strong>
                  {hasMixedCurrencies ? 'Mixed currencies' : formatMoney(estimatedTotal, primaryCurrency)}
                </strong>
              </div>
            </div>
          </div>

          <div className="card stack-md">
            <h2 className="card-title">Place Order</h2>

            {hasMixedCurrencies ? (
              <div className="banner banner-warning" role="alert">
                <strong>Mixed currencies detected</strong>
                <div className="banner-body">
                  <code>order-service</code> requires all lines in one order to share a single
                  currency. Remove items from other currencies before submitting.
                </div>
              </div>
            ) : null}

            <div className="card stack-sm" style={{ padding: '0.75rem', background: 'var(--surface-subtle)' }}>
              <div className="row-between">
                <span className="row" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                  <KeyRound size={14} aria-hidden="true" />
                  Idempotency-Key
                </span>
                <div className="row" style={{ gap: '0.35rem' }}>
                  <CopyButton targetId={idemCodeId} label="Copy order idempotency key" />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      rotateIdempotencyKey();
                      setLastPlaced(null);
                    }}
                  >
                    New UUID
                  </button>
                </div>
              </div>
              <code id={idemCodeId} style={{ wordBreak: 'break-all' }}>
                {idempotencyKey}
              </code>
            </div>

            {placeMutation.error ? (
              <ProblemBanner
                error={placeMutation.error}
                onRetry={() => placeMutation.mutate(idempotencyKey)}
                retryLabel="Retry same Idempotency-Key"
              />
            ) : null}

            {placeMutation.error instanceof ApiError &&
            placeMutation.error.status === 422 &&
            placeMutation.error.message.toLowerCase().includes('customer') ? (
              <div className="banner banner-info">
                <strong>Customer profile required</strong>
                <div className="banner-body">
                  Your Keycloak login does not have a customer profile yet (or was deactivated).{' '}
                  <Link to="/profile">Open Profile</Link> to register <code>POST /customers/me</code>.
                </div>
              </div>
            ) : null}

            <form ref={formRef} onSubmit={handleSubmit} className="stack-md" noValidate>
              <div className="field">
                <label htmlFor={cardId}>
                  <span className="row" style={{ gap: '0.35rem' }}>
                    <CreditCard size={14} aria-hidden="true" />
                    Payment method (card token)
                  </span>
                </label>
                <span id={cardHintId} className="hint">
                  Simulated provider token (ADR-0009); changing the card rotates the{' '}
                  <code>Idempotency-Key</code> automatically. Raw card numbers never reach the backend.
                </span>
                <select
                  id={cardId}
                  className="select"
                  value={cardToken}
                  aria-describedby={cardHintId}
                  onChange={(e) => {
                    setCardToken(e.target.value);
                    setLastPlaced(null);
                  }}
                >
                  {SIMULATED_CARD_TOKENS.map((option) => (
                    <option key={option.token} value={option.token}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {selectedCard ? (
                  <span className="hint" style={{ fontSize: '0.8rem' }}>
                    Expected outcome: {selectedCard.outcome}
                  </span>
                ) : null}
              </div>

              <div className="field">
                <label htmlFor={addressId}>Shipping address override (optional)</label>
                <span id={addressHintId} className="hint">
                  Leave blank to use your saved customer profile address. Max 500 characters.
                </span>
                <textarea
                  id={addressId}
                  className="textarea"
                  maxLength={500}
                  placeholder="Optional custom delivery address for this order…"
                  value={shippingAddress}
                  onChange={(e) => {
                    setShippingAddress(e.target.value);
                    rotateIdempotencyKey();
                  }}
                  aria-describedby={addressHintId}
                  data-error={addressErrId}
                />
                <div id={addressErrId} className="error-msg">
                  <span role="img" aria-label="Error">
                    !
                  </span>{' '}
                  Shipping address must be at most 500 characters.
                </div>
              </div>

              {!isAuthenticated ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    void login({ returnTo: '/cart' });
                  }}
                >
                  Sign in with Keycloak to place order
                </button>
              ) : !hasRole('customer') ? (
                <div className="banner banner-warning">
                  <strong>Customer role required</strong>
                  <div className="banner-body">
                    Only accounts with <code>ROLE_customer</code> (e.g. <code>alice</code> or{' '}
                    <code>bob</code>) may call <code>POST /api/v1/orders</code>.
                  </div>
                </div>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={placeMutation.isPending || hasMixedCurrencies}
                >
                  {placeMutation.isPending ? 'Placing order…' : 'Place order'}
                </button>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
