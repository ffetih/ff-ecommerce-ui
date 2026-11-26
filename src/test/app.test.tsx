import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { User, UserManager } from 'oidc-client-ts';
import { decodeJwtPayload, extractAudiences, extractRoles } from '../shared/utils/jwt';
import { extractTraceId, generateTraceContext } from '../shared/utils/trace';
import { getObservabilityLinks, getRuntimeConfig, jaegerTraceUrl } from '../shared/config/runtimeConfig';
import { apiRequest, clearHttpTraces, configureHttpClient, subscribeHttpTraces } from '../shared/api/httpClient';
import { ApiError, type HttpTraceEntry } from '../shared/api/types';
import { CartProvider, useCart } from '../features/cart/cartContext';
import { isOrderInFlight } from '../features/orders/api';
import { SagaTimeline } from '../features/orders/SagaTimeline';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { SIMULATED_CARD_TOKENS } from '../features/payments/model';
import {
  canOrderBeReturned,
  isReturnInFlight,
  remainingReturnableUnits,
} from '../features/returns/api';
import {
  AuthProvider,
  createOidcUserManager,
  getOidcConfig,
  resetAuthCallbackCacheForTests,
  useAuth,
} from '../features/auth/authContext';
import { CopyButton } from '../shared/ui/CopyButton';
import { ToastProvider } from '../shared/ui/ToastRegion';
import { ModalDialog } from '../shared/ui/ModalDialog';

function makeFakeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('JWT helper', () => {
  it('extracts Keycloak sub, realm roles, and audiences from base64url tokens', () => {
    const token = makeFakeJwt({
      sub: 'a11ce000-0000-4000-8000-000000000001',
      email: 'alice@example.com',
      aud: ['catalog-service', 'order-service', 'payment-service'],
      realm_access: { roles: ['customer', ' '] },
    });

    const claims = decodeJwtPayload(token);
    expect(claims?.sub).toBe('a11ce000-0000-4000-8000-000000000001');
    expect(extractRoles(claims)).toEqual(['customer']);
    expect(extractAudiences(claims)).toEqual(['catalog-service', 'order-service', 'payment-service']);
  });
});

