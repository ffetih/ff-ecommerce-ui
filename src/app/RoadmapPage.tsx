import { CheckCircle2, Clock } from 'lucide-react';
import { ResponsiveTable } from '../shared/ui/ResponsiveTable';
import { StatusBadge } from '../shared/ui/StatusBadge';

const SPRINT_MODULES = [
  {
    sprint: 's01 – s06 (Live in UI)',
    domain: 'Catalog, Customer, Order Saga, Security, Gateway',
    uiModule: 'features/{auth, catalog, cart, customer, orders, shipping}',
    status: 'ACTIVE',
    notes:
      'Public catalog, Keycloak PKCE (shop via oidc-client-ts), /me onboarding, Idempotency-Key checkout, backoff saga polling, 202 async cancellation gate, admin stock/dispatch/deliver, Playwright E2E.',
  },
  {
    sprint: 's07 Documentation',
    domain: 'Role-based Antora docs, domain model, failure stories & drills',
    uiModule: 'ff-ecommerce-docs (developer/ui-integration & web-console)',
    status: 'ACTIVE',
    notes:
      'Documented same-origin proxy, shop PKCE contract, asynchronous polling rules, and two-tier Playwright setup.',
  },
  {
    sprint: 's08 Payments (Next in UI)',
    domain: 'Authorize / capture / void + double-entry ledger (ADR-0009)',
    uiModule: 'features/payments + CartPage cardToken + OrderDetailPage paymentStatus',
    status: 'PLACED',
    notes:
      'Add simulated cardToken selector (tok_ok, tok_decline, tok_slow, tok_capture_fails) to CartPage and surface paymentStatus (AUTHORIZING, AUTHORIZED, CAPTURED, VOIDED, OVERDUE) on orders.',
  },
  {
    sprint: 's09 Returns',
    domain: 'Concurrency-safe return limits + payment refunds',
    uiModule: 'features/returns (extension slot)',
    status: 'PLACED',
    notes:
      'Add "Request return" action on DELIVERED orders with per-line remaining quantity limits and admin approval view.',
  },
  {
    sprint: 's10 Observability',
    domain: 'Metrics, distributed tracing, dashboards',
    uiModule: 'ProtocolInspector + traceparent propagation',
    status: 'PLACED',
    notes:
      'Propagate W3C traceparent headers from httpClient and link traces to Grafana/Tempo.',
  },
  {
    sprint: 's11 Packaging',
    domain: 'Containers, Compose full stack, K8s',
    uiModule: 'Dockerfile (Nginx same-origin /api proxy)',
    status: 'PLACED',
    notes:
      'Serve the static console behind the same origin as the API gateway and point VITE_OIDC_AUTHORITY to the deployment realm.',
  },
];

export function RoadmapPage() {
  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Architecture &amp; Sprint Extension Map</h1>
          <p className="page-subtitle">
            This frontend mirrors the backend&apos;s bounded contexts so each upcoming sprint plugs in
            as a self-contained vertical slice under <code>src/features/</code>.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card stack-sm">
          <div className="row">
            <CheckCircle2 size={18} aria-hidden="true" />
            <h2 className="card-title">Same-Origin API Proxy</h2>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Vite proxies <code>/api</code> to the routing-only Gateway (<code>:8080</code>) so the
            browser never makes cross-origin API calls, preserving backend deny-by-default rules
            without CORS relaxation (ADR-0008).
          </p>
        </div>

        <div className="card stack-sm">
          <div className="row">
            <Clock size={18} aria-hidden="true" />
            <h2 className="card-title">PKCE + In-Memory Tokens</h2>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Sign-in uses <code>oidc-client-ts</code> Authorization Code + PKCE (<code>S256</code>)
            directly against Keycloak&apos;s public <code>shop</code> client (no password form).
            Tokens stay strictly in memory, renew before expiry, and are never sent expired.
          </p>
        </div>
      </div>

      <ResponsiveTable
        caption="UI feature coverage aligned with backend sprints"
        headers={['Sprint', 'Capability', 'Frontend Module', 'State', 'Integration Plan']}
      >
        {SPRINT_MODULES.map((row) => (
          <tr key={row.sprint}>
            <th scope="row">{row.sprint}</th>
            <td data-label="Capability">{row.domain}</td>
            <td data-label="Frontend Module">
              <code>{row.uiModule}</code>
            </td>
            <td data-label="State">
              <StatusBadge status={row.status === 'ACTIVE' ? 'ACTIVE' : 'CREATED'} />
            </td>
            <td data-label="Integration Plan">{row.notes}</td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}
