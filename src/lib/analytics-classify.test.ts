import { test } from "node:test"
import assert from "node:assert/strict"
import { classifyConnectionError } from "./analytics-classify.ts"

test("401 / unauthorized errors -> unauthorized (the known connect bug)", () => {
  assert.equal(classifyConnectionError("API Error: 401 - Unauthorized"), "unauthorized")
  assert.equal(classifyConnectionError("401"), "unauthorized")
  assert.equal(classifyConnectionError("Request failed: unauthorized"), "unauthorized")
  assert.equal(classifyConnectionError("HTTP 401 Unauthorised"), "unauthorized")
})

test("TLS / certificate errors -> tls-error", () => {
  assert.equal(classifyConnectionError("SSL handshake failed"), "tls-error")
  assert.equal(classifyConnectionError("certificate verify failed"), "tls-error")
  assert.equal(classifyConnectionError("TLS connection error"), "tls-error")
})

test("timeouts -> timeout", () => {
  assert.equal(classifyConnectionError("timeout after 8000ms"), "timeout")
  assert.equal(classifyConnectionError("Connection timed out"), "timeout")
})

test("network-level failures -> server-unreachable", () => {
  assert.equal(classifyConnectionError("Network request failed"), "server-unreachable")
  assert.equal(classifyConnectionError("connect ECONNREFUSED 192.0.2.1:4096"), "server-unreachable")
  assert.equal(classifyConnectionError("host unreachable"), "server-unreachable")
  assert.equal(classifyConnectionError("fetch failed"), "server-unreachable")
})

test("URL parse failures -> malformed-url", () => {
  assert.equal(classifyConnectionError("Malformed URL"), "malformed-url")
  assert.equal(classifyConnectionError("Invalid URL: htp:/oops"), "malformed-url")
})

test("anything else (or missing) -> unknown", () => {
  assert.equal(classifyConnectionError("some new error"), "unknown")
  assert.equal(classifyConnectionError(""), "unknown")
  assert.equal(classifyConnectionError(undefined), "unknown")
})

test("classification is case-insensitive", () => {
  assert.equal(classifyConnectionError("UNAUTHORIZED"), "unauthorized")
  assert.equal(classifyConnectionError("TIMEOUT"), "timeout")
})

test("precedence: 401 wins over other matches in a combined message", () => {
  // A 401 behind a TLS proxy should surface as auth, the actionable bucket.
  assert.equal(classifyConnectionError("401 Unauthorized (tls terminated)"), "unauthorized")
})
