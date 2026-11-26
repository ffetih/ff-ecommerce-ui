export interface TraceContext {
  traceparent: string;
  traceId: string;
  spanId: string;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // W3C Trace Context forbids all-zero trace-id and parent-id values.
  if (bytes.every((b) => b === 0)) {
    bytes[byteLength - 1] = 1;
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a sampled W3C Trace Context `traceparent` header (`00-<traceId>-<spanId>-01`)
 * so browser requests, gateway spans, order outbox rows, Kafka messages, and downstream
 * services share one Jaeger trace (ADR-0011).
 */
export function generateTraceContext(): TraceContext {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    spanId,
  };
}

export function extractTraceId(traceparent: string | null | undefined): string | undefined {
  if (!traceparent) return undefined;
  const parts = traceparent.trim().split('-');
  if (parts.length !== 4) return undefined;
  const traceId = parts[1];
  return traceId && /^[0-9a-f]{32}$/i.test(traceId) ? traceId.toLowerCase() : undefined;
}
