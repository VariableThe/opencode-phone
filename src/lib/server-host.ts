// Normalize MagicDNS hostnames / Tailscale IPs / pasted URLs into opencode
// server URLs. Pure (no RN/expo deps) so it is unit-testable with plain
// `node --test` — same pattern as diagnostics-classify.ts.
//
// Why this exists: the add/edit connection forms used to accept only full
// URLs (advanced mode) or IP-shaped input (quick mode). On a tailnet the
// natural identifier is a MagicDNS name (`mymac`, `mymac.tail123.ts.net`)
// or a 100.x address, so bare hosts normalize to `http://<host>:4096` here
// and every form shares the one implementation instead of each parsing ad hoc.

export const DEFAULT_OPENCODE_PORT = "4096"

const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

function stripSuffix(raw: string): string {
  return raw.split("/")[0].split("?")[0].split("#")[0].trim()
}

// Normalize bare-host input (no scheme): `mymac`, `mymac.tail.ts.net`,
// `100.64.0.5`, each optionally with `:port`. Returns null when the input
// is not a recognizable host.
export function normalizeServerHost(input: string, fallbackPort: string = DEFAULT_OPENCODE_PORT): string | null {
  const raw = input.trim()
  if (!raw) return null

  // Full URL with scheme: keep the scheme, keep an explicit port, otherwise
  // apply the fallback (quick-connect semantics: the port field wins when
  // the pasted value carries none).
  const schemeMatch = raw.match(SCHEME_RE)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== "http" && scheme !== "https") return null
    const rest = stripSuffix(raw.slice(schemeMatch[0].length))
    if (!rest || /\s/.test(rest) || !HOST_RE.test(rest.split(":")[0])) return null
    const hostport = rest
    const last = hostport.lastIndexOf(":")
    if (last > -1 && /^\d+$/.test(hostport.slice(last + 1))) {
      const host = hostport.slice(0, last)
      if (!HOST_RE.test(host)) return null
      return `${scheme}://${host}:${hostport.slice(last + 1)}`
    }
    if (hostport.includes(":")) return null // IPv6 / malformed — refuse to guess
    return `${scheme}://${hostport}:${fallbackPort || DEFAULT_OPENCODE_PORT}`
  }

  // Bare host: drop any path/query, then split an optional :port.
  const hostport = stripSuffix(raw)
  if (!hostport || /\s/.test(hostport)) return null
  let host = hostport
  let port = ""
  const last = hostport.lastIndexOf(":")
  if (last > -1 && /^\d+$/.test(hostport.slice(last + 1))) {
    host = hostport.slice(0, last)
    port = hostport.slice(last + 1)
  }
  if (!host || host.includes(":")) return null
  if (!HOST_RE.test(host) && !IPV4_RE.test(host)) return null
  return `http://${host}:${port || fallbackPort || DEFAULT_OPENCODE_PORT}`
}

// Normalize anything the server-URL field accepts: a full URL passes
// through untouched (minus trailing slashes — the sdk strips them anyway),
// a bare MagicDNS/IP host upgrades to `http://<host>:4096`. Null means
// "not an address at all" and the caller should show its invalid-URL copy.
export function normalizeServerUrl(input: string, fallbackPort: string = DEFAULT_OPENCODE_PORT): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (SCHEME_RE.test(raw)) {
    const host = stripSuffix(raw.replace(SCHEME_RE, ""))
    if (!host || /\s/.test(host)) return null
    return raw.replace(/\/+$/, "")
  }
  return normalizeServerHost(raw, fallbackPort)
}
