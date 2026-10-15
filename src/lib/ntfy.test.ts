import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseNtfyLine,
  parseNtfyObject,
  buildTestPublishBody,
  categoryForType,
  NtfySubscriber,
  type NtfyNotification,
} from "./ntfy.ts"

// Parser contract is fixed by oc-notify/src/payload.ts (NotifyType +
// NotifyEnvelope merged as extra top-level fields on the ntfy publish body).

const BASE = {
  id: "abc123",
  time: 1760486400,
  event: "message",
  topic: "oc-phone",
  priority: 4,
  tags: ["lock", "opencode"],
}

test("parses a permission message with the full oc-notify envelope", () => {
  const line = JSON.stringify({
    ...BASE,
    message: "edit: src/lib/foo.ts",
    title: "[workstation] Permission needed",
    type: "permission",
    server: "workstation",
    sessionID: "ses_abc123",
    at: "2026-10-14T10:00:00.000Z",
  })
  assert.deepEqual(parseNtfyLine(line), {
    type: "permission",
    title: "[workstation] Permission needed",
    body: "edit: src/lib/foo.ts",
    sessionID: "ses_abc123",
    server: "workstation",
    at: "2026-10-14T10:00:00.000Z",
    ntfyId: "abc123",
    time: 1760486400,
  })
})

test("ignores ntfy open and keepalive event lines", () => {
  assert.equal(parseNtfyLine(JSON.stringify({ event: "open", id: "x", time: 1, topic: "oc-phone" })), null)
  assert.equal(parseNtfyLine(JSON.stringify({ event: "keepalive", id: "y", time: 2, topic: "oc-phone" })), null)
})

test("returns null for malformed JSON and blank lines", () => {
  assert.equal(parseNtfyLine("not json{"), null)
  assert.equal(parseNtfyLine(""), null)
  assert.equal(parseNtfyLine("   \n"), null)
  assert.equal(parseNtfyLine('{"event":"message"'), null)
})

test("returns null for unknown type values", () => {
  assert.equal(parseNtfyLine(JSON.stringify({ ...BASE, type: "question", message: "hi" })), null)
  assert.equal(parseNtfyLine(JSON.stringify({ ...BASE, message: "no type at all" })), null)
  assert.equal(parseNtfyLine(JSON.stringify({ ...BASE, type: 42, message: "numeric type" })), null)
})

test("tolerates missing optional fields with safe defaults", () => {
  const parsed = parseNtfyLine(JSON.stringify({ event: "message", type: "idle" }))
  assert.ok(parsed)
  assert.equal(parsed.type, "idle")
  assert.equal(parsed.title, "Turn finished")
  assert.equal(parsed.body, "Turn finished")
  assert.equal(parsed.sessionID, "")
  assert.equal(parsed.server, "")
  assert.equal(parsed.at, "")
  assert.equal(parsed.ntfyId, "")
  assert.equal(parsed.time, 0)
})

test("falls back per-type when title/message are empty or missing", () => {
  const err = parseNtfyLine(JSON.stringify({ event: "message", type: "error", message: "   " }))
  assert.ok(err)
  assert.equal(err.body, "Session error")
  assert.equal(err.title, "Session error")
})

test("sanitizes control characters out of title and body", () => {
  const parsed = parseNtfyLine(JSON.stringify({ ...BASE, type: "error", title: "a\nb", message: "x\x00y\x7fz" }))
  assert.ok(parsed)
  assert.equal(parsed.title, "a b")
  assert.equal(parsed.body, "x y z")
})

test("rejects non-object JSON values", () => {
  assert.equal(parseNtfyLine("[1,2,3]"), null)
  assert.equal(parseNtfyLine('"just a string"'), null)
  assert.equal(parseNtfyLine("42"), null)
  assert.equal(parseNtfyLine("null"), null)
  assert.equal(parseNtfyObject(undefined), null)
  assert.equal(parseNtfyObject(null), null)
})

test("caps body length like notify-format sanitizeBody", () => {
  const parsed = parseNtfyLine(JSON.stringify({ ...BASE, type: "idle", message: "z".repeat(500) }))
  assert.ok(parsed)
  assert.equal(parsed.body.length, 200)
})

