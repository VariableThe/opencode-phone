// Pure connection-failure classification for analytics, extracted from
// analytics.ts (which imports posthog/expo) so it is unit-testable under
// plain `node --test` — same pattern as diagnostics-classify.ts and
// store-review-policy.ts.

/** Coarse, non-identifying failure buckets — never include the raw error string
 *  (it may embed hostnames/tokens/paths). Reuses the vocabulary already
 *  established by diagnostics-classify.ts's Classification type. */
export type ConnectionErrorClass =
  | "malformed-url"
  | "no-internet"
  | "server-unreachable"
  | "unauthorized"
  | "tls-error"
  | "timeout"
  | "unknown"

/** Classify a connection failure into a coarse bucket without leaking the
 *  raw error message (which can contain hostnames/IPs). */
export function classifyConnectionError(message: string | undefined): ConnectionErrorClass {
  const m = (message || "").toLowerCase()
  if (/401|unauthoriz/.test(m)) return "unauthorized"
  if (/ssl|tls|certificate|handshake/.test(m)) return "tls-error"
  if (/timeout|timed out/.test(m)) return "timeout"
  if (/network request failed|unreachable|econnrefused|fetch failed/.test(m)) return "server-unreachable"
  if (/malformed|invalid url/.test(m)) return "malformed-url"
  return "unknown"
}
