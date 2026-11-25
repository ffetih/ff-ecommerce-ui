import { useEffect, useState } from 'react';
import { Activity, Trash2, X } from 'lucide-react';
import { clearHttpTraces, subscribeHttpTraces } from '../../shared/api/httpClient';
import type { HttpTraceEntry } from '../../shared/api/types';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTime } from '../../shared/utils/format';
import { useAuth } from './authContext';

interface ProtocolInspectorProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Live developer dock visualizing the distributed-system contract in real time:
 * - Active JWT claims (sub, roles, audiences, expiry)
 * - HTTP trace log with status, Idempotency-Key, Idempotent-Replayed, Retry-After, and RFC 9457 bodies
 */
export function ProtocolInspector({ open, onClose }: ProtocolInspectorProps) {
  const { session, authority } = useAuth();
  const [traces, setTraces] = useState<HttpTraceEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => subscribeHttpTraces(setTraces), []);

  if (!open) return null;

  const selected = traces.find((t) => t.id === selectedId) ?? traces[0] ?? null;

  return (
    <aside className="inspector-panel" aria-label="Protocol inspector">
      <div className="inspector-inner stack-md">
        <div className="row-between">
          <div className="row">
            <Activity size={17} aria-hidden="true" />
            <strong>Protocol Inspector</strong>
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              JWT claims, Idempotency headers, and RFC 9457 ProblemDetails
            </span>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={clearHttpTraces}>
              <Trash2 size={14} aria-hidden="true" />
              Clear log
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close inspector">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid-2">
          <div className="card stack-sm" style={{ padding: '0.9rem' }}>
            <strong style={{ fontSize: '0.88rem' }}>Active Token Claims (unverified display)</strong>
            {session ? (
              <div className="stack-sm" style={{ fontSize: '0.83rem' }}>
                <div>
                  <span className="muted">client / flow: </span>
                  <code>{session.clientId} (Authorization Code + PKCE S256)</code>
                </div>
                <div>
                  <span className="muted">authority: </span>
                  <code>{authority}</code>
                </div>
                <div>
                  <span className="muted">sub (= customerId): </span>
                  <code>{session.subject}</code>
                </div>
                <div>
                  <span className="muted">email: </span>
                  <code>{session.email ?? '—'}</code>
                </div>
                <div className="row">
                  <span className="muted">roles:</span>
                  {session.roles.map((r) => (
                    <StatusBadge key={r} status={r} />
                  ))}
                </div>
                <div className="row">
                  <span className="muted">aud:</span>
                  {session.audiences.map((aud) => (
                    <span key={aud} className="badge badge-neutral">
                      {aud}
                    </span>
                  ))}
                </div>
                <div>
                  <span className="muted">expires: </span>
                  <span>{formatDateTime(new Date(session.expiresAt).toISOString())}</span>
                </div>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                Anonymous (no Authorization header sent; public catalog reads still work).
              </p>
            )}
          </div>

          <div className="card stack-sm" style={{ padding: '0.9rem' }}>
            <div className="row-between">
              <strong style={{ fontSize: '0.88rem' }}>HTTP Calls ({traces.length})</strong>
              {selected ? <code className="muted">{selected.durationMs} ms</code> : null}
            </div>
            {traces.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                No requests captured yet.
              </p>
            ) : (
              <div className="inspector-trace-list">
                {traces.map((entry) => {
                  const statusTone =
                    entry.status >= 500 || entry.status === 0
                      ? 'badge-danger'
                      : entry.status >= 400
                        ? 'badge-warning'
                        : entry.status === 202
                          ? 'badge-info'
                          : 'badge-success';
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="inspector-trace-row"
                      style={{
                        cursor: 'pointer',
                        textAlign: 'left',
                        borderColor: selected?.id === entry.id ? 'var(--brand)' : undefined,
                      }}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <span className={`badge ${statusTone}`}>{entry.status || 'ERR'}</span>
                      <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {entry.method} {entry.path}
                      </span>
                      {entry.idempotentReplayed ? (
                        <span className="badge badge-info">Replayed</span>
                      ) : entry.idempotencyKey ? (
                        <span className="badge badge-neutral">Idem-Key</span>
                      ) : (
                        <span />
                      )}
                      <span className="muted">{entry.durationMs}ms</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selected?.problem ? (
              <pre
                style={{
                  margin: 0,
                  padding: '0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-subtle)',
                  overflow: 'auto',
                  maxHeight: 110,
                }}
              >
                {JSON.stringify(selected.problem, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
