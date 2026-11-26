# FF E-Commerce UI (`ff-ecommerce-ui`)

A React + TypeScript storefront and back-office application for [ff-ecommerce](https://github.com/ffetih/ff-ecommerce) (documented at [ff-ecommerce-docs](https://ffetih.github.io/ff-ecommerce-docs/ff-ecommerce/developer/web-console.html)), covering **s00–s12** against both the local **k3d + Flux** cluster (`*.localtest.me:8888`) and **Docker Compose** (`localhost:*`).

## What is covered (s00–s12)

- **Public Storefront (`/`):** Browse products (`GET /api/v1/products`) without sending any token when logged out, filter by name/SKU, see off-sale badges (`active: false`), add to cart.
- **Authorization Code + PKCE (`shop` client via `oidc-client-ts`):** No password form in the console; clicking **Sign in** redirects to Keycloak (`http://keycloak.localtest.me:8888/realms/ecommerce` by default, or `http://localhost:8180/realms/ecommerce` in Compose mode) with S256 PKCE, completes at `/callback`, keeps tokens strictly in memory (`InMemoryWebStorage`), refreshes expiring tokens proactively before API calls, and never sends an expired token.
- **Idempotent Checkout & Payments (`/cart`, s08–s09):** Multi-line order placement (`POST /api/v1/orders`) with a simulated payment `cardToken` selector (`tok_ok`, `tok_decline`, `tok_slow`, `tok_capture_fails`, `tok_refund_fails`), visible per-attempt `Idempotency-Key` UUID with copy button, automatic key rotation whenever cart lines or `cardToken` change, mixed-currency guard, safe retry with the same key on `503 Retry-After`, explicit `200 Idempotent-Replayed: true` feedback, and direct **Open trace in Jaeger** links.
- **Customer Onboarding & Profile (`/profile`):** Calls `GET /api/v1/customers/me`; on `404`, guides first-time users through `POST /api/v1/customers/me` (customer id `sub` and `email` come from the Keycloak token). Supports updating the shipping address (`PUT /me/shipping-address`) and displays deactivated account restrictions (`409`).
- **Live Order Saga, Payments & Returns (`/orders`, `/orders/:id`, s04–s09):**
  - Visualizes `PLACED → CONFIRMED → SHIPPED → DELIVERED` and `CANCELLATION_REQUESTED → CANCELLED` alongside `paymentStatus` (`AUTHORIZING`, `AUTHORIZED`, `CAPTURED`, `VOIDED`, `DECLINED`, `OVERDUE`), polling transitional states with backoff (`500 ms` → `3 s`), pausing cleanly with "Still processing" on timeout, and surfacing the `200` vs `202 Accepted` cancellation gate.
  - **Returns (`s09`, ADR-0010):** On `DELIVERED` + `CAPTURED` orders, loads `GET /api/v1/orders/{id}/returns`, shows per-SKU `returnedUnits` quotas, clamps the return quantity picker to remaining units, generates a fresh `Idempotency-Key` when the return form opens, displays `422` business-rule details verbatim, polls `RECEIVED → REFUNDED | REFUND_FAILED`, and surfaces `REFUND_FAILED` alerts.
- **Back-Office Console (`/admin/*`, `ROLE_admin`):**
  - **Catalog & Stock (`/admin/catalog`):** Create products, update prices, take products off sale (`POST .../deactivate`), inspect `onHand / reserved / available`, book idempotent goods receipts (`referenceId` UUID).
  - **Operations (`/admin/operations`):** Inspect customer orders, shipments (`GET /api/v1/shipments?orderId=...`), catalog reservations (`GET /api/v1/reservations/{orderId}`), and returns side-by-side; trigger **Dispatch**, **Deliver**, **Mark received**, and **Reject** (with reason dialog), look up any Return UUID directly (`GET /api/v1/returns/{id}`), and jump to cluster observability tools.
  - **Customers (`/admin/customers`):** Lookup customer profiles by UUID (with `alice`/`bob` quick buttons) and deactivate accounts.
- **Distributed Tracing & Protocol Inspector (top bar → `Inspector`, s10):**
  - Every API request attaches a sampled W3C `traceparent` header (`00-<traceId>-<spanId>-01`) so browser calls, gateway, outbox rows, Kafka messages, and downstream services share one Jaeger trace.
  - Shows decoded JWT claims (`sub`, `roles`, `aud`, `exp`), live HTTP log with `traceId`, **Open in Jaeger** deep links, copy buttons, `Idempotency-Key`, `Idempotent-Replayed`, `Retry-After`, RFC 9457 `ProblemDetail` payloads, and quick links to **Jaeger**, **Grafana**, **Prometheus**, **Alertmanager**, and **Mailpit**.
- **Container Packaging (`s11`–`s12`):** Multi-stage unprivileged Nginx `Dockerfile` serving the SPA (`/callback` fallback + `/healthz` probe), proxying `/api/*` same-origin while stripping `Origin`/`Referer`, and injecting runtime environment variables into `/env-config.js` (`window.__APP_CONFIG__`) so one image runs unchanged in Compose or Kubernetes.

## API Proxy & Keycloak Integration

Follows the backend's [UI integration contract](https://ffetih.github.io/ff-ecommerce-docs/ff-ecommerce/developer/ui-integration.html):

- **Same-origin API proxy (`vite.config.ts` / `docker/nginx.conf.template`):** `/api/*` proxies to the routing-only gateway (`http://shop.localtest.me:8888` by default for k3d/Flux, or `http://localhost:8080` in Compose mode via `VITE_GATEWAY_URL`) with IPv4-first DNS resolution for WSL2 and stripped `Origin`/`Referer` headers so no backend CORS relaxation is required.
- **Keycloak PKCE (`src/features/auth/authContext.tsx`):** Uses `oidc-client-ts` `UserManager` directly against Keycloak (`http://keycloak.localtest.me:8888/realms/ecommerce` by default, overridable via `VITE_OIDC_AUTHORITY` or container `OIDC_AUTHORITY`) with client `shop` (`redirect_uri: http://localhost:5173/callback`, `post_logout_redirect_uri: http://localhost:5173/`, `response_type: 'code'`, `scope: 'openid'`).

## Quick start

### Option A: Against k3d + Flux cluster (default, s12)

Ensure the `ff-ecommerce` k3d cluster is up and Flux Kustomizations are ready (`http://shop.localtest.me:8888` and `http://keycloak.localtest.me:8888`):

```bash
npm install
npm run dev                  # http://localhost:5173 -> *.localtest.me:8888
```

### Option B: Against Docker Compose (s11)

With `docker compose --profile app --profile observability up -d --wait` running on `localhost:8080` / `localhost:8180`:

```bash
npm install
npm run dev:compose          # http://localhost:5173 -> localhost:8080 / :8180
```

### Option C: Container image (Nginx same-origin proxy)

```bash
docker build -t ff-ecommerce-ui:local .
docker run --rm -p 5173:8080 \
  -e GATEWAY_URL=http://host.docker.internal:8080 \
  -e OIDC_AUTHORITY=http://localhost:8180/realms/ecommerce \
  ff-ecommerce-ui:local
```

Open **http://localhost:5173** and click **Sign in** to authenticate at Keycloak with the realm demo accounts (`password = username`):

| User | Role | Purpose |
| --- | --- | --- |
| `admin` | `admin` | Create products, receive stock, dispatch & deliver shipments, receive & reject returns, deactivate customers |
| `alice` | `customer` | Register `/me` profile, place orders, watch saga, test cancellation & request returns |
| `bob` | `customer` | Verify ownership isolation (`404` on Alice's orders and returns) |

## Scripts

```bash
npm run dev           # Vite dev server on http://localhost:5173 (k3d/Flux *.localtest.me:8888)
npm run dev:compose   # Vite dev server targeting Docker Compose (localhost:8080 / :8180)
npm run typecheck     # TypeScript strict check (app + Playwright tests)
npm run test          # Vitest unit & component tests
npm run test:e2e      # Playwright browser E2E suite (mocked API & OIDC — no cluster required)
npm run test:e2e:live # Playwright live full-stack smoke suite (against running k3d/Flux cluster)
npm run build         # Production typecheck + Vite bundle
```

### Playwright Test Suites (`e2e/`)

Playwright is split into two projects in [`playwright.config.ts`](playwright.config.ts):

- **`ui` (`e2e/ui/`, default via `npm run test:e2e`):** Runs in headless Chromium with mocked `/api` and Keycloak OIDC routes (zero cluster/Docker dependency; runs on every PR in GitHub Actions). Exercises the real `oidc-client-ts` PKCE `S256` redirect, guest cart persistence, `Idempotency-Key` rotation/replay, `503 Retry-After`, `202` async cancellation modal, `s09` partial return clamping/`422`/receive/reject/refund polling, `s10` W3C `traceparent` + Jaeger links, role guards, single-row admin navigation, and Protocol Inspector.
- **`live` (`e2e/live/`, via `npm run test:e2e:live`):** Runs serially against the live k3d/Flux cluster (`keycloak.localtest.me:8888`, `shop.localtest.me:8888`, all 5 services, Kafka, PostgreSQL, Jaeger) to verify real Keycloak PKCE login, `admin` product/stock creation, `PLACED → CONFIRMED → DELIVERED`, `s09` partial return → `RECEIVED → REFUNDED` + catalog restock + reject quota release, `202` cancellation (`VOIDED`), `tok_decline` (`DECLINED`), `bob` `404` ownership isolation, and live Jaeger trace links.

## Project Structure

```
docker/
  nginx.conf.template # Same-origin /api proxy (strips Origin/Referer), SPA fallback, /healthz
  30-runtime-env.sh   # Generates /env-config.js from container env vars at startup
Dockerfile            # Multi-stage node:22-alpine -> nginxinc/nginx-unprivileged:1.27-alpine
e2e/
  fixtures/           # Mock OIDC PKCE interceptor + live Keycloak login helpers
  ui/                 # Fast browser contract & protocol E2E suite (CI)
  live/               # Live full-stack smoke suite (k3d/Flux)
src/
  app/                # App shell, routing, RoadmapPage
  shared/             # runtimeConfig, W3C traceparent, httpClient (RFC 9457), CopyButton, <dialog>, tables
  features/
    auth/             # oidc-client-ts PKCE auth (in-memory userStore) + AuthCallbackPage + ProtocolInspector
    catalog/          # Storefront + Admin catalog & stock
    cart/             # Client-side cart + per-attempt Idempotency-Key + Jaeger trace link
    customer/         # /me onboarding & Admin directory
    orders/           # SagaTimeline + order list/detail + backoff polling + 202 async cancel
    payments/         # s08/s09 paymentStatus labels & simulated cardToken catalog (ADR-0009)
    returns/          # s09 partial/full returns, quota clamping, admin receive/reject & refund polling (ADR-0010)
    shipping/         # Admin saga operations (orders, shipments, reservations, returns & observability links)
```
