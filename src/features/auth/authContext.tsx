import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
  type User,
} from 'oidc-client-ts';
import { configureHttpClient } from '../../shared/api/httpClient';
import { getRuntimeConfig } from '../../shared/config/runtimeConfig';
import { decodeJwtPayload, extractAudiences, extractRoles, type DecodedJwt } from '../../shared/utils/jwt';

const REFRESH_BUFFER_MS = 30_000;
const EXPIRY_SAFETY_MS = 5_000;

export interface DemoAccount {
  username: string;
  id: string;
  email: string;
  role: 'customer' | 'admin';
  label: string;
}

/** Fixed Keycloak identities from infra/keycloak/import/ecommerce-realm.json (for admin UUID lookup). */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    username: 'alice',
    id: 'a11ce000-0000-4000-8000-000000000001',
    email: 'alice@example.com',
    role: 'customer',
    label: 'Alice Archer (Customer)',
  },
  {
    username: 'bob',
    id: 'b0b00000-0000-4000-8000-000000000002',
    email: 'bob@example.com',
    role: 'customer',
    label: 'Bob Baker (Customer)',
  },
  {
    username: 'admin',
    id: 'ad000000-0000-4000-8000-000000000003',
    email: 'admin@example.com',
    role: 'admin',
    label: 'Ada Admin (Back Office)',
  },
];

export interface AuthSession {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
  claims: DecodedJwt;
  roles: string[];
  audiences: string[];
  subject: string;
  username: string;
  email: string | null;
  clientId: string;
}

interface AuthContextValue {
  authority: string;
  clientId: string;
  session: AuthSession | null;
  isAuthenticated: boolean;
  authBusy: boolean;
  authError: string | null;
  clearAuthError: () => void;
  hasRole: (role: string) => boolean;
  login: (options?: { returnTo?: string; promptLogin?: boolean }) => Promise<void>;
  completeLoginCallback: (url?: string) => Promise<string>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function getOidcConfig(origin = window.location.origin) {
  const { oidcAuthority, oidcClientId } = getRuntimeConfig();
  const cleanOrigin = origin.replace(/\/$/, '');

  return {
    authority: oidcAuthority,
    client_id: oidcClientId,
    redirect_uri: `${cleanOrigin}/callback`,
    post_logout_redirect_uri: `${cleanOrigin}/`,
    response_type: 'code',
    scope: 'openid',
  };
}

export function createOidcUserManager(origin = window.location.origin): UserManager {
  const config = getOidcConfig(origin);
  return new UserManager({
    ...config,
    // Keep access/refresh/id tokens strictly in memory (never localStorage or sessionStorage).
    // OIDC PKCE stateStore uses sessionStorage only for the transient verifier across the redirect.
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    automaticSilentRenew: true,
    loadUserInfo: false,
    monitorSession: false,
  });
}

function sanitizeReturnPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/callback')) {
    return '/';
  }
  return path;
}

function userToSession(user: User | null, clientId: string): AuthSession | null {
  if (!user || !user.access_token) return null;
  const claims = decodeJwtPayload(user.access_token);
  if (!claims || !claims.sub) return null;

  const expiresAt = claims.exp
    ? claims.exp * 1000
    : user.expires_at
      ? user.expires_at * 1000
      : Date.now() + 900_000;

  return {
    accessToken: user.access_token,
    refreshToken: user.refresh_token ?? null,
    idToken: user.id_token ?? null,
    expiresAt,
    claims,
    roles: extractRoles(claims),
    audiences: extractAudiences(claims),
    subject: claims.sub,
    username:
      claims.preferred_username ||
      claims.name ||
      (typeof user.profile?.preferred_username === 'string' ? user.profile.preferred_username : null) ||
      claims.sub,
    email:
      typeof claims.email === 'string'
        ? claims.email
        : typeof user.profile?.email === 'string'
          ? user.profile.email
          : null,
    clientId,
  };
}

interface CallbackResult {
  session: AuthSession;
  returnTo: string;
}

// Deduplicates single-use authorization code exchange across React StrictMode double effects.
const inFlightCallbacks = new Map<string, Promise<CallbackResult>>();

export function resetAuthCallbackCacheForTests(): void {
  inFlightCallbacks.clear();
}

/**
 * Manages Keycloak Authorization Code + PKCE (S256) authentication via `oidc-client-ts`.
 *
 * - Never renders a password form or uses `ecommerce-dev`.
 * - Stores tokens strictly in memory via `InMemoryWebStorage`.
 * - Refreshes expiring tokens before API calls and never sends an expired token
 *   (which services reject with 401 even on public endpoints).
 */
