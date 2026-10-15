import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Same source-pinning approach as sessions.regression.test.ts: sessions.ts
// is not importable under plain node:test (it pulls in expo modules via
// the SDK), so these tests pin the wiring while the behaviour itself is
// covered by unit tests on the pure helpers (message-merge.test.ts) and
// the translator (v2-shape.test.ts).

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, "sessions.ts"), "utf8")

// Defect 2: an idle send is admitted with delivery "steer" and delivered
// immediately, so its inbox.enqueued fan-out must not mark it queued —
// only a genuinely-waiting ("queue") entry gets the pending affordance.
test("inbox.enqueued only marks genuinely-waiting entries as queued", () => {
  const start = src.indexOf('case "inbox.enqueued"')
  assert.ok(start !== -1, "the inbox.enqueued handler must exist")
  const block = src.slice(start, src.indexOf("break", start))
  assert.ok(block.includes("upsertQueued"), "queue sends must still be marked queued")
  assert.ok(
    block.includes('"steer"'),
    "the handler must key on the server delivery mode so idle (steer) sends skip the queued mark",
  )
})

// Defect 3: loadOlderMessages can fetch mid-POST and transiently hold
// [server real, local temp]; the merge must reconcile by id and the
// receipt swap must drop (not rename) the temp when the real id is
// already present.
test("loadOlderMessages merges through the deduping helper, not a raw concat", () => {
  const start = src.indexOf("loadOlderMessages: async")
  assert.ok(start !== -1, "loadOlderMessages must exist")
  const block = src.slice(start, src.indexOf("createSession", start))
  assert.ok(block.includes("mergeHistoryWithPending"), "the merge must reconcile instead of [...all, ...temp]")
  assert.ok(!block.includes("[...all, ...temp]"), "the raw concat that seeded the transient duplicate is gone")
})

test("the POST receipt swap collapses the temp when the real id is present", () => {
  const start = src.indexOf("const realID")
  assert.ok(start !== -1, "the receipt swap must exist")
  const block = src.slice(start, src.indexOf("Register the run with the notification", start))
  assert.ok(block.includes("swapOptimisticId"), "the swap must drop-not-rename when the real id is already listed")
  assert.ok(
    !block.includes("state.messages.map((m) => (m.id === userMessage.id ? { ...m, id: realID } : m))"),
    "the unconditional rename that left two same-id entries is gone",
  )
})
