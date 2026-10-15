// Tailscale tailnet device import. Pure: no RN/expo deps, unit-testable with
// plain `node --test` — same pattern as diagnostics-classify.ts.
//
// Background: a third-party Android app cannot enumerate the tailnet from
// the local Tailscale client, so discovery goes through the Tailscale admin
// API with a user-pasted API key or OAuth token:
//   GET https://api.tailscale.com/api/v2/tailnet/-/devices
// Basic auth with the token as the username and an empty password
// (`-u <token>:`). The response shape is `{ devices: [...] }` where each
// device carries `hostname`, `name` (full MagicDNS name, e.g.
// `mymac.tail1234.ts.net`), `addresses` (e.g. `["100.64.0.5", "fd7a::1"]`)
// and `lastSeen` (ISO timestamp). Every field is treated as optional —
// older/self-hosted control planes may omit some.

// Default opencode port. server-host.ts owns the canonical
// DEFAULT_PORT; this module keeps its own literal so it stays
// import-free and runnable under plain `node --test` (repo convention: only
// type-only cross-imports in node-tested modules).
const DEFAULT_PORT = "4096"

export const TAILSCALE_DEVICES_URL = "https://api.tailscale.com/api/v2/tailnet/-/devices"

// A device is shown as online when the control plane saw it recently. The
// API exposes no explicit online boolean, so recency of `lastSeen` is the
// signal; older than this, the device is pre-unchecked as (likely) offline
// but still importable.
export const TAILSCALE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000

export interface TailscaleDevice {
  hostname?: string
  name?: string
  addresses?: string[]
  lastSeen?: string
  [key: string]: unknown
}

export interface TailscaleDeviceCandidate {
  // Display name (device hostname, e.g. "mymac").
  name: string
  // Full MagicDNS name when the API provided one.
  dnsName?: string
  // The IP or DNS name probed for the opencode server.
  address: string
  // Normalized `http://<address>:<port>` opencode URL.
  url: string
  // True = seen recently, false = stale (likely offline), null = unknown.
  online: boolean | null
  lastSeen?: string
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

// `now` is injectable so tests stay deterministic.
export function mapTailscaleDevice(
  device: TailscaleDevice,
  port: string = DEFAULT_PORT,
  now: number = Date.now(),
): TailscaleDeviceCandidate | null {
  const name = device.hostname?.trim() || device.name?.split(".")[0]?.trim() || ""
  if (!name) return null
  const dnsName = device.name?.trim() || undefined
  // Prefer the first IPv4 (usually the 100.x tailnet address — reachable
  // whenever the tailnet is up, unlike a MagicDNS name which needs MagicDNS).
  const ipv4 = device.addresses?.find((a) => IPV4_RE.test(a.trim()))
  const address = ipv4?.trim() || dnsName || name
  let online: boolean | null = null
  if (device.lastSeen) {
    const seen = Date.parse(device.lastSeen)
    if (!Number.isNaN(seen)) online = now - seen <= TAILSCALE_ONLINE_THRESHOLD_MS
  }
  return { name, dnsName, address, url: `http://${address}:${port || DEFAULT_PORT}`, online, lastSeen: device.lastSeen }
}

export function mapTailscaleDevices(
  devices: TailscaleDevice[],
  port: string = DEFAULT_PORT,
  now: number = Date.now(),
): TailscaleDeviceCandidate[] {
  const out: TailscaleDeviceCandidate[] = []
  for (const device of devices) {
    const candidate = mapTailscaleDevice(device, port, now)
    if (candidate) out.push(candidate)
  }
  return out
}

export type TailscaleFetchFailureKind = "unauthorized" | "network" | "unexpected"

export type TailscaleFetchResult =
  | { ok: true; devices: TailscaleDevice[] }
  | { ok: false; kind: TailscaleFetchFailureKind; status?: number }

// `fetchFn` defaults to the global fetch and is injectable for tests. The
// rejection/message strings never include the token.
export async function fetchTailscaleDevices(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<TailscaleFetchResult> {
  let response: Response
  try {
    response = await fetchFn(TAILSCALE_DEVICES_URL, {
      headers: { Authorization: `Basic ${btoa(`${token}:`)}`, Accept: "application/json" },
    })
  } catch {
    return { ok: false, kind: "network" }
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: "unauthorized", status: response.status }
  if (!response.ok) return { ok: false, kind: "unexpected", status: response.status }
  const body = (await response.json().catch(() => null)) as { devices?: unknown } | null
  const devices = Array.isArray(body?.devices) ? (body.devices as TailscaleDevice[]) : []
  return { ok: true, devices }
}
