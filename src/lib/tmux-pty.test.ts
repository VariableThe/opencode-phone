import { test } from "node:test"
import assert from "node:assert/strict"
import { buildTmuxAttachBody, tmuxNameFromRecord } from "./tmux-pty.ts"

// The phone attaches to tmux by creating a server PTY that runs
// `tmux attach-session -t <name>` (no node-pty in the app). A wrong body
// here either spawns a bare shell (user lands somewhere unexpected) or 4xxs
// on every tap of "Open terminal" — so the exact argv shape is pinned, and
// names that would be dangerous in a shell must pass through untouched (the
// server spawns argv directly, never via sh -c).

test("buildTmuxAttachBody returns the exact POST /api/pty body", () => {
  assert.deepEqual(buildTmuxAttachBody("dev"), {
    title: "tmux: dev",
    command: "tmux",
    args: ["attach-session", "-t", "dev"],
  })
})

test("buildTmuxAttachBody trims the name and rejects blanks", () => {
  assert.equal(buildTmuxAttachBody("  dev  ").args[2], "dev")
  assert.throws(() => buildTmuxAttachBody(""), /must not be empty/)
  assert.throws(() => buildTmuxAttachBody("   "), /must not be empty/)
})

test("buildTmuxAttachBody keeps shell metachars as one argv element (no shell involved)", () => {
  const body = buildTmuxAttachBody("my session; rm -rf /")
  assert.deepEqual(body.args, ["attach-session", "-t", "my session; rm -rf /"])
})

test("tmuxNameFromRecord reads the -t argv value", () => {
  assert.equal(tmuxNameFromRecord({ command: "tmux", args: ["attach-session", "-t", "dev"] }), "dev")
})

test("tmuxNameFromRecord falls back to the 'tmux: <name>' title", () => {
  assert.equal(tmuxNameFromRecord({ command: "/bin/bash", title: "tmux: dev" }), "dev")
})

test("tmuxNameFromRecord returns null for plain shells and malformed records", () => {
  assert.equal(tmuxNameFromRecord({ command: "/bin/bash", args: ["-l"], title: "Terminal" }), null)
  assert.equal(tmuxNameFromRecord({}), null)
  assert.equal(tmuxNameFromRecord({ command: "tmux", args: ["attach-session", "-t"] }), null)
  assert.equal(tmuxNameFromRecord({ command: "tmux", args: "attach" }), null)
  assert.equal(tmuxNameFromRecord({ title: "tmux: " }), null)
})