test("falls back to an envelope JSON-encoded inside the message string", () => {
  // Stock ntfy drops unknown top-level publish fields (live-probed), so a
  // publisher that embeds the envelope in `message` must still parse.
  const embedded = JSON.stringify({
    type: "permission",
    server: "workstation",
    sessionID: "ses_emb1",
    title: "[workstation] Permission needed",
    message: "write: /tmp/x",
    at: "2026-10-14T12:02:00.000Z",
  })
  const line = JSON.stringify({ id: "e1", time: 1760486500, event: "message", topic: "oc-phone", message: embedded })
  const parsed = parseNtfyLine(line)
  assert.ok(parsed)
  assert.equal(parsed.type, "permission")
  assert.equal(parsed.body, "write: /tmp/x")
  assert.equal(parsed.sessionID, "ses_emb1")
  assert.equal(parsed.ntfyId, "e1")
})

test("top-level envelope fields win over the embedded fallback", () => {
  const embedded = JSON.stringify({ type: "idle", sessionID: "ses_inner" })
  const line = JSON.stringify({ event: "message", type: "error", sessionID: "ses_outer", message: embedded })
  const parsed = parseNtfyLine(line)
  assert.ok(parsed)
  assert.equal(parsed.type, "error")
  assert.equal(parsed.sessionID, "ses_outer")
})

test("embedded fallback rejects non-envelope JSON message content", () => {
  assert.equal(parseNtfyLine(JSON.stringify({ event: "message", message: '{"foo":1}' })), null)
  assert.equal(parseNtfyLine(JSON.stringify({ event: "message", message: "[1,2]" })), null)
})

test("categoryForType reuses the existing notification categories", () => {
  assert.equal(categoryForType("permission"), "permissions")
  assert.equal(categoryForType("idle"), "completed")
  assert.equal(categoryForType("error"), "errors")
})

test("self-test publish body survives ntfy stripping unknown top-level fields", () => {
  // Regression: the settings test button once published a plain-text
  // `message` with the envelope only as top-level fields; ntfy stripped
  // them, parseNtfyObject returned null, and the round trip always timed
  // out. Simulate the server read-back by deleting the unknown fields.
  const sent = buildTestPublishBody("oc-phone", "2026-10-14T12:00:00.000Z")
  const readBack = { ...sent, id: "srv1", time: 1760443200, event: "message" }
  delete readBack.type
  delete readBack.server
  delete readBack.sessionID
  delete readBack.at
  const parsed = parseNtfyObject(readBack)
  assert.ok(parsed)
  assert.equal(parsed.type, "idle")
  assert.equal(parsed.title, "[phone] Test notification")
  assert.equal(parsed.ntfyId, "srv1")
})

// --- Subscriber (fetch is injected; no timers leak past sub.stop()) ---

function msg(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    time: Math.floor(Date.now() / 1000),
    event: "message",
    topic: "oc-phone",
    message: "hello",
    title: "t",
    type: "idle",
    server: "ws",
    sessionID: "ses_1",
    at: new Date().toISOString(),
    ...over,
  }
}