describe('Runtime configuration and OIDC PKCE defaults (k3d/Flux + container overrides)', () => {
  afterEach(() => {
    delete window.__APP_CONFIG__;
  });

  it('defaults to the k3d/Flux Traefik endpoints and honors window.__APP_CONFIG__ overrides', () => {
    const config = getOidcConfig('http://localhost:5173');
    expect(config).toEqual({
      authority: 'http://keycloak.localtest.me:8888/realms/ecommerce',
      client_id: 'shop',
      redirect_uri: 'http://localhost:5173/callback',
      post_logout_redirect_uri: 'http://localhost:5173/',
      response_type: 'code',
      scope: 'openid',
    });

    const manager = createOidcUserManager('http://localhost:5173');
    expect(manager.settings.client_id).toBe('shop');
    expect(manager.settings.response_type).toBe('code');
    expect(manager.settings.redirect_uri).toBe('http://localhost:5173/callback');
    expect(manager.settings.post_logout_redirect_uri).toBe('http://localhost:5173/');
    expect(manager.settings.scope).toBe('openid');

    window.__APP_CONFIG__ = {
      oidcAuthority: 'http://localhost:8180/realms/ecommerce/',
      jaegerUrl: 'http://localhost:16686/',
      alertmanagerUrl: '',
      mailpitUrl: '',
    };
    const overridden = getRuntimeConfig();
    expect(overridden.oidcAuthority).toBe('http://localhost:8180/realms/ecommerce');
    expect(jaegerTraceUrl('abcdef0123456789abcdef0123456789', overridden)).toBe(
      'http://localhost:16686/trace/abcdef0123456789abcdef0123456789',
    );
    expect(getObservabilityLinks(overridden).map((l) => l.id)).toEqual([
      'jaeger',
      'grafana',
      'prometheus',
    ]);
  });

  it('deduplicates StrictMode double callback calls and stores session in memory', async () => {
    resetAuthCallbackCacheForTests();
    const token = makeFakeJwt({
      sub: 'a11ce000-0000-4000-8000-000000000001',
      preferred_username: 'alice',
      email: 'alice@example.com',
      aud: ['catalog-service', 'customer-service', 'order-service', 'shipping-service', 'payment-service'],
      realm_access: { roles: ['customer'] },
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const signinRedirectCallback = vi.fn().mockResolvedValue({
      access_token: token,
      refresh_token: 'refresh-1',
      id_token: 'id-1',
      state: { returnTo: '/cart' },
      profile: { sub: 'a11ce000-0000-4000-8000-000000000001' },
    } as unknown as User);

    const fakeManager = {
      settings: { authority: 'http://keycloak.localtest.me:8888/realms/ecommerce', client_id: 'shop' },
      getUser: vi.fn().mockResolvedValue(null),
      removeUser: vi.fn().mockResolvedValue(undefined),
      signinRedirectCallback,
      events: {
        addUserLoaded: () => () => {},
        addUserUnloaded: () => () => {},
        addAccessTokenExpired: () => () => {},
      },
    } as unknown as UserManager;

    let completeFn: ((url?: string) => Promise<string>) | null = null;
    function Probe() {
      const { session, completeLoginCallback } = useAuth();
      completeFn = completeLoginCallback;
      return <span data-testid="user">{session?.username ?? 'anon'}</span>;
    }

    render(
      <AuthProvider userManager={fakeManager}>
        <Probe />
      </AuthProvider>,
    );

    const callbackUrl = 'http://localhost:5173/callback?code=once-only-code&state=s1';
    let r1 = '';
    let r2 = '';
    await act(async () => {
      [r1, r2] = await Promise.all([completeFn!(callbackUrl), completeFn!(callbackUrl)]);
    });
    expect(r1).toBe('/cart');
    expect(r2).toBe('/cart');
    expect(signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('user')).toHaveTextContent('alice');
  });
});

describe('httpClient and s10 W3C traceparent propagation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearHttpTraces();
    configureHttpClient({ getAccessToken: () => null });
  });

  it('generates valid W3C traceparent values and attaches them without Authorization when logged out', async () => {
    const generated = generateTraceContext();
    expect(generated.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(extractTraceId(generated.traceparent)).toBe(generated.traceId);

    configureHttpClient({ getAccessToken: async () => null });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await apiRequest('/api/v1/products');
    const sentHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.get('Authorization')).toBeNull();
    expect(sentHeaders.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(result.headers.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(sentHeaders.get('traceparent')).toContain(result.headers.traceId);
  });

  it('parses RFC 9457 ProblemDetails, Retry-After, and records trace entries with traceId', async () => {
    const traces: HttpTraceEntry[][] = [];
    const unsubscribe = subscribeHttpTraces((entries) => traces.push(entries));

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Temporarily unavailable',
          status: 503,
          detail: 'catalog-service is unavailable; retry with the same Idempotency-Key',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/problem+json',
            'Retry-After': '5',
          },
        },
      ),
    );

    await expect(
      apiRequest('/api/v1/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
        body: { lines: [{ sku: 'KB-01', quantity: 1 }] },
      }),
    ).rejects.toMatchObject({
      status: 503,
      retryAfter: '5',
    } satisfies Partial<ApiError>);

    unsubscribe();
    const latest = traces.at(-1)?.[0];
    expect(latest?.status).toBe(503);
    expect(latest?.idempotencyKey).toBe('11111111-1111-4111-8111-111111111111');
    expect(latest?.retryAfter).toBe('5');
    expect(latest?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('captures Idempotent-Replayed header on 200 replay responses', async () => {
    configureHttpClient({ getAccessToken: async () => 'fake-token' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'order-1', status: 'PLACED' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Idempotent-Replayed': 'true',
        },
      }),
    );

    const result = await apiRequest<{ id: string }>('/api/v1/orders', { method: 'POST', body: {} });
    expect(result.status).toBe(200);
    expect(result.headers.idempotentReplayed).toBe(true);
  });
});

describe('CartProvider idempotency key lifecycle', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  function CartProbe() {
    const { idempotencyKey, cardToken, addItem, setQuantity, setCardToken, totalCount } = useCart();
    return (
      <div>
        <span data-testid="key">{idempotencyKey}</span>
        <span data-testid="card">{cardToken}</span>
        <span data-testid="count">{totalCount}</span>
        <button
          type="button"
          onClick={() =>
            addItem({ sku: 'KB-01', name: 'Keyboard', unitPrice: 89.9, currency: 'EUR', active: true })
          }
        >
          Add KB
        </button>
        <button type="button" onClick={() => setQuantity('KB-01', 3)}>
          Set 3
        </button>
        <button type="button" onClick={() => setCardToken('tok_refund_fails')}>
          Use Refund Fails Card
        </button>
      </div>
    );
  }

  it('rotates Idempotency-Key whenever cart contents or cardToken change', async () => {
    const user = userEvent.setup();
    render(
      <CartProvider>
        <CartProbe />
      </CartProvider>,
    );

    expect(screen.getByTestId('card')).toHaveTextContent('tok_ok');
    const initialKey = screen.getByTestId('key').textContent;
    await user.click(screen.getByRole('button', { name: 'Add KB' }));
    const afterAddKey = screen.getByTestId('key').textContent;
    expect(afterAddKey).not.toBe(initialKey);
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Set 3' }));
    const afterQtyKey = screen.getByTestId('key').textContent;
    expect(afterQtyKey).not.toBe(afterAddKey);
    expect(screen.getByTestId('count')).toHaveTextContent('3');

    await user.click(screen.getByRole('button', { name: 'Use Refund Fails Card' }));
    const afterCardKey = screen.getByTestId('key').textContent;
    expect(afterCardKey).not.toBe(afterQtyKey);
    expect(screen.getByTestId('card')).toHaveTextContent('tok_refund_fails');
  });
});

