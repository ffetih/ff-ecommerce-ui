export interface DecodedJwt {
  sub?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  iat?: number;
  realm_access?: {
    roles?: string[];
  };
  [key: string]: unknown;
}

/**
 * Decodes a JWT payload for display and UI role gating.
 * Signature verification is ALWAYS performed by each backend resource server (ADR-0008).
 */
export function decodeJwtPayload(token: string): DecodedJwt | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as DecodedJwt;
  } catch {
    return null;
  }
}

export function extractRoles(claims: DecodedJwt | null): string[] {
  const roles = claims?.realm_access?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
}

export function extractAudiences(claims: DecodedJwt | null): string[] {
  if (!claims?.aud) return [];
  return Array.isArray(claims.aud) ? claims.aud : [claims.aud];
}
