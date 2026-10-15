import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Extract the bearer token from an Authorization header.
 * Returns null when the header is missing or not a `Bearer <token>` value.
 * The scheme match is case-insensitive per RFC 9110; the token itself is
 * compared exactly (case-sensitive) by the caller.
 */
export function getBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const m = /^bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!m) return null;
  const token = (m[1] ?? '').trim();
  return token.length > 0 ? token : null;
}

/**
 * Constant-time string comparison. Both inputs are hashed with SHA-256 first
 * so comparison time does not leak the expected token's length or prefix —
 * a naive timingSafeEqual would throw/return early on length mismatch.
 */
export function tokensEqual(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * True only when the Authorization header carries the exact expected token.
 * Never throws; any malformed input simply yields false (caller maps to 401).
 */
export function isAuthorized(
  authorizationHeader: string | null | undefined,
  expectedToken: string,
): boolean {
  const provided = getBearerToken(authorizationHeader);
  if (provided === null) return false;
  return tokensEqual(provided, expectedToken);
}
