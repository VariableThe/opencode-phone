import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeIncomingMessage, mergeIncomingPart, reconcileOptimisticParts, swapOptimisticId, mergeHistoryWithPending } from "./message-merge.ts"
import { userParts } from "./v2-shape.ts"
import type { Message, Part } from "./sdk.ts"

const msg = (id: string, role: "user" | "assistant" = "user"): Message => ({
  id,
  sessionID: "s1",
  role,
  time: { created: 1 },
})

test("appends an assistant reply that has no optimistic placeholder", () => {
  const out = mergeIncomingMessage([msg("temp-1", "user")], msg("real-a", "assistant"))
  assert.deepEqual(out.map((m) => m.id), ["temp-1", "real-a"])
})

test("replaces the single pending temp user message", () => {
  const out = mergeIncomingMessage([msg("temp-1", "user")], msg("real-1", "user"))
  assert.deepEqual(out.map((m) => m.id), ["real-1"])
})

test("resolving the first message keeps a second queued temp message (the bug)", () => {
  // User sent msg1 (temp-1) then msg2 (temp-2) while msg1 was still processing.
  const list = [msg("temp-1", "user"), msg("temp-2", "user")]
  // The real event for msg1 arrives first.
  const out = mergeIncomingMessage(list, msg("real-1", "user"))
  // temp-1 is resolved; temp-2 must remain so it doesn't vanish from the UI.
  assert.deepEqual(out.map((m) => m.id), ["real-1", "temp-2"])
})

test("updates an already-present message in place without reordering", () => {
  const list = [msg("real-1", "user"), msg("real-2", "assistant")]
  const updated: Message = { ...msg("real-2", "assistant"), time: { created: 1, completed: 9 } }
  const out = mergeIncomingMessage(list, updated)
  assert.deepEqual(out.map((m) => m.id), ["real-1", "real-2"])
  assert.equal(out[1].time.completed, 9)
})

test("appends a real message when there is no matching temp and it is new", () => {
  const out = mergeIncomingMessage([msg("real-1", "user")], msg("real-2", "user"))
  assert.deepEqual(out.map((m) => m.id), ["real-1", "real-2"])
})

test("does not remove a temp of a different role", () => {
  const out = mergeIncomingMessage([msg("temp-1", "user")], msg("real-a", "assistant"))
  assert.ok(out.some((m) => m.id === "temp-1"))
})

const part = (id: string, messageID: string, type: Part["type"] = "text", extra: Partial<Part> = {}): Part => ({
  id,
  messageID,
  type,
  text: type === "text" ? "hello" : undefined,
  ...extra,
})

test("mergeIncomingPart appends a part with a new id", () => {
  const out = mergeIncomingPart([part("a-text", "m1")], part("a-file-1", "m1", "file"))
  assert.deepEqual(out.map((p) => p.id), ["a-text", "a-file-1"])
})

test("mergeIncomingPart replaces the same-id part in place without reordering", () => {
  const updated = part("a-text", "m1", "text", { text: "hello edited" })
  const out = mergeIncomingPart([part("a-text", "m1"), part("a-file-1", "m1", "file")], updated)
  assert.deepEqual(out.map((p) => p.id), ["a-text", "a-file-1"])
  assert.equal(out[0].text, "hello edited")
})

test("reconcileOptimisticParts renames a text part to the echo id and rekeys the message", () => {
  const out = reconcileOptimisticParts([part("temp-part-text-1", "temp-1")], "msg_u1")
  assert.deepEqual(out, [{ ...part("temp-part-text-1", "temp-1"), messageID: "msg_u1", id: "msg_u1-text" }])
})

test("reconcileOptimisticParts offsets file ids past the text part like userParts", () => {
  const optimistic: Part[] = [
    part("temp-part-text-1", "temp-1"),
    part("temp-part-file-1-0", "temp-1", "file", { mime: "image/png", url: "file:///a.jpg" }),
    part("temp-part-file-1-1", "temp-1", "file", { mime: "image/png", url: "file:///b.jpg" }),
  ]
  const out = reconcileOptimisticParts(optimistic, "msg_u1")
  assert.deepEqual(out.map((p) => p.id), ["msg_u1-text", "msg_u1-file-1", "msg_u1-file-2"])
  assert.ok(out.every((p) => p.messageID === "msg_u1"))
})

