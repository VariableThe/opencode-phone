import { test } from "node:test"
import assert from "node:assert/strict"
import {
  filterCommands,
  mergeCommandList,
  parseSlashInput,
  removeQueued,
  resolveSlash,
  upsertQueued,
  type CommandEntry,
} from "./composer-queue.ts"
import { V2EventTranslator } from "./v2-shape.ts"

const builtins: CommandEntry[] = [
  { trigger: "new", title: "New Session", type: "builtin" },
  { trigger: "model", title: "Switch Model", type: "builtin" },
  { trigger: "agent", title: "Switch Agent", type: "builtin" },
]

test("parseSlashInput splits name and args", () => {
  assert.deepEqual(parseSlashInput("/review HEAD --stat"), { name: "review", args: "HEAD --stat" })
  assert.deepEqual(parseSlashInput("/model"), { name: "model", args: "" })
  assert.deepEqual(parseSlashInput("/"), { name: "", args: "" })
  assert.equal(parseSlashInput("hello"), null)
  assert.equal(parseSlashInput(""), null)
})

test("bare slash resolves as bare", () => {
  assert.deepEqual(resolveSlash("/", ["new"], ["init"]), { kind: "bare" })
})

test("builtin shadows a colliding server command", () => {
  const out = resolveSlash("/model opus", ["model"], ["model"])
  assert.deepEqual(out, { kind: "builtin", name: "model", args: "opus" })
})

test("server command resolves with args", () => {
  const out = resolveSlash("/review HEAD", ["new"], ["review", "init"])
  assert.deepEqual(out, { kind: "server", name: "review", args: "HEAD" })
})

test("unknown command resolves as unknown", () => {
  const out = resolveSlash("/nope x", ["new"], ["init"])
  assert.deepEqual(out, { kind: "unknown", name: "nope", args: "x" })
})

test("mergeCommandList puts builtins first and drops colliding server entries", () => {
  const server: CommandEntry[] = [
    { trigger: "model", title: "model", description: "server model cmd", type: "custom" },
    { trigger: "review", title: "review", description: "review changes", type: "custom" },
  ]
  const merged = mergeCommandList(builtins, server)
  assert.deepEqual(
    merged.map((c) => c.trigger),
    ["new", "model", "agent", "review"],
  )
})

test("filterCommands matches trigger prefix or title substring", () => {
  const list = mergeCommandList(builtins, [{ trigger: "review", title: "review", description: "review changes", type: "custom" }])
  assert.deepEqual(
    filterCommands(list, "re").map((c) => c.trigger),
    ["review"],
  )
  assert.deepEqual(filterCommands(list, "").length, 4)
  assert.deepEqual(filterCommands(list, "zzz").length, 0)
})

test("queued id set upserts without duplicates and removes cleanly", () => {
  const one = upsertQueued([], "a")
  assert.deepEqual(one, ["a"])
  assert.equal(upsertQueued(one, "a"), one)
  const two = upsertQueued(one, "b")
  assert.deepEqual(two, ["a", "b"])
  assert.deepEqual(removeQueued(two, "a"), ["b"])
  assert.equal(removeQueued(two, "z"), two)
})

test("translator emits inbox.enqueued with text and inbox.delivered with the id", () => {
  const t = new V2EventTranslator()
  const enqueued = t.translate({
    type: "session.inbox.enqueued",
    data: { sessionID: "s1", inboxID: "inb_1", item: { type: "user", payload: { text: "queued hello" } } },
  })
  const tail = enqueued[enqueued.length - 1]
  assert.equal(tail.type, "inbox.enqueued")
  assert.deepEqual(tail.properties, { sessionID: "s1", inboxID: "inb_1", text: "queued hello" })
  const delivered = t.translate({ type: "session.inbox.delivered", data: { sessionID: "s1", inboxID: "inb_1" } })
  assert.deepEqual(delivered, [{ type: "inbox.delivered", properties: { sessionID: "s1", inboxID: "inb_1" } }])
})

test("translator drops inbox events missing ids instead of emitting junk", () => {
  const t = new V2EventTranslator()
  assert.deepEqual(t.translate({ type: "session.inbox.delivered", data: {} }), [])
  assert.deepEqual(t.translate({ type: "session.inbox.enqueued", data: {} }), [])
})
