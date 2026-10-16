import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Same approach as message-bubble-selection.regression.test.ts: the test
// runtime is node:test with no React Native renderer, so pin the store
// wiring by asserting on the real store source.
//
// The reported regression: a sent user message rendered twice ("hello"
// stacked as "hello\nhello" — MessageBubble joins text parts). The
// optimistic insert keys its parts `temp-part-text-*`, but the server echo
// (v2 `session.inbox.enqueued` fan-out, built by `userParts`) keys them
// `<messageID>-text`. The receipt swap rekeyed messageID but kept the
// `temp-part-*` ids, so the `message.part.updated` id-match never hit and the
// echo appended a second text part. The swap must rename the optimistic
// parts to the canonical echo ids in the same pass (reconcileOptimisticParts)
// so every later echo replaces in place.

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, "sessions.ts"), "utf8")

test("the POST receipt swap reconciles optimistic part ids, not just the message id", () => {
  assert.match(src, /reconcileOptimisticParts/, "the swap must rename temp-part-* ids to the echo scheme")
  const swap = src.slice(src.indexOf("const realID"), src.indexOf("Register the run with the notification"))
  assert.ok(
    swap.includes("reconcileOptimisticParts"),
    "reconcile must run inside the receipt swap, in the same pass as the message-id rename",
  )
  assert.ok(!swap.includes("parts[userMessage.id].map((p) => ({ ...p, messageID: realID }))"), "the id-preserving move is gone")
})

test("the part-update handler merges by part id through the shared helper", () => {
  assert.match(src, /mergeIncomingPart/, "part echo handling must live in the tested merge helper")
  assert.match(src, /mergeIncomingPart\(messageParts, part\)/)
})

test("the merge helper stays the single reconciliation point for the send path", () => {
  assert.match(src, /mergeIncomingMessage\(state\.messages, message\)/)
  assert.match(src, /from "\.\.\/lib\/message-merge"/)
})