test("reconcileOptimisticParts starts file ids at zero without a text part", () => {
  const optimistic: Part[] = [part("temp-part-file-1-0", "temp-1", "file", { mime: "image/png", url: "file:///a.jpg" })]
  const out = reconcileOptimisticParts(optimistic, "msg_u1")
  assert.deepEqual(out.map((p) => p.id), ["msg_u1-file-0"])
})

test("reconcileOptimisticParts leaves other part types alone apart from the message rekey", () => {
  const out = reconcileOptimisticParts([part("temp-part-text-1", "temp-1"), part("x-tool", "temp-1", "tool")], "msg_u1")
  assert.deepEqual(out.map((p) => p.id), ["msg_u1-text", "x-tool"])
  assert.ok(out.every((p) => p.messageID === "msg_u1"))
})

// Full send reconciliation, mirroring sessions.ts sendMessage + the v2
// `session.inbox.enqueued` fan-out (message.updated + parts, then the queue
// mark): an optimistic user send, the POST receipt swap, then the server
// echo. The reported bug: the sent text rendered twice ("hello\nhello")
// because the optimistic part ids (`temp-part-text-*`) never matched the
// echo part ids (`<messageID>-text`), so the echo appended instead of
// replacing. MessageBubble renders text parts joined, so two text parts is
// the user-visible duplication.
function renderedText(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

test("send then echo renders the user text exactly once (receipt before echo)", () => {
  // Optimistic insert, as sessions.ts builds it.
  const tempID = "temp-1700000000000"
  let messages: Message[] = [{ ...msg(tempID, "user") }]
  let echoParts: Part[] = [{ id: `temp-part-text-1700000000000`, messageID: tempID, type: "text", text: "hello" }]

  // POST receipt swap (real id doubles as the inbox id when queued).
  const realID = "msg_u1"
  messages = messages.map((m) => (m.id === tempID ? { ...m, id: realID } : m))
  echoParts = reconcileOptimisticParts(echoParts, realID)

  // Server echo: message.updated + the inbox.enqueued part fan-out, built
  // with the real echo scheme (userParts, as the translator does).
  messages = mergeIncomingMessage(messages, { ...msg(realID, "user") })
  let stored: Part[] = echoParts
  for (const p of userParts(realID, { text: "hello" })) stored = mergeIncomingPart(stored, p)

  assert.deepEqual(messages.map((m) => m.id), [realID])
  assert.equal(stored.filter((p) => p.type === "text").length, 1)
  assert.equal(renderedText(stored), "hello")
})

test("send then echo renders attachments exactly once (receipt before echo)", () => {
  const tempID = "temp-1700000000000"
  const optimistic: Part[] = [
    { id: "temp-part-text-1700000000000", messageID: tempID, type: "text", text: "see this" },
    { id: "temp-part-file-1700000000000-0", messageID: tempID, type: "file", mime: "image/jpeg", url: "file:///shot.jpg" },
  ]
  const realID = "msg_u1"
  let stored = reconcileOptimisticParts(optimistic, realID)
  for (const p of userParts(realID, {
    text: "see this",
    files: [{ data: "YWJj", mime: "image/jpeg", name: "shot.jpg" }],
  })) {
    stored = mergeIncomingPart(stored, p)
  }
  assert.deepEqual(stored.map((p) => p.id), ["msg_u1-text", "msg_u1-file-1"])
  assert.equal(renderedText(stored), "see this")
})

test("send then echo renders exactly once when the echo wins the race (echo before receipt)", () => {
  const tempID = "temp-1700000000000"
  const realID = "msg_u1"
  // Echo lands first: temp resolves via role match, echo parts populate fresh.
  const messages = mergeIncomingMessage([msg(tempID, "user")], { ...msg(realID, "user") })
  let echoStored: Part[] = []
  for (const p of userParts(realID, { text: "hello" })) echoStored = mergeIncomingPart(echoStored, p)
  // Late receipt: the swap moves the still-pending optimistic parts onto the
  // real id (overwriting the equivalent echo parts with the same ids/text).
  const optimistic: Part[] = [{ id: "temp-part-text-1700000000000", messageID: tempID, type: "text", text: "hello" }]
  assert.equal(renderedText(echoStored), "hello", "echo alone is a single copy")
  const stored = reconcileOptimisticParts(optimistic, realID)
  assert.deepEqual(messages.map((m) => m.id), [realID])
  assert.equal(stored.filter((p) => p.type === "text").length, 1)
  assert.equal(renderedText(stored), "hello")
})

test("skipping the reconcile step duplicates the echo (the pre-fix behaviour)", () => {
  // The old receipt swap rekeyed messageID but kept `temp-part-*` ids, so
  // the echo part id never matched and appended a second text part.
  const tempID = "temp-1700000000000"
  const realID = "msg_u1"
  let stored: Part[] = [{ id: "temp-part-text-1700000000000", messageID: realID, type: "text", text: "hello" }]
  for (const p of userParts(realID, { text: "hello" })) stored = mergeIncomingPart(stored, p)
  assert.equal(stored.filter((p) => p.type === "text").length, 2)
  assert.equal(renderedText(stored), "hello\nhello")
})

test("mergeHistoryWithPending keeps the server list and carries temps only", () => {
  const server = [msg("m1"), msg("m2")]
  const out = mergeHistoryWithPending(server, [msg("m1"), msg("temp-1")])
  // m1 is a committed message, not a temp: the server copy wins, no re-add.
  assert.deepEqual(out.map((m) => m.id), ["m1", "m2", "temp-1"])
})

test("mergeHistoryWithPending dedupes repeated server ids", () => {
  const out = mergeHistoryWithPending([msg("m1"), msg("m1"), msg("m2")], [])
  assert.deepEqual(out.map((m) => m.id), ["m1", "m2"])
})

test("swapOptimisticId renames the temp in place when the real id is new", () => {
  const out = swapOptimisticId([msg("m0"), msg("temp-1")], "temp-1", "real-1")
  assert.deepEqual(out.map((m) => m.id), ["m0", "real-1"])
})

test("swapOptimisticId drops the temp when the real id is already listed", () => {
  // A history fetch landed mid-POST: renaming would leave two "real-1"
  // entries. The old inline swap did exactly that.
  const out = swapOptimisticId([msg("m0"), msg("real-1"), msg("temp-1")], "temp-1", "real-1")
  assert.deepEqual(out.map((m) => m.id), ["m0", "real-1"])
})

test("swapOptimisticId leaves the list alone when the temp is already gone", () => {
  const list = [msg("real-1")]
  assert.deepEqual(swapOptimisticId(list, "temp-1", "real-1"), list)
  assert.deepEqual(swapOptimisticId(list, "real-1", "real-1").map((m) => m.id), ["real-1"])
})

// loadOlderMessages interleaving (the transient duplicate): a history fetch
// lands between the optimistic insert and the POST receipt, so the merge
// transiently holds [server real, local temp]. The receipt swap must then
// collapse — not duplicate — the pair.
test("history fetch mid-POST then receipt leaves exactly one copy", () => {
  const tempID = "temp-1700000000000"
  const realID = "msg_u1"
  // Optimistic insert, as sessions.ts builds it.
  const existing: Message[] = [{ ...msg(tempID, "user") }]
  // Full history fetch resolves mid-POST: the server already has the real id.
  const server: Message[] = [{ ...msg(realID, "user") }]
  const merged = mergeHistoryWithPending(server, existing)
  assert.deepEqual(merged.map((m) => m.id), [realID, tempID])
  // Late POST receipt: the swap drops the temp against the present real id.
  const swapped = swapOptimisticId(merged, tempID, realID)
  assert.deepEqual(swapped.map((m) => m.id), [realID])
})

test("history fetch mid-POST then receipt keeps a single text part", () => {
  const tempID = "temp-1700000000000"
  const realID = "msg_u1"
  // Server parts from the mid-POST fetch (authoritative echo scheme).
  let serverParts: Part[] = userParts(realID, { text: "hello" })
  // Optimistic parts, reconciled onto the real id as the swap does.
  const optimistic: Part[] = [{ id: "temp-part-text-1", messageID: tempID, type: "text", text: "hello" }]
  let base = reconcileOptimisticParts(optimistic, realID)
  for (const p of serverParts) base = mergeIncomingPart(base, p)
  serverParts = base
  assert.equal(serverParts.filter((p) => p.type === "text").length, 1)
  assert.equal(renderedText(serverParts), "hello")
})
