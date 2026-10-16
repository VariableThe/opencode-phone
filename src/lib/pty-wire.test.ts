import { test } from "node:test"
import assert from "node:assert/strict"
import { ptyConnectUrl, parsePtyFrame, ptyResizeBody, ptyGoneReason, PTY_DEFAULT_COLS, PTY_DEFAULT_ROWS } from "./pty-wire.ts"

// Pins the reverse-engineered wire rules (see pty-wire.ts header): URL
// upgrade, the NUL-prefixed cursor control frame, the PUT resize body, and
// the 4404 gone-reasons. A regression here strands the terminal screen on a
// dead socket or sizes the pty wrong.

test("ptyConnectUrl upgrades http(s) to ws(s) and encodes the id", () => {
  assert.equal(ptyConnectUrl("http://host:4096/", "pty_abc"), "ws://host:4096/api/pty/pty_abc/connect")
  assert.equal(ptyConnectUrl("https://host", "pty_a/b"), "wss://host/api/pty/pty_a%2Fb/connect")
})

test("ptyConnectUrl appends the resume cursor when known", () => {
  assert.equal(ptyConnectUrl("http://h", "pty_x", 41), "ws://h/api/pty/pty_x/connect?cursor=41")
  assert.equal(ptyConnectUrl("http://h", "pty_x"), "ws://h/api/pty/pty_x/connect")
})

test("ptyConnectUrl rejects non-http base URLs", () => {
  assert.throws(() => ptyConnectUrl("ftp://h", "pty_x"), /unsupported base URL/)
})

test("parsePtyFrame pulls the cursor out of the NUL-prefixed control frame", () => {
  assert.deepEqual(parsePtyFrame('\0{"cursor":0}'), { kind: "meta", cursor: 0 })
  assert.deepEqual(parsePtyFrame('\0{"cursor":128}'), { kind: "meta", cursor: 128 })
})

test("parsePtyFrame treats plain output (and malformed control frames) as data", () => {
  assert.deepEqual(parsePtyFrame("hello\r\n"), { kind: "data", text: "hello\r\n" })
  assert.deepEqual(parsePtyFrame("\0not json"), { kind: "data", text: "\0not json" })
  assert.deepEqual(parsePtyFrame('\0{"cursor":-1}'), { kind: "data", text: '\0{"cursor":-1}' })
  assert.deepEqual(parsePtyFrame(""), { kind: "data", text: "" })
})

test("ptyResizeBody nests rows/cols under size (PUT /api/pty/{id})", () => {
  assert.deepEqual(ptyResizeBody({ rows: 10, cols: 40 }), { size: { rows: 10, cols: 40 } })
})

test("ptyGoneReason classifies the 4404 close reasons", () => {
  assert.equal(ptyGoneReason("session exited"), "exited")
  assert.equal(ptyGoneReason("session not found"), "not-found")
  assert.equal(ptyGoneReason(""), null)
  assert.equal(ptyGoneReason("whatever"), null)
})

test("default size matches the server's fresh-pty size", () => {
  assert.equal(PTY_DEFAULT_COLS, 80)
  assert.equal(PTY_DEFAULT_ROWS, 24)
})
