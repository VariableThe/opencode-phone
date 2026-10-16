import { test } from "node:test"
import assert from "node:assert/strict"
import { AlertDedupe, alertKey, classifySettlement, shouldNotify } from "./session-settlement.ts"

// The evaluator is the single source of "should notify": finished, failed and
// needs-input alert; aborted and in-progress never do.

test("aborted runs are dropped even when the server says idle", () => {
  assert.equal(classifySettlement({ status: "idle", pendingInput: false, errored: false, aborted: true, exists: true }), "aborted")
})

test("deleted sessions are dropped as aborted, never notified", () => {
  const state = classifySettlement({ status: "idle", pendingInput: false, errored: false, aborted: false, exists: false })
  assert.equal(state, "aborted")
  assert.equal(shouldNotify(state), false)
})

test("a pending prompt wins over busy: needs-input alerts immediately", () => {
  const state = classifySettlement({ status: "busy", pendingInput: true, errored: false, aborted: false, exists: true })
  assert.equal(state, "blocked")
  assert.equal(shouldNotify(state), true)
})

test("busy and retry are suppressed", () => {
  for (const status of ["busy", "retry"] as const) {
    const state = classifySettlement({ status, pendingInput: false, errored: false, aborted: false, exists: true })
    assert.equal(shouldNotify(state), false)
  }
  assert.equal(classifySettlement({ status: "busy", pendingInput: false, errored: false, aborted: false, exists: true }), "running")
  assert.equal(classifySettlement({ status: "retry", pendingInput: false, errored: false, aborted: false, exists: true }), "retrying")
})

test("idle without error finishes, idle with error fails — both notify", () => {
  assert.equal(classifySettlement({ status: "idle", pendingInput: false, errored: false, aborted: false, exists: true }), "finished")
  assert.equal(classifySettlement({ status: "idle", pendingInput: false, errored: true, aborted: false, exists: true }), "failed")
  assert.equal(shouldNotify("finished"), true)
  assert.equal(shouldNotify("failed"), true)
})

test("no signal means unknown, which never notifies", () => {
  const state = classifySettlement({ pendingInput: false, errored: false, aborted: false, exists: true })
  assert.equal(state, "unknown")
  assert.equal(shouldNotify(state), false)
  assert.equal(shouldNotify("running"), false)
  assert.equal(shouldNotify("retrying"), false)
  assert.equal(shouldNotify("aborted"), false)
})

test("alert keys are scoped per connection, session and state", () => {
  assert.notEqual(alertKey("a", "s", "finished"), alertKey("b", "s", "finished"))
  assert.notEqual(alertKey("a", "s", "finished"), alertKey("a", "s", "failed"))
  assert.notEqual(alertKey("a", "s", "finished"), alertKey("a", "other", "finished"))
})

test("blocked keys include the prompt id so a second prompt re-alerts", () => {
  assert.notEqual(alertKey("a", "s", "blocked", "p1"), alertKey("a", "s", "blocked", "p2"))
  assert.equal(alertKey("a", "s", "blocked", "p1"), alertKey("a", "s", "blocked", "p1"))
})

test("dedupe claims once: repeats of an announced state are dropped", () => {
  const dedupe = new AlertDedupe()
  const key = alertKey("conn", "sess", "finished")
  assert.equal(dedupe.claim(key), true)
  assert.equal(dedupe.claim(key), false)
  assert.equal(dedupe.has(key), true)
})

test("a new run re-arms finished/failed alerts but keeps blocked history", () => {
  const dedupe = new AlertDedupe()
  const finished = alertKey("conn", "sess", "finished")
  const blocked = alertKey("conn", "sess", "blocked", "p1")
  dedupe.claim(finished)
  dedupe.claim(blocked)
  dedupe.resetTerminal("conn", "sess")
  assert.equal(dedupe.claim(finished), true)
  assert.equal(dedupe.claim(blocked), false)
})

test("preloaded persisted keys survive a restart without re-firing", () => {
  const first = new AlertDedupe()
  first.claim(alertKey("conn", "sess", "failed"))
  const second = new AlertDedupe()
  second.preload(first.snapshot())
  assert.equal(second.claim(alertKey("conn", "sess", "failed")), false)
})
