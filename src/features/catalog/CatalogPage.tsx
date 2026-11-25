import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus, RefreshCw, Search, ShoppingCart } from 'lucide-react';
import { listProducts } from './api';
import { useCart } from '../cart/cartContext';
import { useAuth } from '../auth/authContext';
import { ProblemBanner } from '../../shared/ui/ProblemBanner';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useToast } from '../../shared/ui/ToastRegion';
import { formatMoney } from '../../shared/utils/format';

export function CatalogPage() {
  const { addItem, items } = useCart();
  const { hasRole } = useAuth();
  const { notify } = useToast();

  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(true);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (productsQuery.data ?? []).filter((product) => {
      if (!showRetired && !product.active) return false;
      if (!q) return true;
      return product.sku.toLowerCase().includes(q) || product.name.toLowerCase().includes(q);
    });
  }, [productsQuery.data, search, showRetired]);

  const cartQtyBySku = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => map.set(item.sku, item.quantity));
    return map;
  }, [items]);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Product Catalog</h1>
          <p className="page-subtitle">
            Public browsing via <code>GET /api/v1/products</code>. Prices are authoritative on the
            server — never accepted from the client at checkout.
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => void productsQuery.refetch()}
            disabled={productsQuery.isFetching}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
          <Link to="/cart" className="btn btn-primary">
            <ShoppingCart size={15} aria-hidden="true" />
            Cart ({items.reduce((s, i) => s + i.quantity, 0)})
          </Link>
        </div>
      </div>

      <div className="card row-between">
        <div className="row" style={{ flex: 1, minWidth: 240 }}>
          <Search size={16} className="muted" aria-hidden="true" />
          <label htmlFor="catalog-search" className="visually-hidden">
            Filter by product name or SKU
          </label>
          <input
            id="catalog-search"
            type="search"
            className="input"
            placeholder="Filter by name or SKU (e.g. KB-01)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 340 }}
          />
        </div>
        <label className="row" style={{ fontSize: '0.88rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          Show off-sale products
        </label>
      </div>

      {productsQuery.error ? (
        <ProblemBanner error={productsQuery.error} onRetry={() => void productsQuery.refetch()} />
      ) : null}

      {productsQuery.isLoading ? (
        <div className="card muted">Loading catalog from catalog-service…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state stack-sm">
          <Package size={28} style={{ margin: '0 auto' }} aria-hidden="true" />
          <strong>No products found</strong>
          <p style={{ margin: 0 }}>
            {productsQuery.data && productsQuery.data.length > 0
              ? 'Try clearing your search filter.'
              : 'The catalog is currently empty. Sign in as admin to create products and book initial stock.'}
          </p>
          {hasRole('admin') ? (
            <div>
              <Link to="/admin/catalog" className="btn btn-primary btn-sm">
                Go to Admin Catalog
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid-cards">
          {filtered.map((product) => {
            const inCart = cartQtyBySku.get(product.sku) ?? 0;
            return (
              <article key={product.sku} className="card stack-md">
                <div className="row-between">
                  <code className="badge badge-neutral">{product.sku}</code>
                  <StatusBadge status={product.active ? 'ACTIVE' : 'OFF_SALE'} />
                </div>
                <div className="stack-sm" style={{ flex: 1 }}>
                  <h2 className="card-title">{product.name}</h2>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>
                    {formatMoney(product.unitPrice, product.currency)}
                  </div>
                </div>
                <div className="row-between">
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {inCart > 0 ? `${inCart} in cart` : product.active ? 'Available to order' : 'Off sale'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!product.active}
                    onClick={() => {
                      addItem(product, 1);
                      notify(`Added ${product.name} (${product.sku}) to cart`, 'success');
                    }}
                  >
                    <Plus size={14} aria-hidden="true" />
                    Add to cart
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
