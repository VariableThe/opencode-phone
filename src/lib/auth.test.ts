import { test } from "node:test"
import assert from "node:assert/strict"
import { buildAuth } from "./auth.ts"

test("no password -> no auth (open server)", () => {
  assert.equal(buildAuth("opencode", undefined), undefined)
  assert.equal(buildAuth("opencode", null), undefined)
  assert.equal(buildAuth("opencode", ""), undefined)
})

test("password but no username -> defaults username to 'opencode' (Quick Connect fix)", () => {
  // Regression guard: Quick Connect has no username field. Before the fix, an empty
  // username made auth undefined and the app sent NO Authorization header -> 401.
  assert.deepEqual(buildAuth(undefined, "secret"), { username: "opencode", password: "secret" })
  assert.deepEqual(buildAuth("", "secret"), { username: "opencode", password: "secret" })
  assert.deepEqual(buildAuth("   ", "secret"), { username: "opencode", password: "secret" })
})

test("explicit username preserved (Advanced mode), trimmed", () => {
  assert.deepEqual(buildAuth("alice", "secret"), { username: "alice", password: "secret" })
  assert.deepEqual(buildAuth("  alice  ", "secret"), { username: "alice", password: "secret" })
})
