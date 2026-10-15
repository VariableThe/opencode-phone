import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Same approach as sessions.regression.test.ts: the test runtime is
// node:test with no React Native renderer (events.ts pulls in expo
// modules via the stores), so pin the store wiring by asserting on the
// real store source.
//
// The reported gap: the v2 translator emits `message.removed` for
// `session.inbox.cancelled` (v2-shape.ts), and sessions.handleEvent already
// handles it — but events.ts never routed it, so cancelling a queued
// message from another client left a stale bubble on the phone.

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, "events.ts"), "utf8")

test("events.ts routes message.removed to the sessions store", () => {
  assert.match(src, /case "message\.removed"/, "a routing case for the translator's cancel event must exist")
  const start = src.indexOf('case "message.removed"')
  const end = src.indexOf('case "session.updated"', start)
  assert.ok(end !== -1, "the case must be closed by the next case")
  const block = src.slice(start, end)
  assert.ok(
    block.includes("useSessions.getState().handleEvent"),
    "the case must forward to sessions.handleEvent, which already handles removal",
  )
  assert.ok(block.includes("messageID"), "the forwarded event must carry the removed message id")
})

test("the removal path stays sessions-owned (no duplicate handling here)", () => {
  const start = src.indexOf('case "message.removed"')
  const block = src.slice(start, src.indexOf('case "session.updated"', start))
  assert.ok(!block.includes("set("), "events.ts must not mutate message state itself — the sessions store owns it")
})
