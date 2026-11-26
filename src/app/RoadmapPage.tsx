import { Activity, CheckCircle2, Cloud, ExternalLink } from 'lucide-react';
import { getObservabilityLinks, getRuntimeConfig } from '../shared/config/runtimeConfig';
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
    sprint: 's08 Payments (Live in UI)',
    domain: 'Authorize / capture / void + double-entry ledger (ADR-0009)',
    uiModule: 'features/payments + CartPage cardToken + OrderDetailPage paymentStatus',
    status: 'ACTIVE',
    notes:
      'Simulated cardToken selector (tok_ok, tok_decline, tok_slow, tok_capture_fails, tok_refund_fails) rotating Idempotency-Key on change; live paymentStatus badges, "Waiting for payment" slow-provider notice, and OVERDUE alert.',
  },
  {
    sprint: 's09 Returns (Live in UI)',
    domain: 'Concurrency-safe return limits + payment refunds (ADR-0010)',
    uiModule: 'features/returns + OrderDetailPage + AdminOperationsPage',
    status: 'ACTIVE',
    notes:
      'Request partial/full returns on DELIVERED + CAPTURED orders with per-SKU returnedUnits quota clamping and fresh Idempotency-Key; admin Mark received / Reject actions, direct Return ID lookup, RECEIVED -> REFUNDED polling, and REFUND_FAILED alert.',
  },
  {
    sprint: 's10 Observability (Live in UI)',
    domain: 'OpenTelemetry traces, Prometheus, Grafana & alerts (ADR-0011)',
    uiModule: 'shared/utils/trace + httpClient + ProtocolInspector',
    status: 'ACTIVE',
    notes:
      'Every API call emits a sampled W3C traceparent header so browser requests, gateway, outbox, Kafka, and downstream services share one Jaeger trace; Protocol Inspector and confirmation banners link straight into Jaeger, Grafana, Prometheus, Alertmanager, and Mailpit.',
  },
  {
    sprint: 's11 Packaging (Live in UI)',
    domain: 'Immutable container images & one-command Compose (ADR-0012)',
    uiModule: 'Dockerfile + docker/nginx.conf.template + docker/30-runtime-env.sh',
    status: 'ACTIVE',
    notes:
      'Unprivileged multi-stage Nginx image proxying /api/* same-origin (stripping Origin/Referer), SPA /callback fallback, /healthz probe, and runtime window.__APP_CONFIG__ injection so one image runs in Compose or Kubernetes.',
  },
  {
    sprint: 's12 Kubernetes & GitOps (Live in UI)',
    domain: 'k3d cluster synced by Flux, Traefik *.localtest.me:8888, Kafka ACLs (ADR-0013)',
    uiModule: 'shared/config/runtimeConfig + vite.config.ts (IPv4-first proxy)',
    status: 'ACTIVE',
    notes:
      'Defaults target the k3d/Flux Traefik entry points (shop.localtest.me:8888 & keycloak.localtest.me:8888) with IPv4-first DNS resolution for WSL2; switch back to Docker Compose anytime with `npm run dev:compose`.',
  },
  {
    sprint: 's13+ Optional',
    domain: 'Marketplace sellers, promotions, back-in-stock notifications',
    uiModule: 'features/{marketplace, promotions} (future slot)',
    status: 'PLACED',
    notes:
      'Reserved extension slots when multi-seller split orders or promotions are introduced on the backend.',
  },
];

export function RoadmapPage() {
  const config = getRuntimeConfig();
  const observabilityLinks = getObservabilityLinks(config);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Architecture &amp; Sprint Coverage Map (s00 – s12)</h1>
          <p className="page-subtitle">
            This frontend mirrors the backend&apos;s bounded contexts as vertical slices under{' '}
            <code>src/features/</code> and connects directly to either the local{' '}
            <strong>k3d + Flux</strong> cluster (<code>*.localtest.me:8888</code>) or{' '}
            <strong>Docker Compose</strong>.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card stack-sm">
          <div className="row">
            <CheckCircle2 size={18} aria-hidden="true" />
            <h2 className="card-title">Same-Origin Proxy &amp; PKCE</h2>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Vite (and production Nginx) proxy <code>/api/*</code> same-origin while stripping{' '}
            <code>Origin</code>/<code>Referer</code> so backend deny-by-default rules stay intact
            (ADR-0008). Sign-in uses <code>oidc-client-ts</code> PKCE (<code>S256</code>) against{' '}
            <code>{config.oidcAuthority}</code> (client <code>{config.oidcClientId}</code>).
          </p>
        </div>

        <div className="card stack-sm">
          <div className="row">
            <Cloud size={18} aria-hidden="true" />
            <h2 className="card-title">k3d + Flux &amp; Observability</h2>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Every request carries a W3C <code>traceparent</code> header into the gateway so traces
            flow end-to-end through the outbox and Kafka into Jaeger (ADR-0011, ADR-0013).
          </p>
          {observabilityLinks.length > 0 ? (
            <div className="row" style={{ marginTop: '0.25rem', gap: '0.4rem' }}>
              <Activity size={14} aria-hidden="true" />
              {observabilityLinks.map((tool) => (
                <a
                  key={tool.id}
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                  title={tool.description}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  {tool.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <ResponsiveTable
        caption="UI feature coverage aligned with backend sprints"
        headers={['Sprint', 'Capability', 'Frontend Module', 'State', 'Integration Details']}
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
            <td data-label="Integration Details">{row.notes}</td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}
