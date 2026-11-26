# FF E-Commerce UI (`ff-ecommerce-ui`)

A React + TypeScript storefront and back-office application for [ff-ecommerce](https://github.com/ffetih/ff-ecommerce) (documented at [ff-ecommerce-docs](https://ffetih.github.io/ff-ecommerce-docs/ff-ecommerce/developer/web-console.html)), currently implementing **s00–s06** and structured so **s08 Payments**, **s09 Returns**, **s10 Observability**, and **s11 Packaging** plug in as independent feature slices.

## What is covered today (s00–s06)

- **Public Storefront (`/`):** Browse products (`GET /api/v1/products`) without sending any token when logged out, filter by name/SKU, see off-sale badges (`active: false`), add to cart.
- **Authorization Code + PKCE (`shop` client via `oidc-client-ts`):** No password form in the console; clicking **Sign in** redirects to Keycloak (`http://localhost:8180/realms/ecommerce`) with S256 PKCE, completes at `/callback`, keeps tokens strictly in memory (`InMemoryWebStorage`), refreshes expiring tokens proactively before API calls, and never sends an expired token.
- **Idempotent Checkout (`/cart`):** Multi-line order placement (`POST /api/v1/orders`) with a visible per-attempt `Idempotency-Key` UUID, automatic key rotation when cart contents change, mixed-currency guard, safe retry with the same key on `503 Retry-After`, and explicit `200 Idempotent-Replayed: true` feedback.
- **Customer Onboarding & Profile (`/profile`):** Calls `GET /api/v1/customers/me`; on `404`, guides first-time users through `POST /api/v1/customers/me` (customer id `sub` and `email` come from the Keycloak token). Supports updating the shipping address (`PUT /me/shipping-address`) and displays deactivated account restrictions (`409`).
- **Live Order Saga Tracking & Async Cancellation (`/orders`, `/orders/:id`):** Visualizes `PLACED → CONFIRMED → SHIPPED → DELIVERED` and `CANCELLATION_REQUESTED → CANCELLED`, polling transitional states with backoff (`500 ms` → `3 s`) and pausing cleanly with a "Still processing" notice on timeout. Surfaces the s06 `200` (placed) vs `202 Accepted` (confirmed — waiting on `shipping-service`) cancellation gate.
- **Back-Office Console (`/admin/*`, `ROLE_admin`):**
  - **Catalog & Stock (`/admin/catalog`):** Create products, update prices, take products off sale (`POST .../deactivate`), inspect `onHand / reserved / available`, book idempotent goods receipts (`referenceId` UUID).
  - **Operations (`/admin/operations`):** Inspect customer orders, shipments (`GET /api/v1/shipments?orderId=...`), and catalog reservations (`GET /api/v1/reservations/{orderId}`) side-by-side; trigger **Dispatch** and **Deliver**.
  - **Customers (`/admin/customers`):** Lookup customer profiles by UUID (with `alice`/`bob` quick buttons) and deactivate accounts.
- **Protocol Inspector (top bar → `Inspector`):** Live panel displaying decoded JWT claims (`sub`, `roles`, `aud`, `exp`) and captured HTTP calls with status codes, `Idempotency-Key`, `Idempotent-Replayed`, `Retry-After`, and RFC 9457 `ProblemDetail` payloads.

## API Proxy & Keycloak Integration

Follows the backend's [UI integration contract](https://ffetih.github.io/ff-ecommerce-docs/ff-ecommerce/developer/ui-integration.html):

- **Same-origin API proxy (`vite.config.ts`):** `/api/*` proxies to the routing-only gateway (`http://localhost:8080`, overridable via `VITE_GATEWAY_URL`) so no backend CORS relaxation is required.
- **Keycloak PKCE (`src/features/auth/authContext.tsx`):** Uses `oidc-client-ts` `UserManager` directly against Keycloak (`http://localhost:8180/realms/ecommerce`, overridable via `VITE_OIDC_AUTHORITY`) with client `shop` (`redirect_uri: http://localhost:5173/callback`, `post_logout_redirect_uri: http://localhost:5173/`, `response_type: 'code'`, `scope: 'openid'`).

## Quick start

1. Start the backend stack from `ff-ecommerce`:
   - `docker compose up -d --wait` (PostgreSQL `:5432`, Kafka `:9092`, Keycloak `:8180`). If Keycloak was started before the `shop` client was added to `ecommerce-realm.json`, recreate it once: `docker compose up -d --force-recreate keycloak`.
   - Start `catalog-service` (`:8081`), `customer-service` (`:8082`), `order-service` (`:8083`), `shipping-service` (`:8084`), and `gateway` (`:8080`).
2. Start the UI:

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and click **Sign in** to authenticate at Keycloak with the realm demo accounts (`password = username`):

| User | Role | Purpose |
| --- | --- | --- |
| `admin` | `admin` | Create products, receive stock, dispatch & deliver shipments, deactivate customers |
| `alice` | `customer` | Register `/me` profile, place orders, watch saga & test cancellation |
| `bob` | `customer` | Verify ownership isolation (`404` on Alice's orders) |

## Scripts

```bash
npm run dev           # Vite dev server on http://localhost:5173
npm run typecheck     # TypeScript strict check (app + Playwright tests)
npm run test          # Vitest unit & component tests
npm run test:e2e      # Playwright browser E2E suite (mocked API & OIDC — no Docker required)
npm run test:e2e:live # Playwright live full-stack smoke suite (requires running backend stack)
npm run build         # Production typecheck + Vite bundle
```

### Playwright Test Suites (`e2e/`)

Playwright is split into two projects in [`playwright.config.ts`](playwright.config.ts):

- **`ui` (`e2e/ui/`, default via `npm run test:e2e`):** Runs in headless Chromium with mocked `/api` and Keycloak OIDC routes (zero backend/Docker dependency; runs on every PR in GitHub Actions). Exercises the real `oidc-client-ts` PKCE `S256` redirect, guest cart persistence, `Idempotency-Key` rotation/replay, `503 Retry-After`, `202` async cancellation modal, role guards, and Protocol Inspector.
- **`live` (`e2e/live/`, via `npm run test:e2e:live`):** Runs serially against the real local stack (Keycloak `:8180`, Gateway `:8080`, all 4 services, Kafka, PostgreSQL) to verify real Keycloak PKCE login, `admin` product/stock creation, `PLACED → CONFIRMED → DELIVERED`, `202` cancellation, and `bob` `404` ownership isolation.

## Extending in future sprints

The codebase is organized by bounded context under `src/features/`:

```
e2e/
  fixtures/           # Mock OIDC PKCE interceptor + live Keycloak login helpers
  ui/                 # Fast browser contract & protocol E2E suite (CI)
  live/               # Live full-stack smoke suite
src/
  app/                # App shell, routing, RoadmapPage
  shared/             # httpClient (RFC 9457 + traces), native <dialog>, responsive tables, validation hooks
  features/
    auth/             # oidc-client-ts PKCE auth (in-memory userStore) + AuthCallbackPage + ProtocolInspector
    catalog/          # Storefront + Admin catalog & stock
    cart/             # Client-side cart + per-attempt Idempotency-Key
    customer/         # /me onboarding & Admin directory
    orders/           # SagaTimeline + order list/detail + backoff polling + 202 async cancel
    shipping/         # Admin saga operations (orders + shipments + reservations)
    # s08: payments/  # Checkout cardToken selector + order paymentStatus view
    # s09: returns/   # Return request on DELIVERED orders + admin approval
```
