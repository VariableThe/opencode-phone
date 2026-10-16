import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createPtyClient,
  isPtyAuthError,
  normalizePtyList,
  normalizePtyRecord,
  PtyAuthError,
  unwrapPtyData,
  type PtyFetch,
} from "./pty.ts"

// The v2 server's native PTY API speaks a {location, data} envelope (verified
// live against 2.0.29), answers DELETE with a bodiless 204, and has no
// connect-token route. A bug here either blanks the Terminals screen (bad
// unwrap), strands a server-side shell (204 mishandled), or retries bad
// credentials forever (auth misclassified) — so envelope/error rules are pinned.

function stubFetch(handler: (url: string, init?: RequestInit) => Response): PtyFetch {
  return async (url: string, init?: RequestInit) => handler(url, init)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const RECORD = {
  id: "pty_abc123",
  title: "Terminal abc",
  command: "/usr/bin/zsh",
  args: ["-l"],
  cwd: "/home/u/proj",
  status: "running",
  pid: 8921,
}

test("list unwraps the {location, data} envelope", async () => {
  let url = ""
  const client = createPtyClient({ baseUrl: "http://host:4096/" }, stubFetch((u) => {
    url = u
    return jsonResponse({ location: { directory: "/home/u" }, data: [RECORD] })
  }))
  assert.deepEqual(await client.list(), [RECORD])
  assert.equal(url, "http://host:4096/api/pty")
})

test("list drops malformed rows but keeps the rest", async () => {
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch(() => jsonResponse({ location: {}, data: [RECORD, null, { title: "no id" }] })))
  assert.deepEqual(await client.list(), [RECORD])
})

test("create POSTs title/cwd/command and returns the record", async () => {
  let method = ""
  let body = ""
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch((_url, init) => {
    method = init?.method ?? ""
    body = String(init?.body ?? "")
    return jsonResponse({ location: {}, data: RECORD }, 201)
  }))
  assert.deepEqual(await client.create({ title: "dev", cwd: "/home/u", command: "/bin/bash" }), RECORD)
  assert.equal(method, "POST")
  assert.deepEqual(JSON.parse(body), { title: "dev", cwd: "/home/u", command: "/bin/bash" })
})

test("create with no input POSTs an empty object (server spawns a default shell)", async () => {
  let body = ""
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch((_url, init) => {
    body = String(init?.body ?? "")
    return jsonResponse({ location: {}, data: RECORD })
  }))
  await client.create()
  assert.deepEqual(JSON.parse(body), {})
})

test("get fetches the encoded id and returns the record", async () => {
  let url = ""
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch((u) => {
    url = u
    return jsonResponse({ location: {}, data: RECORD })
  }))
  assert.deepEqual(await client.get("pty_abc123"), RECORD)
  assert.equal(url, "http://h/api/pty/pty_abc123")
})

test("remove resolves on a bodiless 204 without parsing", async () => {
  let method = ""
  let url = ""
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch((u, init) => {
    method = init?.method ?? ""
    url = u
    return new Response(null, { status: 204 })
  }))
  await client.remove("pty_abc123")
  assert.equal(method, "DELETE")
  assert.equal(url, "http://h/api/pty/pty_abc123")
})

test("update PUTs the nested size body the server actually applies", async () => {
  let method = ""
  let url = ""
  let body = ""
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch((u, init) => {
    method = init?.method ?? ""
    url = u
    body = String(init?.body ?? "")
    return jsonResponse({ location: {}, data: RECORD })
  }))
  assert.deepEqual(await client.update("pty_abc123", { size: { rows: 10, cols: 40 } }), RECORD)
  assert.equal(method, "PUT")
  assert.equal(url, "http://h/api/pty/pty_abc123")
  assert.deepEqual(JSON.parse(body), { size: { rows: 10, cols: 40 } })
})

test("update with a title sends the title alongside size", async () => {
  let body = ""
  const client = createPtyClient({ baseUrl: "http://h" }, stubFetch((_u, init) => {
    body = String(init?.body ?? "")
    return jsonResponse({ location: {}, data: RECORD })
  }))
  await client.update("pty_x", { title: "dev", size: { rows: 24, cols: 80 } })
  assert.deepEqual(JSON.parse(body), { title: "dev", size: { rows: 24, cols: 80 } })
})

test("401 maps to PtyAuthError, 500 maps to a plain PtyError", async () => {
  const unauth = createPtyClient({ baseUrl: "http://h" }, stubFetch(() => jsonResponse({ message: "unauthorized" }, 401)))
  await assert.rejects(
    () => unauth.list(),
    (err: unknown) => err instanceof PtyAuthError && isPtyAuthError(err) && err.status === 401,
  )

  const broken = createPtyClient({ baseUrl: "http://h" }, stubFetch(() => jsonResponse({ message: "boom" }, 500)))
  await assert.rejects(
    () => broken.list(),
    (err: unknown) => err instanceof Error && !isPtyAuthError(err),
  )
})

test("missing/malformed data throws instead of returning a partial shape", async () => {
  for (const body of [{ location: {} }, null, [], "ok"]) {
    const client = createPtyClient({ baseUrl: "http://h" }, stubFetch(() => jsonResponse(body)))
    await assert.rejects(() => client.list(), /malformed/)
  }
  // A non-array data payload normalizes to an empty list (same rule as the
  // bridge client: one bad payload never blanks the screen with a throw).
  const nonArray = createPtyClient({ baseUrl: "http://h" }, stubFetch(() => jsonResponse({ location: {}, data: { id: 42 } })))
  assert.deepEqual(await nonArray.list(), [])
  // ...but a malformed single record still throws, so get/create fail loudly.
  const badRecord = createPtyClient({ baseUrl: "http://h" }, stubFetch(() => jsonResponse({ location: {}, data: { id: 42 } })))
  await assert.rejects(() => badRecord.get("pty_x"), /malformed/)
  await assert.rejects(() => badRecord.create({}), /malformed/)
  assert.throws(() => unwrapPtyData({ location: {} }, "GET /api/pty"), /missing data/)
  assert.throws(() => unwrapPtyData(null, "GET /api/pty"), /malformed/)
})

test("normalizePtyRecord: a record with only an id parses (all else optional)", () => {
  assert.deepEqual(normalizePtyRecord({ id: "pty_x" }), { id: "pty_x" })
})

test("normalizePtyRecord: drops malformed entries instead of throwing", () => {
  assert.equal(normalizePtyRecord(null), null)
  assert.equal(normalizePtyRecord({}), null)
  assert.equal(normalizePtyRecord({ id: "" }), null)
  assert.equal(normalizePtyRecord({ id: 42 }), null)
  assert.equal(normalizePtyRecord("pty_x"), null)
  // Wrong-typed optionals are ignored, the record itself still parses.
  assert.deepEqual(normalizePtyRecord({ id: "pty_x", pid: "nine", args: "x", status: 7 }), { id: "pty_x" })
})

test("normalizePtyList: non-array input becomes an empty list", () => {
  assert.deepEqual(normalizePtyList(null), [])
  assert.deepEqual(normalizePtyList({ data: [] }), [])
  assert.deepEqual(normalizePtyList([{ id: "a" }, null, { id: 42 }]), [{ id: "a" }])
})