export function AuthProvider({
  children,
  userManager: providedManager,
}: {
  children: ReactNode;
  userManager?: UserManager;
}) {
  const managerRef = useRef<UserManager | null>(providedManager ?? null);
  if (!managerRef.current) {
    managerRef.current = createOidcUserManager(window.location.origin);
  }
  const manager = managerRef.current;
  const authority = manager.settings.authority;
  const clientId = manager.settings.client_id;

  const [session, setSession] = useState<AuthSession | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const sessionRef = useRef<AuthSession | null>(null);
  sessionRef.current = session;
  const refreshPromiseRef = useRef<Promise<AuthSession | null> | null>(null);

  const syncUser = useCallback(
    (user: User | null) => {
      const next = userToSession(user, clientId);
      sessionRef.current = next;
      setSession(next);
      return next;
    },
    [clientId],
  );

  const refreshSession = useCallback(async (): Promise<AuthSession | null> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    const promise = (async () => {
      try {
        const renewed = await manager.signinSilent();
        return syncUser(renewed);
      } catch {
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = promise;
    return promise;
  }, [manager, syncUser]);

  useEffect(() => {
    let mounted = true;

    void manager.getUser().then((existing) => {
      if (!mounted) return;
      if (existing && !existing.expired) {
        syncUser(existing);
      }
    });

    const unsubLoaded = manager.events.addUserLoaded((user) => {
      if (mounted) syncUser(user);
    });
    const unsubUnloaded = manager.events.addUserUnloaded(() => {
      if (mounted) syncUser(null);
    });
    const unsubExpired = manager.events.addAccessTokenExpired(() => {
      if (!mounted) return;
      void refreshSession().then((renewed) => {
        if (!renewed && mounted) {
          void manager.removeUser();
          syncUser(null);
        }
      });
    });

    return () => {
      mounted = false;
      unsubLoaded();
      unsubUnloaded();
      unsubExpired();
    };
  }, [manager, refreshSession, syncUser]);

  useEffect(() => {
    configureHttpClient({
      getAccessToken: async () => {
        const current = sessionRef.current;
        if (!current) return null;

        const remainingMs = current.expiresAt - Date.now();
        if (remainingMs > REFRESH_BUFFER_MS) {
          return current.accessToken;
        }

        if (current.refreshToken) {
          const renewed = await refreshSession();
          if (renewed && renewed.expiresAt - Date.now() > EXPIRY_SAFETY_MS) {
            return renewed.accessToken;
          }
        }

        // Still briefly valid: use it; otherwise clear session and send no token at all.
        if (current.expiresAt - Date.now() > EXPIRY_SAFETY_MS) {
          return current.accessToken;
        }

        void manager.removeUser();
        syncUser(null);
        return null;
      },
      onUnauthorized: () => {
        const current = sessionRef.current;
        if (current && current.expiresAt - Date.now() <= REFRESH_BUFFER_MS) {
          void manager.removeUser();
          syncUser(null);
        }
      },
    });
  }, [manager, refreshSession, syncUser]);

  const login = useCallback(
    async (options?: { returnTo?: string; promptLogin?: boolean }) => {
      setAuthError(null);
      setAuthBusy(true);
      try {
        const returnTo = sanitizeReturnPath(
          options?.returnTo ?? `${window.location.pathname}${window.location.search}`,
        );
        await manager.signinRedirect({
          state: { returnTo },
          prompt: options?.promptLogin ? 'login' : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start Keycloak sign-in.';
        setAuthError(
          `${message} Ensure Keycloak is running at ${authority} and has imported the "${clientId}" client (k3d/Flux cluster or Docker Compose).`,
        );
        setAuthBusy(false);
      }
    },
    [authority, clientId, manager],
  );

  const completeLoginCallback = useCallback(
    async (url = window.location.href): Promise<string> => {
      const parsedUrl = new URL(url, window.location.origin);
      const oauthError = parsedUrl.searchParams.get('error');
      if (oauthError) {
        const desc = parsedUrl.searchParams.get('error_description');
        throw new Error(desc ? `${oauthError}: ${desc}` : oauthError);
      }

      const code = parsedUrl.searchParams.get('code');
      const dedupeKey = code ?? url;

      let callbackPromise = inFlightCallbacks.get(dedupeKey);
      if (!callbackPromise) {
        callbackPromise = (async () => {
          const user = await manager.signinRedirectCallback(url);
          const next = userToSession(user, clientId);
          if (!next) {
            throw new Error('Keycloak callback completed without a decodable access token.');
          }
          const userState = user.state as { returnTo?: unknown } | undefined;
          return {
            session: next,
            returnTo: sanitizeReturnPath(userState?.returnTo),
          };
        })();

        inFlightCallbacks.set(dedupeKey, callbackPromise);
        void callbackPromise.catch(() => {
          inFlightCallbacks.delete(dedupeKey);
        });
      }

      const result = await callbackPromise;
      sessionRef.current = result.session;
      setSession(result.session);
      setAuthError(null);
      setAuthBusy(false);
      return result.returnTo;
    },
    [clientId, manager],
  );

  const logout = useCallback(async () => {
    const idTokenHint = sessionRef.current?.idToken ?? undefined;
    syncUser(null);
    try {
      await manager.removeUser();
      await manager.signoutRedirect({
        id_token_hint: idTokenHint,
      });
    } catch {
      // Local in-memory session is already cleared even if Keycloak is unreachable.
    }
  }, [manager, syncUser]);

  const hasRole = useCallback(
    (role: string) => Boolean(session?.roles.includes(role)),
    [session],
  );

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authority,
      clientId,
      session,
      isAuthenticated: session !== null,
      authBusy,
      authError,
      clearAuthError,
      hasRole,
      login,
      completeLoginCallback,
      logout,
    }),
    [
      authority,
      clientId,
      session,
      authBusy,
      authError,
      clearAuthError,
      hasRole,
      login,
      completeLoginCallback,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
