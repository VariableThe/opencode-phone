import { test } from "node:test"
import assert from "node:assert/strict"
import { SSEParser } from "./sse.ts"

// The opencode live chat is driven by this SSE stream. The hard cases are framing:
// events that arrive split across network reads must not be dropped or corrupted.

test("parses a single complete data frame in one chunk", () => {
  const p = new SSEParser()
  assert.deepEqual(p.push('data: {"x":1}\n'), ['{"x":1}'])
})

test("parses multiple frames in one chunk in order", () => {
  const p = new SSEParser()
  assert.deepEqual(p.push("data: a\ndata: b\ndata: c\n"), ["a", "b", "c"])
})

test("holds a partial trailing line until the next chunk completes it", () => {
  const p = new SSEParser()
  // First read ends mid-frame (no trailing newline yet).
  assert.deepEqual(p.push('data: {"hello":'), [])
  // Second read delivers the rest plus the terminating newline.
  assert.deepEqual(p.push('"world"}\n'), ['{"hello":"world"}'])
})

test("reassembles a frame split across three reads", () => {
  const p = new SSEParser()
  assert.deepEqual(p.push("dat"), [])
  assert.deepEqual(p.push("a: par"), [])
  assert.deepEqual(p.push("tial\n"), ["partial"])
})

test("filters the [DONE] sentinel", () => {
  const p = new SSEParser()
  assert.deepEqual(p.push("data: [DONE]\n"), [])
  assert.deepEqual(p.push("data: real\ndata: [DONE]\n"), ["real"])
})

test("ignores empty data payloads and non-data lines", () => {
  const p = new SSEParser()
  // keepalive comment, an event: line, a blank line, and an empty data payload
  assert.deepEqual(p.push(": keepalive\nevent: ping\n\ndata: \ndata: x\n"), ["x"])
})

test("a frame held across chunks is emitted exactly once", () => {
  const p = new SSEParser()
  const first = p.push("data: one\ndata: tw")
  const second = p.push("o\ndata: three\n")
  assert.deepEqual(first, ["one"])
  assert.deepEqual(second, ["two", "three"])
})

test("blank chunk yields nothing and preserves the held buffer", () => {
  const p = new SSEParser()
  assert.deepEqual(p.push("data: held"), [])
  assert.deepEqual(p.push(""), [])
  assert.deepEqual(p.push("\n"), ["held"])
})

test("data payload preserves internal colons and spaces (only the 'data: ' prefix is stripped)", () => {
  const p = new SSEParser()
  assert.deepEqual(p.push('data: {"url":"http://x:1"}\n'), ['{"url":"http://x:1"}'])
})
