import { newUuid } from '../utils/format';
import { ApiError, type ApiResult, type HttpTraceEntry, type ProblemDetail } from './types';

type TokenProvider = () => string | null | Promise<string | null>;
type UnauthorizedHandler = () => void;
type TraceListener = (entries: HttpTraceEntry[]) => void;

const MAX_TRACES = 30;
let tokenProvider: TokenProvider = () => null;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let traceEntries: HttpTraceEntry[] = [];
const traceListeners = new Set<TraceListener>();

export function configureHttpClient(options: {
  getAccessToken: TokenProvider;
  onUnauthorized?: UnauthorizedHandler;
}): void {
  tokenProvider = options.getAccessToken;
  unauthorizedHandler = options.onUnauthorized ?? null;
}

export function subscribeHttpTraces(listener: TraceListener): () => void {
  traceListeners.add(listener);
  listener(traceEntries);
  return () => {
    traceListeners.delete(listener);
  };
}

export function clearHttpTraces(): void {
  traceEntries = [];
  traceListeners.forEach((listener) => listener(traceEntries));
}

function recordTrace(entry: HttpTraceEntry): void {
  traceEntries = [entry, ...traceEntries].slice(0, MAX_TRACES);
  traceListeners.forEach((listener) => listener(traceEntries));
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json, application/problem+json');

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const token = options.skipAuth ? null : await tokenProvider();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (networkError) {
    const durationMs = Math.round(performance.now() - startedAt);
    const problem: ProblemDetail = {
      type: 'about:blank',
      title: 'Network error',
      status: 0,
      detail:
        networkError instanceof Error
          ? `${networkError.message}. Is the gateway running on http://localhost:8080?`
          : 'Unable to reach the gateway.',
      instance: path,
    };
    recordTrace({
      id: newUuid(),
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 0,
      durationMs,
      idempotencyKey: headers.get('Idempotency-Key') ?? undefined,
      problem,
    });
    throw new ApiError(0, problem, { retryAfter: null, wwwAuthenticate: null });
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const retryAfter = response.headers.get('Retry-After');
  const wwwAuthenticate = response.headers.get('WWW-Authenticate');
  const idempotentReplayed = response.headers.get('Idempotent-Replayed') === 'true';
  const location = response.headers.get('Location');

  const rawText = await response.text();
  let parsed: unknown = null;
  if (rawText.trim().length > 0) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { detail: rawText };
    }
  }

  if (!response.ok) {
    const problem: ProblemDetail =
      parsed && typeof parsed === 'object'
        ? (parsed as ProblemDetail)
        : {
            type: 'about:blank',
            title: response.statusText || `HTTP ${response.status}`,
            status: response.status,
            detail: rawText || `Request failed with status ${response.status}.`,
            instance: path,
          };
    recordTrace({
      id: newUuid(),
      timestamp: new Date().toISOString(),
      method,
      path,
      status: response.status,
      durationMs,
      idempotencyKey: headers.get('Idempotency-Key') ?? undefined,
      retryAfter,
      wwwAuthenticate,
      problem,
    });
    if (response.status === 401 && token && unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw new ApiError(response.status, problem, { retryAfter, wwwAuthenticate });
  }

  recordTrace({
    id: newUuid(),
    timestamp: new Date().toISOString(),
    method,
    path,
    status: response.status,
    durationMs,
    idempotencyKey: headers.get('Idempotency-Key') ?? undefined,
    idempotentReplayed,
    retryAfter,
  });

  return {
    status: response.status,
    data: parsed as T,
    headers: {
      location,
      idempotentReplayed,
      retryAfter,
      wwwAuthenticate,
    },
  };
}
