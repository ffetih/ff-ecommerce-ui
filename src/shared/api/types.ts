export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  // Catalog insufficient-stock extensions
  sku?: string;
  requested?: number;
  available?: number;
  [key: string]: unknown;
}

export interface ApiResult<T> {
  status: number;
  data: T;
  headers: {
    location: string | null;
    idempotentReplayed: boolean;
    retryAfter: string | null;
    wwwAuthenticate: string | null;
    traceId: string;
    traceparent: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail;
  readonly retryAfter: string | null;
  readonly wwwAuthenticate: string | null;
  readonly traceId?: string;

  constructor(
    status: number,
    problem: ProblemDetail,
    headers: { retryAfter: string | null; wwwAuthenticate: string | null; traceId?: string },
  ) {
    super(problem.detail || problem.title || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.retryAfter = headers.retryAfter;
    this.wwwAuthenticate = headers.wwwAuthenticate;
    this.traceId = headers.traceId;
  }
}

export interface HttpTraceEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  traceId: string;
  traceparent: string;
  idempotencyKey?: string;
  idempotentReplayed?: boolean;
  retryAfter?: string | null;
  wwwAuthenticate?: string | null;
  problem?: ProblemDetail;
}