describe('s08/s09 payments, returns domain rules, and SagaTimeline', () => {
  it('includes tok_refund_fails in simulated payment tokens and computes return eligibility and quotas', () => {
    expect(SIMULATED_CARD_TOKENS.map((t) => t.token)).toContain('tok_refund_fails');

    expect(canOrderBeReturned({ status: 'DELIVERED', paymentStatus: 'CAPTURED' })).toBe(true);
    expect(canOrderBeReturned({ status: 'DELIVERED', paymentStatus: 'OVERDUE' })).toBe(false);
    expect(canOrderBeReturned({ status: 'SHIPPED', paymentStatus: 'CAPTURED' })).toBe(false);

    expect(isReturnInFlight('RECEIVED')).toBe(true);
    expect(isReturnInFlight('REQUESTED')).toBe(false);
    expect(isReturnInFlight('REFUNDED')).toBe(false);
    expect(isReturnInFlight('REFUND_FAILED')).toBe(false);

    const quotas = remainingReturnableUnits(
      {
        lines: [
          { sku: 'KB-01', quantity: 3, unitPrice: 50, lineTotal: 150 },
          { sku: 'MS-01', quantity: 2, unitPrice: 20, lineTotal: 40 },
        ],
      },
      { 'KB-01': 2, 'MS-01': 2 },
    );
    expect(quotas).toEqual([
      { sku: 'KB-01', ordered: 3, returned: 2, remaining: 1, unitPrice: 50 },
      { sku: 'MS-01', ordered: 2, returned: 2, remaining: 0, unitPrice: 20 },
    ]);
  });

  it('renders the s06 CANCELLATION_REQUESTED waiting gate', () => {
    render(
      <SagaTimeline
        status="CANCELLATION_REQUESTED"
        paymentStatus="AUTHORIZED"
        cancellationReason="changed my mind"
      />,
    );
    expect(screen.getByText('3. Cancellation Requested')).toBeInTheDocument();
    expect(screen.getByText(/202 Accepted/i)).toBeInTheDocument();
  });

  it('renders payment decline and overdue states and detects in-flight payments', () => {
    render(
      <SagaTimeline
        status="CANCELLED"
        paymentStatus="DECLINED"
        cancellationReason="Payment declined: Card declined"
      />,
    );
    expect(screen.getByText(/Payment declined: Card declined/)).toBeInTheDocument();
    expect(screen.getByText(/Card declined — nothing charged/)).toBeInTheDocument();

    expect(isOrderInFlight('SHIPPED', 'CAPTURING')).toBe(true);
    expect(isOrderInFlight('CANCELLED', 'VOIDING')).toBe(true);
    expect(isOrderInFlight('SHIPPED', 'CAPTURED')).toBe(false);
    expect(isOrderInFlight('SHIPPED', 'OVERDUE')).toBe(false);
  });
});

describe('CatalogPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows active and off-sale products and disables adding off-sale products', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { sku: 'KB-01', name: 'Mechanical Keyboard', unitPrice: 89.9, currency: 'EUR', active: true },
          { sku: 'OLD-01', name: 'Retired Mouse', unitPrice: 12.0, currency: 'EUR', active: false },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <CartProvider>
              <ToastProvider>
                <CatalogPage />
              </ToastProvider>
            </CartProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Mechanical Keyboard')).toBeInTheDocument();
    expect(screen.getByText('Retired Mouse')).toBeInTheDocument();

    const addButtons = screen.getAllByRole('button', { name: /add to cart/i });
    expect(addButtons[0]).toBeEnabled();
    expect(addButtons[1]).toBeDisabled();
  });
});

describe('CopyButton & ModalDialog accessibility contracts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('copies target element text and keeps role="status" outside the button', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    render(
      <div>
        <code id="trace-sample">11223344556677889900aabbccddeeff</code>
        <CopyButton targetId="trace-sample" label="Copy trace ID" />
      </div>,
    );

    const button = screen.getByRole('button', { name: 'Copy trace ID' });
    expect(button).toHaveAttribute('command', '--copy');
    expect(button).toHaveAttribute('commandfor', 'trace-sample');
    expect(button.querySelector('[role="status"]')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();

    await user.click(button);
    expect(writeText).toHaveBeenCalledWith('11223344556677889900aabbccddeeff');
    expect(button).not.toBeDisabled();
  });

  it('uses native <dialog> without redundant role="dialog" or aria-modal', () => {
    const { container } = render(
      <ModalDialog open={true} title="Confirm action" onClose={() => {}}>
        <p>Body text</p>
      </ModalDialog>,
    );
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog).not.toHaveAttribute('role');
    expect(dialog).not.toHaveAttribute('aria-modal');
    const title = screen.getByRole('heading', { level: 1, name: 'Confirm action' });
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
  });
});
