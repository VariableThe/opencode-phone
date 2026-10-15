// Pure URL/string scrubbing utilities — no React Native or Sentry deps.
// Extracted here so they can be unit-tested with plain `node --test`.

// Strip basic-auth credentials and any `?token=` style query secrets so URLs
// can be safely sent or logged.
export function scrubUrl(url: string): string {
  return url
    .replace(/\/\/[^@/]+@/, "//<redacted>@")
    .replace(/([?&](?:token|access_token|api_key|key|password|pwd|auth)=)[^&#]*/gi, "$1<redacted>")
}

export function scrubString(s: string): string {
  // Catch any embedded URL inside a free-text string (error messages often
  // contain them, e.g. "fetch failed: https://user:pw@host/...").
  // Tailscale API keys (`tskey-api-…`) are bearer credentials that never
  // appear inside a URL, so redact the recognizable prefix shape too.
  return s
    .replace(/https?:\/\/\S+/g, (m) => scrubUrl(m))
    .replace(/\btskey-[A-Za-z0-9_-]+/g, "tskey-<redacted>")
}

// Redact exact secret values (e.g. a pasted Tailscale API token) from text
// that may be logged or shared. scrubString only redacts secrets embedded
// in URLs or matching a known prefix shape; a bare opaque token in an error
// message would otherwise pass through untouched.
export function redactSecrets(text: string, secrets: Array<string | undefined | null>): string {
  let out = text
  for (const secret of secrets) {
    if (!secret || !secret.trim()) continue
    out = out.split(secret).join("<redacted>")
  }
  return out
}

// Harder redaction for text that leaves the device (support inbox): drop
// every URL wholesale, erase every known server host (bare `host=…` fragments
// and log lines carry hosts without a scheme, which the URL regex misses),
// and blank bare IPv4 addresses as a catch-all for hosts we never parsed.
export function redactHostAndUrls(text: string, hosts?: Array<string | undefined>): string {
  let out = text.replace(/https?:\/\/[^\s)\]}"']+/gi, "<redacted-url>")
  for (const host of hosts ?? []) {
    if (host) out = out.split(host).join("<redacted-host>")
  }
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<redacted-ip>")
  return out
}

export function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = scrubString(v)
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = scrubObject(v as Record<string, unknown>)
    else out[k] = v
  }
  return out
}
