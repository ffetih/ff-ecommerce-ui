import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, RefreshCw } from 'lucide-react';
import { useAuth } from './authContext';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { completeLoginCallback, login, clientId } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    completeLoginCallback(window.location.href)
      .then((returnTo) => {
        if (active) {
          navigate(returnTo, { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not complete Keycloak sign-in.');
        }
      });
    return () => {
      active = false;
    };
  }, [completeLoginCallback, navigate]);

  if (error) {
    return (
      <div className="card stack-md" style={{ maxWidth: 560, margin: '2rem auto' }}>
        <div className="banner banner-danger" role="alert">
          <strong>Keycloak sign-in failed</strong>
          <div className="banner-body">{error}</div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          Ensure Keycloak is running and has imported the <code>{clientId}</code> client from{' '}
          <code>ecommerce-realm.json</code>:{' '}
          <code>docker compose up -d --force-recreate keycloak</code>
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void login({ returnTo: '/', promptLogin: true });
            }}
          >
            <LogIn size={15} aria-hidden="true" />
            Sign in with Keycloak
          </button>
          <Link to="/" className="btn">
            Back to catalog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack-md" style={{ maxWidth: 460, margin: '2rem auto' }}>
      <div className="row">
        <RefreshCw size={18} aria-hidden="true" />
        <strong>Completing Keycloak PKCE sign-in…</strong>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
        Exchanging the authorization code with client <code>{clientId}</code> and storing the
        access token in memory.
      </p>
    </div>
  );
}
