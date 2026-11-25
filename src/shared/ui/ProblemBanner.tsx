import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiError } from '../api/types';

interface ProblemBannerProps {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ProblemBanner({ error, onRetry, retryLabel = 'Retry' }: ProblemBannerProps) {
  if (!error) return null;

  if (error instanceof ApiError) {
    const tone = error.status === 503 || error.status === 504 ? 'banner-warning' : 'banner-danger';
    return (
      <div className={`banner ${tone}`} role="alert">
        <div className="row-between">
          <div className="row">
            <AlertTriangle size={18} aria-hidden="true" />
            <strong>
              {error.problem.title ?? 'Request failed'}
              {error.status > 0 ? ` (${error.status})` : ''}
            </strong>
          </div>
          {onRetry ? (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              <RefreshCw size={14} aria-hidden="true" />
              {retryLabel}
            </button>
          ) : null}
        </div>
        <div className="banner-body">
          {error.problem.detail || error.message}
          {error.retryAfter ? (
            <div className="muted" style={{ marginTop: '0.35rem', fontSize: '0.84rem' }}>
              Retry-After: <code>{error.retryAfter}s</code>
            </div>
          ) : null}
          {error.problem.sku !== undefined ? (
            <div className="muted" style={{ marginTop: '0.35rem', fontSize: '0.84rem' }}>
              SKU <code>{String(error.problem.sku)}</code>: requested{' '}
              <strong>{String(error.problem.requested)}</strong>, available{' '}
              <strong>{String(error.problem.available)}</strong>
            </div>
          ) : null}
          {error.wwwAuthenticate ? (
            <div className="muted" style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}>
              <code>WWW-Authenticate: {error.wwwAuthenticate}</code>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="banner banner-danger" role="alert">
      <div className="row">
        <AlertTriangle size={18} aria-hidden="true" />
        <strong>Unexpected error</strong>
      </div>
      <div className="banner-body">{error instanceof Error ? error.message : String(error)}</div>
    </div>
  );
}
