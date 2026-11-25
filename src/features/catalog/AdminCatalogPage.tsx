import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, DollarSign, PackagePlus, PauseCircle, Plus, RefreshCw, RotateCw } from 'lucide-react';
import {
  changeProductPrice,
  createProduct,
  deactivateProduct,
  getStock,
  listProducts,
  receiveStock,
  type Product,
} from './api';
import { RequireRole } from '../auth/RequireRole';
import { ModalDialog } from '../../shared/ui/ModalDialog';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
import { useAccessibleValidation } from '../../shared/ui/useAccessibleValidation';
import { formatMoney, newUuid } from '../../shared/utils/format';

function AdminCatalogContent() {
  const queryClient = useQueryClient();
  const { notify } = useToast();

  // Create product form state
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('49.90');
  const [currency, setCurrency] = useState('EUR');

  // Selected SKU for stock panel
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [receiptQty, setReceiptQty] = useState('10');
  const [receiptRefId, setReceiptRefId] = useState(() => newUuid());

  // Modals
  const [priceTarget, setPriceTarget] = useState<Product | null>(null);
  const [nextPrice, setNextPrice] = useState('');
  const [nextCurrency, setNextCurrency] = useState('EUR');
  const [deactivateTarget, setDeactivateTarget] = useState<Product | null>(null);

  const createFormRef = useRef<HTMLFormElement>(null);
  const receiptFormRef = useRef<HTMLFormElement>(null);
  const priceFormRef = useRef<HTMLFormElement>(null);
  useAccessibleValidation(createFormRef);
  useAccessibleValidation(receiptFormRef);
  useAccessibleValidation(priceFormRef);

  const skuId = useId();
  const skuErrId = useId();
  const nameId = useId();
  const nameErrId = useId();
  const priceId = useId();
  const priceErrId = useId();
  const qtyId = useId();
  const qtyErrId = useId();
  const newPriceId = useId();
  const newPriceErrId = useId();

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });

  const stockQuery = useQuery({
    queryKey: ['stock', selectedSku],
    queryFn: () => getStock(selectedSku!),
    enabled: selectedSku !== null,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createProduct({
        sku: sku.trim(),
        name: name.trim(),
        unitPrice: Number(unitPrice),
        currency,
      }),
    onSuccess: (created) => {
      setSku('');
      setName('');
      setSelectedSku(created.sku);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock', created.sku] });
      notify(`Created product ${created.sku} with an empty stock row`, 'success');
    },
  });

  const receiptMutation = useMutation({
    mutationFn: (refId: string) =>
      receiveStock(selectedSku!, { referenceId: refId, quantity: Number(receiptQty) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['stock', updated.sku], updated);
      notify(`Stock updated for ${updated.sku}: onHand=${updated.onHand}, available=${updated.available}`, 'success');
    },
  });

  const priceMutation = useMutation({
    mutationFn: () =>
      changeProductPrice(priceTarget!.sku, { unitPrice: Number(nextPrice), currency: nextCurrency }),
    onSuccess: (updated) => {
      setPriceTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      notify(`Price updated for ${updated.sku}: ${formatMoney(updated.unitPrice, updated.currency)}`, 'success');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (targetSku: string) => deactivateProduct(targetSku),
    onSuccess: (updated) => {
      setDeactivateTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      notify(`Product ${updated.sku} taken off sale`, 'warning');
    },
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return;
    createMutation.mutate();
  }

  function handleReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity() || !selectedSku) return;
    receiptMutation.mutate(receiptRefId);
  }

  function handlePriceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity() || !priceTarget) return;
    priceMutation.mutate();
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Admin: Catalog &amp; Stock</h1>
          <p className="page-subtitle">
            Manage products, server-side prices, off-sale status, and idempotent goods receipts
            (<code>ROLE_admin</code>).
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void productsQuery.refetch();
            if (selectedSku) void stockQuery.refetch();
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack-md">
          <div className="row">
            <PackagePlus size={18} aria-hidden="true" />
            <h2 className="card-title">Create Product</h2>
          </div>

          {createMutation.error ? <ProblemBanner error={createMutation.error} /> : null}

          <form ref={createFormRef} onSubmit={handleCreate} className="stack-md" noValidate>
            <div className="field">
              <label htmlFor={skuId}>SKU</label>
              <span className="hint">2–64 letters, digits or hyphens (normalized to uppercase).</span>
              <input
                id={skuId}
                type="text"
                className="input mono"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,63}"
                placeholder="KB-MECH-01"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                data-error={skuErrId}
              />
              <div id={skuErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Use 2–64 letters, digits, or hyphens (must start with a letter or digit).
              </div>
            </div>

            <div className="field">
              <label htmlFor={nameId}>Product Name</label>
              <input
                id={nameId}
                type="text"
                className="input"
                required
                maxLength={255}
                placeholder="Mechanical Keyboard"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-error={nameErrId}
              />
              <div id={nameErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Please enter a product name.
              </div>
            </div>

            <div className="grid-2" style={{ gap: '0.75rem' }}>
              <div className="field">
                <label htmlFor={priceId}>Unit Price</label>
                <span className="hint">Up to 2 decimals, ≥ 0.</span>
                <input
                  id={priceId}
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  required
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  data-error={priceErrId}
                />
                <div id={priceErrId} className="error-msg">
                  <span role="img" aria-label="Error">
                    !
                  </span>{' '}
                  Enter a non-negative price with at most 2 decimals.
                </div>
              </div>

              <div className="field">
                <label htmlFor="create-currency">Currency</label>
                <span className="hint">ISO 4217 code.</span>
                <select
                  id="create-currency"
                  className="select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="TRY">TRY</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div>
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
                <Plus size={15} aria-hidden="true" />
                {createMutation.isPending ? 'Creating…' : 'Create product'}
              </button>
            </div>
          </form>
        </div>

        <div className="card stack-md">
          <div className="row-between">
            <div className="row">
              <Boxes size={18} aria-hidden="true" />
              <h2 className="card-title">
                Stock &amp; Goods Receipt {selectedSku ? `(${selectedSku})` : ''}
              </h2>
            </div>
            {selectedSku ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void stockQuery.refetch()}
                disabled={stockQuery.isFetching}
              >
                <RefreshCw size={13} aria-hidden="true" />
                Reload
              </button>
            ) : null}
          </div>

          {!selectedSku ? (
            <p className="muted" style={{ margin: 0 }}>
              Select a product from the table below to inspect its <code>onHand / reserved / available</code>{' '}
              counters and book a goods receipt.
            </p>
          ) : (
            <div className="stack-md">
              {stockQuery.error ? <ProblemBanner error={stockQuery.error} /> : null}
              {stockQuery.data ? (
                <div className="kpi-grid">
                  <div className="kpi-box">
                    <div className="kpi-label">On Hand</div>
                    <div className="kpi-value">{stockQuery.data.onHand}</div>
                  </div>
                  <div className="kpi-box">
                    <div className="kpi-label">Reserved</div>
                    <div className="kpi-value">{stockQuery.data.reserved}</div>
                  </div>
                  <div className="kpi-box">
                    <div className="kpi-label">Available</div>
                    <div className="kpi-value">{stockQuery.data.available}</div>
                  </div>
                </div>
              ) : (
                <div className="muted">Loading stock…</div>
              )}

              {receiptMutation.error ? <ProblemBanner error={receiptMutation.error} /> : null}

              <form ref={receiptFormRef} onSubmit={handleReceive} className="stack-md" noValidate>
                <div className="field">
                  <label htmlFor="receipt-ref">Idempotent Reference ID (UUID)</label>
                  <span className="hint">
                    Submitting the same referenceId + quantity twice adds stock only once; reusing it
                    with a different quantity returns 409.
                  </span>
                  <div className="row">
                    <input
                      id="receipt-ref"
                      type="text"
                      className="input mono"
                      value={receiptRefId}
                      onChange={(e) => setReceiptRefId(e.target.value)}
                      required
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setReceiptRefId(newUuid())}
                    >
                      <RotateCw size={13} aria-hidden="true" />
                      New UUID
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={qtyId}>Quantity to receive</label>
                  <input
                    id={qtyId}
                    type="number"
                    min="1"
                    step="1"
                    className="input"
                    required
                    value={receiptQty}
                    onChange={(e) => setReceiptQty(e.target.value)}
                    data-error={qtyErrId}
                  />
                  <div id={qtyErrId} className="error-msg">
                    <span role="img" aria-label="Error">
                      !
                    </span>{' '}
                    Quantity must be a positive integer.
                  </div>
                </div>

                <div className="row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={receiptMutation.isPending}
                  >
                    {receiptMutation.isPending ? 'Booking…' : 'Book goods receipt'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const fresh = newUuid();
                      setReceiptRefId(fresh);
                      receiptMutation.mutate(fresh);
                    }}
                    disabled={receiptMutation.isPending}
                  >
                    New UUID &amp; book
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {productsQuery.error ? <ProblemBanner error={productsQuery.error} /> : null}

      <ResponsiveTable
        caption="All catalog products"
        headers={['SKU', 'Name', 'Unit Price', 'Status', 'Actions']}
      >
        {(productsQuery.data ?? []).map((product) => (
          <tr key={product.sku}>
            <th scope="row">
              <code>{product.sku}</code>
            </th>
            <td data-label="Name">{product.name}</td>
            <td data-label="Unit Price">
              <strong>{formatMoney(product.unitPrice, product.currency)}</strong>
            </td>
            <td data-label="Status">
              <StatusBadge status={product.active ? 'ACTIVE' : 'OFF_SALE'} />
            </td>
            <td data-label="Actions">
              <div className="row">
                <button
                  type="button"
                  className={`btn btn-sm ${selectedSku === product.sku ? 'btn-primary' : ''}`}
                  onClick={() => {
                    setSelectedSku(product.sku);
                    setReceiptRefId(newUuid());
                    receiptMutation.reset();
                  }}
                >
                  <Boxes size={13} aria-hidden="true" />
                  Stock
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setPriceTarget(product);
                    setNextPrice(product.unitPrice.toFixed(2));
                    setNextCurrency(product.currency);
                    priceMutation.reset();
                  }}
                >
                  <DollarSign size={13} aria-hidden="true" />
                  Price
                </button>
                {product.active ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setDeactivateTarget(product);
                      deactivateMutation.reset();
                    }}
                  >
                    <PauseCircle size={13} aria-hidden="true" />
                    Take off sale
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </ResponsiveTable>

      <ModalDialog
        open={priceTarget !== null}
        title={`Change price for ${priceTarget?.sku ?? ''}`}
        onClose={() => setPriceTarget(null)}
      >
        <div className="stack-md">
          {priceMutation.error ? <ProblemBanner error={priceMutation.error} /> : null}
          <form ref={priceFormRef} onSubmit={handlePriceSubmit} className="stack-md" noValidate>
            <div className="field">
              <label htmlFor={newPriceId}>New Unit Price</label>
              <input
                id={newPriceId}
                type="number"
                step="0.01"
                min="0"
                className="input"
                required
                autoFocus
                value={nextPrice}
                onChange={(e) => setNextPrice(e.target.value)}
                data-error={newPriceErrId}
              />
              <div id={newPriceErrId} className="error-msg">
                <span role="img" aria-label="Error">
                  !
                </span>{' '}
                Enter a valid non-negative amount.
              </div>
            </div>
            <div className="field">
              <label htmlFor="modal-currency">Currency</label>
              <select
                id="modal-currency"
                className="select"
                value={nextCurrency}
                onChange={(e) => setNextCurrency(e.target.value)}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="TRY">TRY</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setPriceTarget(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={priceMutation.isPending}>
                {priceMutation.isPending ? 'Saving…' : 'Update price'}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>

      <ModalDialog
        open={deactivateTarget !== null}
        title={`Take ${deactivateTarget?.sku ?? ''} off sale?`}
        onClose={() => setDeactivateTarget(null)}
        footer={
          <>
            <button
              type="button"
              className="btn"
              autoFocus
              onClick={() => setDeactivateTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.sku)}
            >
              {deactivateMutation.isPending ? 'Updating…' : 'Take off sale'}
            </button>
          </>
        }
      >
        <div className="stack-md">
          {deactivateMutation.error ? <ProblemBanner error={deactivateMutation.error} /> : null}
          <p className="muted" style={{ margin: 0 }}>
            New orders containing <code>{deactivateTarget?.sku}</code> will be rejected with{' '}
            <code>422 Unprocessable Entity</code>. Orders already placed keep their reservations and
            finish normally (s06).
          </p>
        </div>
      </ModalDialog>
    </div>
  );
}

export function AdminCatalogPage() {
  return (
    <RequireRole role="admin">
      <AdminCatalogContent />
    </RequireRole>
  );
}
