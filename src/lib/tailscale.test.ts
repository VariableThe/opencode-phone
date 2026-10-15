import { test } from "node:test"
import assert from "node:assert/strict"
import {
  fetchTailscaleDevices,
  mapTailscaleDevice,
  mapTailscaleDevices,
  TAILSCALE_DEVICES_URL,
} from "./tailscale.ts"

// Mapping -----------------------------------------------------------------

const NOW = Date.parse("2026-10-14T12:00:00Z")

test("device with IPv4 prefers the 100.x address for the URL", () => {
  const candidate = mapTailscaleDevice(
    {
      hostname: "mymac",
      name: "mymac.tail1234.ts.net",
      addresses: ["100.64.0.5", "fd7a:115c::1"],
      lastSeen: "2026-10-14T11:59:00Z",
    },
    "4096",
    NOW,
  )
  assert.equal(candidate?.name, "mymac")
  assert.equal(candidate?.dnsName, "mymac.tail1234.ts.net")
  assert.equal(candidate?.address, "100.64.0.5")
  assert.equal(candidate?.url, "http://100.64.0.5:4096")
  assert.equal(candidate?.online, true)
})

test("device without addresses falls back to the MagicDNS name", () => {
  const candidate = mapTailscaleDevice({ hostname: "nas", name: "nas.tail1234.ts.net" }, "4096", NOW)
  assert.equal(candidate?.address, "nas.tail1234.ts.net")
  assert.equal(candidate?.url, "http://nas.tail1234.ts.net:4096")
  assert.equal(candidate?.online, null)
})

test("stale lastSeen maps to offline, missing lastSeen to unknown", () => {
  const stale = mapTailscaleDevice({ hostname: "old", lastSeen: "2026-10-14T10:00:00Z" }, "4096", NOW)
  assert.equal(stale?.online, false)
  const unknown = mapTailscaleDevice({ hostname: "new" }, "4096", NOW)
  assert.equal(unknown?.online, null)
})

test("device with neither hostname nor name maps to null", () => {
  assert.equal(mapTailscaleDevice({ addresses: ["100.64.0.9"] }, "4096", NOW), null)
  assert.equal(mapTailscaleDevice({}, "4096", NOW), null)
})

test("hostname falls back to the first DNS label when hostname is missing", () => {
  const candidate = mapTailscaleDevice({ name: "printer.tail1234.ts.net" }, "4096", NOW)
  assert.equal(candidate?.name, "printer")
})

test("mapTailscaleDevices skips unmappable entries", () => {
  const out = mapTailscaleDevices([{ hostname: "a" }, {}, { hostname: "b" }], "4096", NOW)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((c) => c.name), ["a", "b"])
})

// Fetch + error mapping ----------------------------------------------------

function stubFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as typeof fetch
}

test("401 maps to unauthorized (invalid token)", async () => {
  let seenUrl = ""
  let seenAuth = ""
  const fetchFn = (async (url: unknown, init: unknown) => {
    seenUrl = String(url)
    seenAuth = (init as { headers: Record<string, string> }).headers.Authorization
    return { status: 401, ok: false, json: async () => ({}) }
  }) as typeof fetch
  const result = await fetchTailscaleDevices("bad-token", fetchFn)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.kind, "unauthorized")
  assert.equal(seenUrl, TAILSCALE_DEVICES_URL)
  assert.ok(seenAuth.startsWith("Basic "), "token travels as Basic auth")
  assert.ok(!seenAuth.includes("bad-token"), "raw token must not appear in the header value as-is")
})

test("200 with devices returns them", async () => {
  const result = await fetchTailscaleDevices("good", stubFetch(200, { devices: [{ hostname: "a" }] }))
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.devices, [{ hostname: "a" }])
})

test("200 with a missing devices array returns an empty list (not a crash)", async () => {
  const result = await fetchTailscaleDevices("good", stubFetch(200, {}))
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.devices, [])
})

test("network failure maps to network (distinct from auth failure)", async () => {
  const failing = (async () => {
    throw new Error("fetch failed")
  }) as typeof fetch
  const result = await fetchTailscaleDevices("good", failing)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.kind, "network")
})

test("500 maps to unexpected with the status attached", async () => {
  const result = await fetchTailscaleDevices("good", stubFetch(500, { error: "boom" }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.kind, "unexpected")
    assert.equal(result.status, 500)
  }
})
