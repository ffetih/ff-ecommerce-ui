import type { Page } from '@playwright/test';

export type MockPersona = 'alice' | 'bob' | 'admin';

interface PersonaProfile {
  sub: string;
  username: string;
  name: string;
  email: string;
  roles: string[];
}

export const PERSONAS: Record<MockPersona, PersonaProfile> = {
  alice: {
    sub: 'a11ce000-0000-4000-8000-000000000001',
    username: 'alice',
    name: 'Alice Archer',
    email: 'alice@example.com',
    roles: ['customer'],
  },
  bob: {
    sub: 'b0b00000-0000-4000-8000-000000000002',
    username: 'bob',
    name: 'Bob Baker',
    email: 'bob@example.com',
    roles: ['customer'],
  },
  admin: {
    sub: 'ad000000-0000-4000-8000-000000000003',
    username: 'admin',
    name: 'Ada Admin',
    email: 'admin@example.com',
    roles: ['admin'],
  },
};

const AUTHORITY = 'http://keycloak.localtest.me:8888/realms/ecommerce';

function base64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  return `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url(payload)}.mock-signature`;
}

export interface CapturedAuthRequest {
  clientId: string | null;
  redirectUri: string | null;
  responseType: string | null;
  scope: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  state: string | null;
  nonce: string | null;
  prompt: string | null;
}

export interface CapturedTokenRequest {
  grantType: string | null;
  clientId: string | null;
  code: string | null;
  codeVerifier: string | null;
  redirectUri: string | null;
}

export interface MockOidcController {
  setPersona: (persona: MockPersona) => void;
  authRequests: CapturedAuthRequest[];
  tokenRequests: CapturedTokenRequest[];
  logoutRequests: { postLogoutRedirectUri: string | null; idTokenHint: string | null }[];
}

/**
 * Intercepts Keycloak OIDC endpoints so `e2e/ui/` exercises the real `oidc-client-ts`
 * Authorization Code + PKCE (S256) flow in Chromium without requiring Docker/Keycloak.
 */
export async function installMockOidc(
  page: Page,
  initialPersona: MockPersona = 'alice',
): Promise<MockOidcController> {
  let currentPersona: MockPersona = initialPersona;
  let lastNonce: string | null = null;
  let codeCounter = 0;

  const authRequests: CapturedAuthRequest[] = [];
  const tokenRequests: CapturedTokenRequest[] = [];
  const logoutRequests: { postLogoutRedirectUri: string | null; idTokenHint: string | null }[] = [];

  await page.route(`${AUTHORITY}/.well-known/openid-configuration`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        issuer: AUTHORITY,
        authorization_endpoint: `${AUTHORITY}/protocol/openid-connect/auth`,
        token_endpoint: `${AUTHORITY}/protocol/openid-connect/token`,
        end_session_endpoint: `${AUTHORITY}/protocol/openid-connect/logout`,
        jwks_uri: `${AUTHORITY}/protocol/openid-connect/certs`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      }),
    });
  });

  await page.route(`${AUTHORITY}/protocol/openid-connect/auth**`, async (route) => {
    const url = new URL(route.request().url());
    const params = url.searchParams;
    lastNonce = params.get('nonce');
    const redirectUri = params.get('redirect_uri') || 'http://localhost:5173/callback';
    const state = params.get('state') || '';

    authRequests.push({
      clientId: params.get('client_id'),
      redirectUri: params.get('redirect_uri'),
      responseType: params.get('response_type'),
      scope: params.get('scope'),
      codeChallenge: params.get('code_challenge'),
      codeChallengeMethod: params.get('code_challenge_method'),
      state: params.get('state'),
      nonce: lastNonce,
      prompt: params.get('prompt'),
    });

    codeCounter += 1;
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', `mock-code-${currentPersona}-${codeCounter}`);
    callback.searchParams.set('state', state);
    callback.searchParams.set('iss', AUTHORITY);

    await route.fulfill({
      status: 302,
      headers: {
        Location: callback.toString(),
      },
    });
  });

  await page.route(`${AUTHORITY}/protocol/openid-connect/token`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }

    const body = new URLSearchParams(request.postData() || '');
    tokenRequests.push({
      grantType: body.get('grant_type'),
      clientId: body.get('client_id'),
      code: body.get('code'),
      codeVerifier: body.get('code_verifier'),
      redirectUri: body.get('redirect_uri'),
    });

    const profile = PERSONAS[currentPersona];
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 900;

    const accessToken = makeJwt({
      iss: AUTHORITY,
      sub: profile.sub,
      preferred_username: profile.username,
      name: profile.name,
      email: profile.email,
      aud: ['catalog-service', 'customer-service', 'order-service', 'shipping-service', 'payment-service'],
      realm_access: { roles: profile.roles },
      iat: now,
      exp,
    });

    const idToken = makeJwt({
      iss: AUTHORITY,
      aud: 'shop',
      sub: profile.sub,
      preferred_username: profile.username,
      name: profile.name,
      email: profile.email,
      ...(lastNonce ? { nonce: lastNonce } : {}),
      iat: now,
      exp,
    });

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        access_token: accessToken,
        id_token: idToken,
        refresh_token: `mock-refresh-${currentPersona}`,
        token_type: 'Bearer',
        expires_in: 900,
        scope: 'openid',
      }),
    });
  });

  await page.route(`${AUTHORITY}/protocol/openid-connect/logout**`, async (route) => {
    const url = new URL(route.request().url());
    const postLogoutRedirectUri = url.searchParams.get('post_logout_redirect_uri') || 'http://localhost:5173/';
    logoutRequests.push({
      postLogoutRedirectUri: url.searchParams.get('post_logout_redirect_uri'),
      idTokenHint: url.searchParams.get('id_token_hint'),
    });
    await route.fulfill({
      status: 302,
      headers: {
        Location: postLogoutRedirectUri,
      },
    });
  });

  return {
    setPersona: (persona: MockPersona) => {
      currentPersona = persona;
    },
    authRequests,
    tokenRequests,
    logoutRequests,
  };
}
