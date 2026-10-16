import { test } from "node:test"
import assert from "node:assert/strict"
import {
  FILE_PREVIEW_MAX_CHARS,
  FILE_READ_MAX_BYTES,
  fsReadSuffix,
  hasBinaryByte,
  parseV1FileContent,
  sortFileEntries,
  toPreview,
} from "./fs-read.ts"

// fsReadSuffix ---------------------------------------------------------------
// Live-verified against 2.0.29: absolute /a/b -> /api/fs/read//a/b (200);
// ?path= on the read route 404s.

test("fsReadSuffix: absolute path keeps its leading slash (double-slash form)", () => {
  assert.equal(fsReadSuffix("/home/aditya/x.txt"), "/api/fs/read//home/aditya/x.txt")
})

test("fsReadSuffix: relative path resolves against the request location", () => {
  assert.equal(fsReadSuffix("notes/todo.md"), "/api/fs/read/notes/todo.md")
})

test("fsReadSuffix: trims whitespace and encodes special segments, keeps slashes", () => {
  assert.equal(fsReadSuffix("  /a/my file.txt "), "/api/fs/read//a/my%20file.txt")
  assert.equal(fsReadSuffix("/a/b?c#d"), "/api/fs/read//a/b%3Fc%23d")
})

test("fsReadSuffix: leaves dot segments literal for the server to resolve", () => {
  assert.equal(fsReadSuffix("/a/../b/./c"), "/api/fs/read//a/../b/./c")
})

// hasBinaryByte --------------------------------------------------------------

test("hasBinaryByte: empty and plain-text buffers are not binary", () => {
  assert.equal(hasBinaryByte(new Uint8Array(0)), false)
  assert.equal(hasBinaryByte(new TextEncoder().encode('{"a": 1}\n')), false)
})

test("hasBinaryByte: NUL byte anywhere in the scan window flags binary", () => {
  assert.equal(hasBinaryByte(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00])), true)
  const padded = new Uint8Array(9000)
  padded.fill(65)
  padded[7999] = 0
  assert.equal(hasBinaryByte(padded), true)
})

test("hasBinaryByte: NUL past the scan window is ignored", () => {
  const padded = new Uint8Array(9000)
  padded.fill(65)
  padded[8500] = 0
  assert.equal(hasBinaryByte(padded), false)
  assert.equal(hasBinaryByte(padded, 9000), true)
})

// toPreview ------------------------------------------------------------------

test("toPreview: short text passes through unflagged", () => {
  const out = toPreview("hello")
  assert.deepEqual(out, { text: "hello", truncated: false, totalChars: 5 })
})

test("toPreview: caps at FILE_PREVIEW_MAX_CHARS and reports the true total", () => {
  const full = "x".repeat(FILE_PREVIEW_MAX_CHARS + 10)
  const out = toPreview(full)
  assert.equal(out.text.length, FILE_PREVIEW_MAX_CHARS)
  assert.equal(out.truncated, true)
  assert.equal(out.totalChars, FILE_PREVIEW_MAX_CHARS + 10)
})

test("FILE_READ_MAX_BYTES is a sane download cap", () => {
  assert.equal(FILE_READ_MAX_BYTES, 1_000_000)
})

// sortFileEntries ------------------------------------------------------------

test("sortFileEntries: directories first, then case-insensitive name order", () => {
  const rows = [
    { type: "file" as const, name: "b.txt" },
    { type: "directory" as const, name: "zeta" },
    { type: "file" as const, name: "A.txt" },
    { type: "directory" as const, name: "alpha" },
  ]
  assert.deepEqual(
    sortFileEntries(rows).map((r) => r.name),
    ["alpha", "zeta", "A.txt", "b.txt"],
  )
})

test("sortFileEntries: does not mutate the input", () => {
  const rows = [{ type: "file" as const, name: "b" }]
  sortFileEntries(rows)
  assert.deepEqual(rows, [{ type: "file", name: "b" }])
})

// parseV1FileContent ---------------------------------------------------------
// Shape per upstream v1.18.32 file.read (LegacyContent); live-unverified.

test("parseV1FileContent: text content passes through", () => {
  assert.deepEqual(parseV1FileContent({ type: "text", content: "hello" }), { text: "hello", binary: false })
})

test("parseV1FileContent: binary content flags binary without text", () => {
  assert.deepEqual(parseV1FileContent({ type: "binary", content: "aGk=" }), { text: "", binary: true })
})

test("parseV1FileContent: base64 text content is decoded", () => {
  const encoded = Buffer.from("héllo", "utf-8").toString("base64")
  assert.deepEqual(parseV1FileContent({ type: "text", content: encoded, encoding: "base64" }), {
    text: "héllo",
    binary: false,
  })
})

test("parseV1FileContent: bare string and garbage bodies", () => {
  assert.deepEqual(parseV1FileContent("raw body"), { text: "raw body", binary: false })
  assert.equal(parseV1FileContent(null), null)
  assert.equal(parseV1FileContent(42), null)
  assert.equal(parseV1FileContent({}), null)
  assert.equal(parseV1FileContent({ type: "text" }), null)
  assert.equal(parseV1FileContent({ type: "text", content: "!!!", encoding: "base64" }), null)
})
