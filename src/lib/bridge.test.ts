import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BRIDGE_MAX_TAIL_LINES,
  bridgeAuthHeaders,
  isBridgeAuthError,
  BridgeAuthError,
  buildBridgeUrl,
  createBridgeClient,
  normalizeBridgeSession,
  normalizeBridgeSessionList,
  type BridgeFetch,
} from "./bridge.ts"

// The bridge client speaks a Bearer-auth REST contract (oc-phone-bridge
// repo). A bug here either leaks the token shape (wrong header), hits the
// wrong URL (trailing-slash doubling, as seen in sdk.ts), or misclassifies
// auth failures — so URL/auth/error rules are pinned.

test("buildBridgeUrl: joins base and path without double slashes", () => {
  assert.equal(buildBridgeUrl("http://host:8787", "/tmux"), "http://host:8787/tmux")
  assert.equal(buildBridgeUrl("http://host:8787/", "/tmux"), "http://host:8787/tmux")
  assert.equal(buildBridgeUrl("http://host:8787///", "tmux"), "http://host:8787/tmux")
})

test("buildBridgeUrl: leaves a bare base URL untouched", () => {
  assert.equal(buildBridgeUrl("http://host:8787", "/health"), "http://host:8787/health")
})

test("bridgeAuthHeaders: sends the token as Bearer", () => {
  const token = "a".repeat(32)
  assert.deepEqual(bridgeAuthHeaders(token), { Authorization: `Bearer ${token}` })
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response): BridgeFetch {
  return async (url: string, init?: RequestInit) => handler(url, init)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

test("client sends Bearer auth header on list", async () => {
  const token = "t".repeat(32)
  let seen = ""
  const client = createBridgeClient(
    { baseUrl: "http://host:8787/", token },
    stubFetch((url, init) => {
      seen = (init?.headers as Record<string, string>)["Authorization"] ?? ""
      assert.equal(url, "http://host:8787/tmux")
      return jsonResponse({ sessions: [] })
    }),
  )
  assert.deepEqual(await client.list(), [])
  assert.equal(seen, `Bearer ${token}`)
})

test("401 maps to BridgeAuthError, 500 maps to a plain BridgeError", async () => {
  const unauth = createBridgeClient({ baseUrl: "http://h", token: "x".repeat(32) }, stubFetch(() => jsonResponse({ error: "bad token", code: "UNAUTHORIZED" }, 401)))
  await assert.rejects(
    () => unauth.list(),
    (err: unknown) => err instanceof BridgeAuthError && isBridgeAuthError(err) && err.status === 401,
  )

  const broken = createBridgeClient({ baseUrl: "http://h", token: "x".repeat(32) }, stubFetch(() => jsonResponse({ error: "boom", code: "INTERNAL" }, 500)))
  await assert.rejects(
    () => broken.list(),
    (err: unknown) => err instanceof Error && !isBridgeAuthError(err),
  )
})

test("create POSTs name/dir/cmd as JSON and returns the session name", async () => {
  let method = ""
  let body = ""
  const client = createBridgeClient(
    { baseUrl: "http://h", token: "x".repeat(32) },
    stubFetch((_url, init) => {
      method = init?.method ?? ""
      body = String(init?.body ?? "")
      return jsonResponse({ name: "dev" }, 201)
    }),
  )
  assert.equal(await client.create({ name: "dev", dir: "/home/u", cmd: "opencode" }), "dev")
  assert.equal(method, "POST")
  assert.deepEqual(JSON.parse(body), { name: "dev", dir: "/home/u", cmd: "opencode" })
})

test("create omits dir/cmd when not provided", async () => {
  let body = ""
  const client = createBridgeClient(
    { baseUrl: "http://h", token: "x".repeat(32) },
    stubFetch((_url, init) => {
      body = String(init?.body ?? "")
      return jsonResponse({ name: "dev" }, 201)
    }),
  )
  await client.create({ name: "dev" })
  assert.deepEqual(JSON.parse(body), { name: "dev" })
})

test("kill DELETEs the encoded session name", async () => {
  let method = ""
  let url = ""
  const client = createBridgeClient(
    { baseUrl: "http://h", token: "x".repeat(32) },
    stubFetch((u, init) => {
      method = init?.method ?? ""
      url = u
      return jsonResponse({ name: "dev" })
    }),
  )
  assert.equal(await client.kill("dev"), "dev")
  assert.equal(method, "DELETE")
  assert.equal(url, "http://h/tmux/dev")
})

test("tail parses {output} JSON and rejects out-of-range lines", async () => {
  const client = createBridgeClient({ baseUrl: "http://h", token: "x".repeat(32) }, stubFetch((url) => {
    assert.match(url, /\/tmux\/dev\/tail\?lines=50$/)
    return jsonResponse({ name: "dev", lines: 50, output: "hello\n" })
  }))
  assert.deepEqual(await client.tail("dev", 50), { name: "dev", lines: 50, output: "hello\n" })
  await assert.rejects(() => client.tail("dev", 0), RangeError)
  await assert.rejects(() => client.tail("dev", BRIDGE_MAX_TAIL_LINES + 1), RangeError)
})

test("tail falls back to plain text when the body is not JSON", async () => {
  const client = createBridgeClient(
    { baseUrl: "http://h", token: "x".repeat(32) },
    stubFetch(() => new Response("raw pane text", { status: 200 })),
  )
  const tail = await client.tail("dev")
  assert.equal(tail.output, "raw pane text")
  assert.equal(tail.name, "dev")
})

test("normalizeBridgeSession: keeps isOpencode/paneCommand when present", () => {
  assert.deepEqual(normalizeBridgeSession({ name: "a", created: 123, paneCommand: "opencode", isOpencode: true }), {
    name: "a",
    created: 123,
    paneCommand: "opencode",
    isOpencode: true,
  })
})

test("normalizeBridgeSession: omits isOpencode when the bridge predates the field (never fabricates it)", () => {
  const session = normalizeBridgeSession({ name: "a", created: null })
  assert.ok(session)
  assert.equal(session.name, "a")
  assert.equal(session.created, null)
  assert.equal("isOpencode" in session, false)
  assert.equal("paneCommand" in session, false)
})

test("normalizeBridgeSession: drops malformed entries instead of throwing", () => {
  assert.equal(normalizeBridgeSession(null), null)
  assert.equal(normalizeBridgeSession({}), null)
  assert.equal(normalizeBridgeSession({ name: "" }), null)
  assert.equal(normalizeBridgeSession("dev"), null)
  // Non-boolean isOpencode is ignored, the session itself still parses.
  assert.deepEqual(normalizeBridgeSession({ name: "a", isOpencode: "yes" }), { name: "a", created: null })
})

test("normalizeBridgeSessionList: non-array input becomes an empty list", () => {
  assert.deepEqual(normalizeBridgeSessionList(null), [])
  assert.deepEqual(normalizeBridgeSessionList({ sessions: [] }), [])
  assert.deepEqual(normalizeBridgeSessionList([{ name: "a" }, null, { name: 42 }]), [{ name: "a", created: null }])
})
