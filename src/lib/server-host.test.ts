import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeServerHost, normalizeServerUrl } from "./server-host.ts"

// normalizeServerHost -----------------------------------------------------

test("bare IPv4 defaults to http + 4096", () => {
  assert.equal(normalizeServerHost("192.168.1.100"), "http://192.168.1.100:4096")
})

test("bare 100.x address with explicit port keeps it", () => {
  assert.equal(normalizeServerHost("100.64.0.5:5000"), "http://100.64.0.5:5000")
})

test("short MagicDNS name normalizes", () => {
  assert.equal(normalizeServerHost("mymac"), "http://mymac:4096")
})

test("full MagicDNS name normalizes", () => {
  assert.equal(normalizeServerHost("mymac.tail1234.ts.net"), "http://mymac.tail1234.ts.net:4096")
})

test("full URL keeps scheme and explicit port, drops path", () => {
  assert.equal(normalizeServerHost("http://192.168.1.100:4096/some/path?x=1"), "http://192.168.1.100:4096")
})

test("https URL without port keeps https and applies the fallback port", () => {
  assert.equal(normalizeServerHost("https://mymac.tail1234.ts.net", "8443"), "https://mymac.tail1234.ts.net:8443")
})

test("http URL without port applies the caller's fallback port (quick-connect port field)", () => {
  assert.equal(normalizeServerHost("http://192.168.1.5", "5000"), "http://192.168.1.5:5000")
})

test("custom fallback port applies to bare hosts", () => {
  assert.equal(normalizeServerHost("mymac", "5000"), "http://mymac:5000")
})

test("empty / whitespace input returns null", () => {
  assert.equal(normalizeServerHost(""), null)
  assert.equal(normalizeServerHost("   "), null)
})

test("input with spaces returns null", () => {
  assert.equal(normalizeServerHost("not a host"), null)
})

test("non-http scheme returns null", () => {
  assert.equal(normalizeServerHost("ftp://host:21"), null)
})

test("IPv6 literal returns null instead of garbage", () => {
  assert.equal(normalizeServerHost("::1"), null)
})

// normalizeServerUrl ------------------------------------------------------

test("full URL passes through untouched (minus trailing slash)", () => {
  assert.equal(normalizeServerUrl("https://my-tunnel.trycloudflare.com/"), "https://my-tunnel.trycloudflare.com")
  assert.equal(normalizeServerUrl("http://192.168.1.100:4096"), "http://192.168.1.100:4096")
})

test("bare hostname upgrades to http://host:4096", () => {
  assert.equal(normalizeServerUrl("mymac.tail1234.ts.net"), "http://mymac.tail1234.ts.net:4096")
  assert.equal(normalizeServerUrl("100.64.0.5"), "http://100.64.0.5:4096")
})

test("empty input returns null", () => {
  assert.equal(normalizeServerUrl(""), null)
  assert.equal(normalizeServerUrl("  "), null)
})
