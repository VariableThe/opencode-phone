import { test } from "node:test"
import assert from "node:assert/strict"
import { encodeConnectLink, missingSecrets, parseConnectLink, type ConnectPayload } from "./connect-link.ts"

// parseConnectLink ----------------------------------------------------------

const FULL: ConnectPayload = {
  v: 1,
  name: "asus-zorin",
  url: "http://100.96.42.5:4096",
  username: "opencode",
  password: "SECRET-PW",
  bridgeUrl: "http://100.96.42.5:8787",
  bridgeToken: "SECRET-TOKEN",
  defaultProjectDir: "/home/aditya/Projects",
}

const NO_SECRETS: ConnectPayload = {
  v: 1,
  name: "asus-zorin",
  url: "http://100.96.42.5:4096",
  username: "opencode",
  bridgeUrl: "http://100.96.42.5:8787",
  defaultProjectDir: "/home/aditya/Projects",
}

test("valid full payload round-trips exactly", () => {
  const result = parseConnectLink(encodeConnectLink(FULL))
  assert.equal(result.ok, true)
  assert.deepEqual(result.payload, FULL)
})

test("--no-secrets payload has absent keys and parses", () => {
  const uri = encodeConnectLink(NO_SECRETS)
  assert.ok(!uri.includes("password"))
  assert.ok(!uri.includes("bridgeToken"))
  const result = parseConnectLink(uri)
  assert.equal(result.ok, true)
  assert.ok(!("password" in result.payload))
  assert.ok(!("bridgeToken" in result.payload))
  assert.deepEqual(missingSecrets(result.payload), ["password", "bridgeToken"])
})

test("full payload needs no secrets", () => {
  const result = parseConnectLink(encodeConnectLink(FULL))
  assert.equal(result.ok, true)
  assert.deepEqual(missingSecrets(result.payload), [])
})

test("encoder emits unpadded base64url (no + / = in d)", () => {
  const tricky: ConnectPayload = { ...FULL, name: "üñí ☃ test", defaultProjectDir: "/home/a b/c" }
  const uri = encodeConnectLink(tricky)
  const d = new URL(uri).searchParams.get("d") as string
  assert.ok(!/[+/=]/.test(d))
  const result = parseConnectLink(uri)
  assert.equal(result.ok, true)
  assert.deepEqual(result.payload, tricky)
})

test("base64url re-padding: payloads of every residue length decode", () => {
  // Varying the name length sweeps the encoded length across all d.length % 4
  // residues (0 needs no pad, 2 needs ==, 3 needs =), pinning the re-pad path.
  const seen = new Set<number>()
  for (let pad = 0; pad < 12; pad += 1) {
    const candidate: ConnectPayload = { ...FULL, name: `host-${"x".repeat(pad)}` }
    const d = new URL(encodeConnectLink(candidate)).searchParams.get("d") as string
    seen.add(d.length % 4)
    const result = parseConnectLink(encodeConnectLink(candidate))
    assert.equal(result.ok, true)
    assert.equal(result.payload.name, candidate.name)
  }
  assert.ok(seen.has(0) && seen.has(2) && seen.has(3))
})

test("wrong scheme is rejected", () => {
  const uri = encodeConnectLink(FULL).replace("ocphone://", "https://")
  const result = parseConnectLink(uri)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "scheme")
})

test("wrong host is rejected", () => {
  const uri = encodeConnectLink(FULL).replace("ocphone://connect", "ocphone://pair")
  const result = parseConnectLink(uri)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "host")
})

test("query v mismatch is rejected", () => {
  const uri = encodeConnectLink(FULL).replace("?v=1&", "?v=2&")
  const result = parseConnectLink(uri)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "version")
})

test("missing d is rejected", () => {
  const result = parseConnectLink("ocphone://connect?v=1")
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "missing-d")
})

test("malformed base64 (padded / std alphabet / garbage) is rejected", () => {
  for (const bad of ["ocphone://connect?v=1&d=AAAA====", "ocphone://connect?v=1&d=AB+C/D", "ocphone://connect?v=1&d=!!!"]) {
    const result = parseConnectLink(bad)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, "bad-encoding")
  }
})

test("d decoding to non-JSON is rejected", () => {
  // "bm90LWpzb24=" is base64("not-json") — re-encoded here as unpadded base64url.
  const result = parseConnectLink("ocphone://connect?v=1&d=bm90LWpzb24")
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "bad-json")
})

test("JSON v mismatch is rejected", () => {
  const tampered = { ...FULL, v: 2 }
  const uri = encodeConnectLink(FULL).replace(/d=.*$/, `d=${tamperedD(tampered)}`)
  const result = parseConnectLink(uri)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "payload-version")
})

function tamperedD(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

test("missing url is rejected", () => {
  const { url: _drop, ...rest } = FULL
  const result = parseConnectLink(encodeWithRaw(rest))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "missing-field")
  assert.equal(result.error.field, "url")
})

test("non-http url is rejected", () => {
  const result = parseConnectLink(encodeWithRaw({ ...FULL, url: "ftp://host:21" }))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "bad-url")
})

test("non-string fields are rejected", () => {
  const result = parseConnectLink(encodeWithRaw({ ...FULL, url: 4096 }))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "bad-field")
  assert.equal(result.error.field, "url")
})

test("non-string secret fields are rejected", () => {
  const result = parseConnectLink(encodeWithRaw({ ...FULL, password: 123 }))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "bad-field")
  assert.equal(result.error.field, "password")
})

function encodeWithRaw(obj: unknown): string {
  const d = Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `ocphone://connect?v=1&d=${d}`
}

test("empty input and garbage are rejected", () => {
  const empty = parseConnectLink("   ")
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, "empty")
  const garbage = parseConnectLink("not a link at all :::")
  assert.equal(garbage.ok, false)
  assert.equal(garbage.error.code, "malformed-uri")
})

test("surrounding whitespace is tolerated", () => {
  const result = parseConnectLink(`  ${encodeConnectLink(FULL)}\n`)
  assert.equal(result.ok, true)
  assert.deepEqual(result.payload, FULL)
})
