import type { ReactNode } from 'react';
import { Lock, LogIn } from 'lucide-react';
import { useAuth } from './authContext';

interface RequireRoleProps {
  role: 'customer' | 'admin';
  children: ReactNode;
}

export function RequireRole({ role, children }: RequireRoleProps) {
  const { isAuthenticated, hasRole, login, session } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="card stack-md" style={{ maxWidth: 520, margin: '2rem auto' }}>
        <div className="row">
          <Lock size={20} aria-hidden="true" />
          <h2 className="card-title">Sign in required</h2>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          This view calls endpoints requiring the <code>ROLE_{role}</code> realm role. Sign in with
          Keycloak (Authorization Code + PKCE) to continue.
        </p>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void login();
            }}
          >
            <LogIn size={16} aria-hidden="true" />
            Sign in with Keycloak
          </button>
        </div>
      </div>
    );
  }

  if (!hasRole(role)) {
    return (
      <div className="banner banner-warning" role="alert">
        <strong>Insufficient role (403 boundary)</strong>
        <div className="banner-body">
          Signed in as <strong>{session?.username}</strong> with roles{' '}
          <code>{session?.roles.join(', ') || 'none'}</code>. This screen requires{' '}
          <code>{role}</code>. Switch accounts from the top bar to test this persona.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
