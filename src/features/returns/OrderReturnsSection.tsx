import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  canOrderBeReturned,
  isReturnInFlight,
  listOrderReturns,
  receiveReturn,
  rejectReturn,
  remainingReturnableUnits,
  requestReturn,
  type ReturnRecord,
} from './api';
import type { Order } from '../orders/api';
import { useAuth } from '../auth/authContext';
import { jaegerTraceUrl } from '../../shared/config/runtimeConfig';
import { CopyButton } from '../../shared/ui/CopyButton';
import { ModalDialog } from '../../shared/ui/ModalDialog';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
import {
  useAccessibleValidation,
  validateAndFocusFirstInvalid,
} from '../../shared/ui/useAccessibleValidation';
import { formatDateTime, formatMoney, newUuid, shortId } from '../../shared/utils/format';

const POLL_BACKOFF_MS = [500, 1000, 1500, 2000, 3000] as const;
const MAX_POLL_WINDOW_MS = 30_000;

interface OrderReturnsSectionProps {
  order: Order;
}

export function OrderReturnsSection({ order }: OrderReturnsSectionProps) {
  const { isAuthenticated, hasRole } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = hasRole('admin');

  const [requestOpen, setRequestOpen] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => newUuid());
  const [lineError, setLineError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<{
    returnRecord: ReturnRecord;
    replayed: boolean;
    traceId: string;
    action: 'requested' | 'received' | 'rejected';
  } | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ReturnRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const pollStartRef = useRef<number | null>(null);
  const pollAttemptRef = useRef(0);
  const trackedStateRef = useRef<string | null>(null);

  const requestFormRef = useRef<HTMLFormElement>(null);
  const rejectFormRef = useRef<HTMLFormElement>(null);
  useAccessibleValidation(requestFormRef);
  useAccessibleValidation(rejectFormRef);

  const requestReasonId = useId();
  const requestReasonErrId = useId();
  const rejectReasonId = useId();
  const rejectReasonErrId = useId();
  const idemCodeId = useId();

  function resetPollWindow() {
    pollStartRef.current = Date.now();
    pollAttemptRef.current = 0;
    setPollTimedOut(false);
  }

  useEffect(() => {
    pollStartRef.current = null;
    pollAttemptRef.current = 0;
    trackedStateRef.current = null;
    setPollTimedOut(false);
    setLastOutcome(null);
  }, [order.id]);

  const returnsQuery = useQuery({
    queryKey: ['returns', 'byOrder', order.id],
    queryFn: () => listOrderReturns(order.id),
    enabled: isAuthenticated && order.status === 'DELIVERED',
    refetchInterval: (query) => {
      const list = query.state.data?.returns;
      const inFlight = list?.some((r) => isReturnInFlight(r.status)) ?? false;
      if (!inFlight) {
        pollStartRef.current = null;
        pollAttemptRef.current = 0;
        return false;
      }
      const stateKey = list!.map((r) => `${r.id}:${r.status}`).join('|');
      if (trackedStateRef.current !== stateKey) {
        trackedStateRef.current = stateKey;
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

  const hasInFlightReturn = (returnsQuery.data?.returns ?? []).some((r) => isReturnInFlight(r.status));
  useEffect(() => {
    if (!hasInFlightReturn) {
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
  }, [hasInFlightReturn, returnsQuery.dataUpdatedAt]);

  const quotas = useMemo(
    () => remainingReturnableUnits(order, returnsQuery.data?.returnedUnits),
    [order, returnsQuery.data?.returnedUnits],
  );
  const totalRemaining = quotas.reduce((sum, q) => sum + q.remaining, 0);
  const eligibleForReturn = canOrderBeReturned(order);

  const selectedLines = useMemo(
    () =>
      quotas
        .map((q) => ({ sku: q.sku, quantity: returnQuantities[q.sku] ?? 0, unitPrice: q.unitPrice }))
        .filter((line) => line.quantity > 0),
    [quotas, returnQuantities],
  );
  const estimatedRefund = selectedLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  function openRequestDialog() {
    const defaults: Record<string, number> = {};
    const returnable = quotas.filter((q) => q.remaining > 0);
    for (const q of quotas) {
      defaults[q.sku] = returnable.length === 1 && q.remaining > 0 ? 1 : 0;
    }
    setReturnQuantities(defaults);
    setReturnReason('');
    setLineError(null);
    // Create a fresh Idempotency-Key when the return form opens (ui-integration.adoc).
    setIdempotencyKey(newUuid());
    requestMutation.reset();
    setRequestOpen(true);
  }

  function updateLineQuantity(sku: string, nextQty: number, maxQty: number) {
    const clamped = Math.max(0, Math.min(maxQty, Number.isFinite(nextQty) ? Math.trunc(nextQty) : 0));
    setReturnQuantities((prev) => ({ ...prev, [sku]: clamped }));
    setLineError(null);
    setIdempotencyKey(newUuid());
  }

  const requestMutation = useMutation({
    mutationFn: (key: string) =>
      requestReturn(
        order.id,
        {
          lines: selectedLines.map(({ sku, quantity }) => ({ sku, quantity })),
          reason: returnReason.trim(),
        },
        key,
      ),
    onSuccess: (result) => {
      setLastOutcome({
        returnRecord: result.data,
        replayed: result.headers.idempotentReplayed,
        traceId: result.headers.traceId,
        action: 'requested',
      });
      setRequestOpen(false);
      setReturnReason('');
      void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', order.id] });
      notify(
        result.headers.idempotentReplayed
          ? `Idempotent replay: return ${shortId(result.data.id)} already requested`
          : `Return ${shortId(result.data.id)} requested (${formatMoney(result.data.refundAmount, result.data.currency)})`,
        'success',
      );
    },
  });

  const receiveMutation = useMutation({
    mutationFn: (returnId: string) => receiveReturn(returnId),
    onSuccess: (result) => {
      resetPollWindow();
      setLastOutcome({
        returnRecord: result.data,
        replayed: false,
        traceId: result.headers.traceId,
        action: 'received',
      });
      void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', order.id] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      notify(`Return ${shortId(result.data.id)} marked RECEIVED — restock and refund started`, 'info');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ returnId, reason }: { returnId: string; reason: string }) =>
      rejectReturn(returnId, reason),
    onSuccess: (result) => {
      setLastOutcome({
        returnRecord: result.data,
        replayed: false,
        traceId: result.headers.traceId,
        action: 'rejected',
      });
      setRejectTarget(null);
      setRejectReason('');
      void queryClient.invalidateQueries({ queryKey: ['returns', 'byOrder', order.id] });
      notify(`Return ${shortId(result.data.id)} rejected — units are returnable again`, 'warning');
    },
  });

  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedLines.length === 0) {
      setLineError('Select at least 1 unit to return.');
      return;
    }
    if (!validateAndFocusFirstInvalid(event.currentTarget)) return;
    requestMutation.mutate(idempotencyKey);
  }

  function handleRejectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectTarget) return;
    if (!validateAndFocusFirstInvalid(event.currentTarget)) return;
    rejectMutation.mutate({ returnId: rejectTarget.id, reason: rejectReason.trim() });
  }

  if (order.status !== 'DELIVERED') {
    return null;
  }

  const returns = returnsQuery.data?.returns ?? [];
  const hasRefundFailure = returns.some((r) => r.status === 'REFUND_FAILED');
  const outcomeJaegerUrl = lastOutcome ? jaegerTraceUrl(lastOutcome.traceId) : null;

  return (
    <section className="card stack-md" aria-label="Order returns">
      <div className="row-between">
        <div className="row">
          <RotateCcw size={18} aria-hidden="true" />
          <h2 className="card-title">Returns &amp; Refunds (s09)</h2>
          {hasInFlightReturn && !pollTimedOut ? (
            <span className="badge badge-info">Auto-polling refund…</span>
          ) : null}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              resetPollWindow();
              void returnsQuery.refetch();
            }}
            disabled={returnsQuery.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh returns
          </button>
          {eligibleForReturn ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openRequestDialog}
              disabled={returnsQuery.isLoading || totalRemaining === 0}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Request return
            </button>
          ) : null}
        </div>
      </div>

      {!eligibleForReturn ? (
        <div className="banner banner-warning" role="status">
          <strong>Returns unavailable for this payment state</strong>
          <div className="banner-body">
            Only <code>DELIVERED</code> orders with <code>paymentStatus: CAPTURED</code> can be
            returned (current payment status: <code>{order.paymentStatus ?? 'UNKNOWN'}</code>).
          </div>
        </div>
      ) : null}

      {hasRefundFailure ? (
        <div className="banner banner-danger" role="alert">
          <strong>Refund failed — operations follow-up required</strong>
          <div className="banner-body">
            Returned units were restocked in <code>catalog-service</code>, but the payment provider
            refused the refund (ADR-0010). Follow up manually in payment operations.
          </div>
        </div>
      ) : null}

      {hasInFlightReturn && pollTimedOut ? (
        <div className="banner banner-info" role="status">
          <strong>Still processing refund</strong>
          <div className="banner-body">
            A received return is still waiting for <code>payment-service</code> to confirm the
            refund. Click <strong>Refresh returns</strong> to check again.
          </div>
        </div>
      ) : null}

      {lastOutcome ? (
        <div
          className={`banner ${lastOutcome.action === 'rejected' ? 'banner-warning' : 'banner-success'}`}
          role="status"
        >
          <div className="row-between">
            <strong>
              {lastOutcome.action === 'requested'
                ? lastOutcome.replayed
                  ? 'Idempotent replay (200 — Idempotent-Replayed: true)'
                  : 'Return requested (201 Created)'
                : lastOutcome.action === 'received'
                  ? 'Parcel marked received — restock & refund triggered'
                  : 'Return rejected — units released back to quota'}
            </strong>
            {outcomeJaegerUrl ? (
              <a
                href={outcomeJaegerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
              >
                <ExternalLink size={13} aria-hidden="true" />
                Open trace in Jaeger
              </a>
            ) : null}
          </div>
          <div className="banner-body">
            Return <code>{lastOutcome.returnRecord.id}</code> — status{' '}
            <strong>{lastOutcome.returnRecord.status}</strong>, refund{' '}
            <strong>
              {formatMoney(
                lastOutcome.returnRecord.refundAmount,
                lastOutcome.returnRecord.currency,
              )}
            </strong>
            .
          </div>
        </div>
      ) : null}

      {returnsQuery.error ? (
        <ProblemBanner error={returnsQuery.error} onRetry={() => void returnsQuery.refetch()} />
      ) : null}
      {receiveMutation.error ? <ProblemBanner error={receiveMutation.error} /> : null}

      <div className="kpi-grid">
        {quotas.map((q) => (
          <div key={q.sku} className="kpi-box">
            <div className="kpi-label">
              <code>{q.sku}</code> quota
            </div>
            <div style={{ fontWeight: 600, marginTop: '0.2rem', fontSize: '0.92rem' }}>
              {q.returned} / {q.ordered} returned
            </div>
            <div className="hint" style={{ fontSize: '0.78rem' }}>
              {q.remaining > 0 ? `${q.remaining} unit(s) returnable` : 'All ordered units returned'}
            </div>
          </div>
        ))}
      </div>

      {returnsQuery.isLoading ? (
        <div className="muted">Loading returns…</div>
      ) : returns.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          No returns requested for this order yet. Delivered orders can be returned within 14 days
          of delivery; refunds issue when the warehouse receives the parcel back (ADR-0010).
        </p>
      ) : (
        <ResponsiveTable
          caption="Order returns"
          headers={
            isAdmin
              ? ['Return ID', 'Status', 'Lines', 'Refund', 'Reason', 'Requested', 'Actions']
              : ['Return ID', 'Status', 'Lines', 'Refund', 'Reason', 'Requested']
          }
        >
          {returns.map((ret) => {
            const retCodeId = `ret-id-${ret.id}`;
            return (
              <tr key={ret.id}>
                <th scope="row">
                  <div className="row" style={{ gap: '0.25rem', flexWrap: 'nowrap' }}>
                    <code id={retCodeId} title={ret.id}>
                      {shortId(ret.id)}
                    </code>
                    <CopyButton targetId={retCodeId} label={`Copy return ID ${shortId(ret.id)}`} />
                  </div>
                </th>
                <td data-label="Status">
                  <StatusBadge status={ret.status} />
                </td>
                <td data-label="Lines">
                  {ret.lines.map((l) => `${l.sku} ×${l.quantity}`).join(', ')}
                </td>
                <td data-label="Refund">
                  <strong>{formatMoney(ret.refundAmount, ret.currency)}</strong>
                </td>
                <td data-label="Reason">
                  <div>{ret.reason}</div>
                  {ret.rejectionReason ? (
                    <div className="hint" style={{ color: 'var(--danger)' }}>
                      Rejected: {ret.rejectionReason}
                    </div>
                  ) : null}
                </td>
                <td data-label="Requested">{formatDateTime(ret.createdAt)}</td>
                {isAdmin ? (
                  <td data-label="Actions">
                    {ret.status === 'REQUESTED' ? (
                      <div className="row" style={{ gap: '0.4rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={receiveMutation.isPending}
                          onClick={() => receiveMutation.mutate(ret.id)}
                        >
                          <PackageCheck size={14} aria-hidden="true" />
                          Mark received
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={rejectMutation.isPending}
                          onClick={() => {
                            rejectMutation.reset();
                            setRejectReason('');
                            setRejectTarget(ret);
                          }}
                        >
                          <XCircle size={14} aria-hidden="true" />
                          Reject
                        </button>
                      </div>
                    ) : ret.status === 'REFUNDED' ? (
                      <span className="row muted" style={{ fontSize: '0.82rem', gap: '0.25rem' }}>
                        <CheckCircle2 size={14} aria-hidden="true" />
                        Restocked &amp; refunded
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: '0.82rem' }}>
                        —
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </ResponsiveTable>
      )}

      {/* Request return dialog */}
      <ModalDialog
        open={requestOpen}
        title="Request return"
        onClose={() => {
          requestMutation.reset();
          setRequestOpen(false);
        }}
      >
        <div className="stack-md">
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Choose how many remaining units to send back. The refund amount is calculated from the
            order&apos;s frozen unit prices and issued once the warehouse receives the parcel.
          </p>

          <div
            className="card stack-sm"
            style={{ padding: '0.65rem 0.8rem', background: 'var(--surface-subtle)' }}
          >
            <div className="row-between">
              <span className="row" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                <KeyRound size={13} aria-hidden="true" />
                Idempotency-Key
              </span>
              <div className="row" style={{ gap: '0.35rem' }}>
                <CopyButton targetId={idemCodeId} label="Copy return idempotency key" />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setIdempotencyKey(newUuid())}
                >
                  New UUID
                </button>
              </div>
            </div>
            <code id={idemCodeId} style={{ wordBreak: 'break-all', fontSize: '0.78rem' }}>
              {idempotencyKey}
            </code>
          </div>

          {requestMutation.error ? (
            <ProblemBanner
              error={requestMutation.error}
              onRetry={() => requestMutation.mutate(idempotencyKey)}
              retryLabel="Retry same Idempotency-Key"
            />
          ) : null}

          {lineError ? (
            <div className="banner banner-danger" role="alert">
              <div className="banner-body">{lineError}</div>
            </div>
          ) : null}

          <form
            ref={requestFormRef}
            onSubmit={handleRequestSubmit}
            className="stack-md"
            noValidate
          >
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack-sm">
              <legend style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                Units to return
              </legend>
              {quotas.map((q) => {
                const inputId = `return-qty-${order.id}-${q.sku}`;
                const qty = returnQuantities[q.sku] ?? 0;
                return (
                  <div key={q.sku} className="return-line-row">
                    <div>
                      <label htmlFor={inputId} style={{ fontWeight: 600 }}>
                        <code>{q.sku}</code>
                      </label>
                      <div className="hint" style={{ fontSize: '0.78rem' }}>
                        Ordered {q.ordered} · Returned {q.returned} · Remaining{' '}
                        <strong>{q.remaining}</strong> · {formatMoney(q.unitPrice, order.currency)}{' '}
                        each
                      </div>
                    </div>
                    <input
                      id={inputId}
                      name={`qty-${q.sku}`}
                      type="number"
                      inputMode="numeric"
                      className="input return-qty-input"
                      min={0}
                      max={q.remaining}
                      step={1}
                      disabled={q.remaining === 0}
                      value={qty}
                      onChange={(e) => updateLineQuantity(q.sku, Number(e.target.value), q.remaining)}
                    />
                  </div>
                );
              })}
            </fieldset>

            <div className="row-between" style={{ fontSize: '0.92rem' }}>
              <span className="muted">Estimated refund (at order prices):</span>
              <strong>{formatMoney(estimatedRefund, order.currency)}</strong>
            </div>

            <div className="field">
              <label htmlFor={requestReasonId}>Return reason</label>
              <span className="hint">Required, up to 500 characters.</span>
              <textarea
                id={requestReasonId}
                name="reason"
                className="textarea"
                required
                maxLength={500}
                placeholder="e.g. Wrong switch feel / arrived damaged"
                value={returnReason}
                onChange={(e) => {
                  setReturnReason(e.target.value);
                  setIdempotencyKey(newUuid());
                }}
                data-error={requestReasonErrId}
              />
              <div id={requestReasonErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Please enter a return reason (max 500 characters).
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setRequestOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={requestMutation.isPending}
              >
                {requestMutation.isPending ? 'Submitting…' : 'Submit return request'}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>

      {/* Admin reject return dialog */}
      <ModalDialog
        open={rejectTarget !== null}
        title="Reject return request"
        onClose={() => {
          rejectMutation.reset();
          setRejectTarget(null);
        }}
      >
        <div className="stack-md">
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Rejecting return <code>{rejectTarget ? shortId(rejectTarget.id) : ''}</code> marks it{' '}
            <code>REJECTED</code> and releases its units back so the customer can submit a new
            request within the return window.
          </p>

          {rejectMutation.error ? <ProblemBanner error={rejectMutation.error} /> : null}

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
                placeholder="e.g. Parcel never arrived at warehouse"
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
              <button type="submit" className="btn btn-danger" disabled={rejectMutation.isPending}>
                {rejectMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>
    </section>
  );
}
