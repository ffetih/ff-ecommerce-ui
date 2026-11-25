import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Activity,
  Boxes,
  ClipboardList,
  LogIn,
  LogOut,
  Map,
  Moon,
  Package,
  ShoppingCart,
  Sun,
  SunMoon,
  Truck,
  User,
  Users,
} from 'lucide-react';
import { useAuth } from '../features/auth/authContext';
import { ProtocolInspector } from '../features/auth/ProtocolInspector';
import { useCart } from '../features/cart/cartContext';
import { StatusBadge } from '../shared/ui/StatusBadge';

type ThemePreference = 'system' | 'light' | 'dark';

export function Layout({ children }: { children: ReactNode }) {
  const { session, isAuthenticated, authBusy, authError, clearAuthError, hasRole, login, logout } = useAuth();
  const { totalCount } = useCart();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>('system');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Package size={18} />
            </span>
            <span>FF E-Commerce</span>
          </Link>

          <nav className="nav-links" aria-label="Main navigation">
            <NavLink to="/" end className="nav-link">
              <Package size={15} aria-hidden="true" />
              Catalog
            </NavLink>
            <NavLink to="/cart" className="nav-link">
              <ShoppingCart size={15} aria-hidden="true" />
              Cart
              {totalCount > 0 ? <span className="badge badge-brand">{totalCount}</span> : null}
            </NavLink>
            {hasRole('customer') ? (
              <>
                <NavLink to="/orders" className="nav-link">
                  <ClipboardList size={15} aria-hidden="true" />
                  My Orders
                </NavLink>
                <NavLink to="/profile" className="nav-link">
                  <User size={15} aria-hidden="true" />
                  Profile
                </NavLink>
              </>
            ) : null}

            {hasRole('admin') ? (
              <>
                <span className="nav-divider" aria-hidden="true" />
                <NavLink to="/admin/catalog" className="nav-link">
                  <Boxes size={15} aria-hidden="true" />
                  Admin Catalog
                </NavLink>
                <NavLink to="/admin/operations" className="nav-link">
                  <Truck size={15} aria-hidden="true" />
                  Operations
                </NavLink>
                <NavLink to="/admin/customers" className="nav-link">
                  <Users size={15} aria-hidden="true" />
                  Customers
                </NavLink>
              </>
            ) : null}

            <span className="nav-divider" aria-hidden="true" />
            <NavLink to="/roadmap" className="nav-link">
              <Map size={15} aria-hidden="true" />
              Roadmap
            </NavLink>
          </nav>

          <div className="topbar-actions">
            <button
              type="button"
              className={`btn btn-sm ${inspectorOpen ? 'btn-primary' : ''}`}
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((prev) => !prev)}
              title="Toggle JWT & HTTP Protocol Inspector"
            >
              <Activity size={14} aria-hidden="true" />
              Inspector
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={cycleTheme}
              aria-label={`Color theme: ${theme}. Click to switch.`}
              title={`Theme: ${theme}`}
            >
              {theme === 'light' ? (
                <Sun size={14} aria-hidden="true" />
              ) : theme === 'dark' ? (
                <Moon size={14} aria-hidden="true" />
              ) : (
                <SunMoon size={14} aria-hidden="true" />
              )}
            </button>

            {isAuthenticated && session ? (
              <div className="row" style={{ gap: '0.45rem' }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>{session.username}</span>
                {session.roles
                  .filter((r) => r === 'customer' || r === 'admin')
                  .map((role) => (
                    <StatusBadge key={role} status={role} />
                  ))}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={authBusy}
                  onClick={() => {
                    void login({ promptLogin: true });
                  }}
                >
                  Switch
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    void logout();
                  }}
                  aria-label="Sign out"
                >
                  <LogOut size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={authBusy}
                onClick={() => {
                  void login();
                }}
              >
                <LogIn size={14} aria-hidden="true" />
                {authBusy ? 'Redirecting…' : 'Sign in'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        {authError ? (
          <div className="banner banner-danger" role="alert" style={{ marginBottom: '1rem' }}>
            <div className="row-between">
              <strong>Keycloak sign-in unavailable</strong>
              <button type="button" className="btn btn-sm btn-ghost" onClick={clearAuthError}>
                Dismiss
              </button>
            </div>
            <div className="banner-body">{authError}</div>
          </div>
        ) : null}
        {children}
      </main>

      <ProtocolInspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
    </div>
  );
}