function stubFetch(responses: Array<{ ok: boolean; status?: number; text: string }>, urls: string[]) {
  let i = 0
  return async (url: string): Promise<Response> => {
    urls.push(url)
    const r = responses[Math.min(i++, responses.length - 1)]
    return { ok: r.ok, status: r.status ?? 200, text: async () => r.text } as Response
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test("delivers fresh messages and passes since= on the next poll", async () => {
  const urls: string[] = []
  const got: NtfyNotification[] = []
  const fetchImpl = stubFetch(
    [{ ok: true, text: `${JSON.stringify(msg({ id: "m1" }))}\n` }, { ok: true, text: "" }],
    urls,
  ) as unknown as typeof fetch
  const sub = new NtfySubscriber((n) => got.push(n), { fetchImpl, pollIntervalMs: 20 })
  sub.update({ baseUrl: "http://x:2586", topic: "oc-phone" })
  await sleep(80)
  sub.stop()
  assert.equal(got.length, 1)
  assert.equal(got[0].ntfyId, "m1")
  assert.equal(got[0].type, "idle")
  assert.ok(!urls[0].includes("since="), `first poll has no since: ${urls[0]}`)
  assert.ok(urls.some((u) => u.includes("since=m1")), `expected since=m1 in ${JSON.stringify(urls)}`)
})

test("does not redeliver the same ntfy id across polls", async () => {
  const urls: string[] = []
  const got: NtfyNotification[] = []
  // Server keeps returning m1 (e.g. since unsupported) — dedupe must hold.
  const fetchImpl = stubFetch([{ ok: true, text: `${JSON.stringify(msg({ id: "m1" }))}\n` }], urls) as unknown as typeof fetch
  const sub = new NtfySubscriber((n) => got.push(n), { fetchImpl, pollIntervalMs: 15 })
  sub.update({ baseUrl: "http://x:2586", topic: "oc-phone" })
  await sleep(90)
  sub.stop()
  assert.equal(got.length, 1)
})

test("suppresses stale cache history on start but delivers fresh messages", async () => {
  const got: NtfyNotification[] = []
  const old = msg({ id: "old", time: Math.floor(Date.now() / 1000) - 3600 })
  const fresh = msg({ id: "new", time: Math.floor(Date.now() / 1000) })
  const fetchImpl = (async (): Promise<Response> =>
    ({ ok: true, status: 200, text: async () => `${JSON.stringify(old)}\n${JSON.stringify(fresh)}\n` }) as Response) as unknown as typeof fetch
  const sub = new NtfySubscriber((n) => got.push(n), { fetchImpl, pollIntervalMs: 10_000 })
  sub.update({ baseUrl: "http://x:2586", topic: "oc-phone" })
  await sleep(60)
  sub.stop()
  assert.deepEqual(got.map((n) => n.ntfyId), ["new"])
})

test("backs off and recovers after a failed poll", async () => {
  const got: NtfyNotification[] = []
  const fetchImpl = stubFetch(
    [
      { ok: false, status: 500, text: "err" },
      { ok: true, text: `${JSON.stringify(msg({ id: "m9" }))}\n` },
    ],
    [],
  ) as unknown as typeof fetch
  const sub = new NtfySubscriber((n) => got.push(n), { fetchImpl, pollIntervalMs: 15, backoffMs: [10] })
  sub.update({ baseUrl: "http://x:2586", topic: "oc-phone" })
  await sleep(120)
  sub.stop()
  assert.equal(got.length, 1)
  assert.equal(got[0].ntfyId, "m9")
})

test("update(null) stops polling; retargeting resets dedupe state", async () => {
  const urls: string[] = []
  const got: NtfyNotification[] = []
  const fetchImpl = stubFetch([{ ok: true, text: `${JSON.stringify(msg({ id: "m1" }))}\n` }], urls) as unknown as typeof fetch
  const sub = new NtfySubscriber((n) => got.push(n), { fetchImpl, pollIntervalMs: 15 })
  sub.update({ baseUrl: "http://x:2586", topic: "oc-phone" })
  await sleep(40)
  sub.update(null)
  assert.equal(sub.running, false)
  const countAfterStop = urls.length
  await sleep(50)
  assert.equal(urls.length, countAfterStop)
  // Retarget: same id must be delivered again (new topic, fresh state).
  sub.update({ baseUrl: "http://x:2586", topic: "other" })
  await sleep(60)
  sub.stop()
  assert.equal(got.length, 2)
})

test("overlapping reconnectNow does not fork a second poll chain", async () => {
  // Regression pin for the double "[ntfy] Poll ok" per interval: when
  // reconnectNow()/update() overlap an in-flight fetch whose abort is
  // ignored, the late-resolving poll must not schedule its own chain. The
  // stub fetch below ignores the abort signal on purpose and gates every
  // poll behind a manually released promise, so the poll count is exact.
  let calls = 0
  const pending: Array<() => void> = []
  const fetchImpl = (async (): Promise<Response> => {
    calls += 1
    await new Promise<void>((resolve) => pending.push(resolve))
    return { ok: true, status: 200, text: async () => "" } as Response
  }) as unknown as typeof fetch
  const sub = new NtfySubscriber(() => {}, { fetchImpl, pollIntervalMs: 10 })
  sub.update({ baseUrl: "http://x:2586", topic: "oc-phone" })
  await sleep(20)
  assert.equal(calls, 1)
  sub.reconnectNow()
  await sleep(20)
  assert.equal(calls, 2)
  assert.equal(pending.length, 2)
  // Release both generations; only the newest may continue polling.
  pending[0]()
  await sleep(20)
  pending[1]()
  await sleep(60)
  sub.stop()
  // Exactly one follow-up poll (the surviving chain) — a forked second chain
  // would have produced one more.
  assert.equal(calls, 3)
})
