import { test } from "node:test"
import assert from "node:assert/strict"
import { log, getLogEntries, formatLogLines, clearLog, type LogEntry } from "./logbuffer.ts"

// The log buffer backs diagnostic reports. A regression in its ring-buffer cap,
// message serialization, or formatting silently corrupts the attached logs, so
// these pin the observable behavior.

test("records entries with level, tag, and joined message", () => {
  clearLog()
  log.info("net", "connected to", "server")
  const entries = getLogEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].level, "info")
  assert.equal(entries[0].tag, "net")
  assert.equal(entries[0].message, "connected to server")
  assert.equal(typeof entries[0].ts, "number")
})

test("serializes non-string parts as JSON, falling back to String() when unserializable", () => {
  clearLog()
  log.debug("t", "obj", { a: 1 }, 42, true)
  assert.equal(getLogEntries()[0].message, 'obj {"a":1} 42 true')

  clearLog()
  const circular: Record<string, unknown> = {}
  circular.self = circular // JSON.stringify throws -> String() fallback
  log.warn("t", circular)
  // Should not throw and should produce a string (the [object Object] fallback).
  assert.equal(typeof getLogEntries()[0].message, "string")
  assert.equal(getLogEntries().length, 1)
})

test("each level helper is recorded with the matching level", () => {
  clearLog()
  log.debug("t", "d")
  log.info("t", "i")
  log.warn("t", "w")
  log.error("t", "e")
  assert.deepEqual(
    getLogEntries().map((e) => e.level),
    ["debug", "info", "warn", "error"],
  )
})

test("ring buffer is capped at 200 entries, keeping the most recent", () => {
  clearLog()
  for (let i = 0; i < 250; i++) log.info("t", `msg${i}`)
  const entries = getLogEntries()
  assert.equal(entries.length, 200)
  // Oldest 50 dropped: first kept is msg50, last is msg249.
  assert.equal(entries[0].message, "msg50")
  assert.equal(entries[entries.length - 1].message, "msg249")
})

test("getLogEntries returns a copy — mutating it does not affect the buffer", () => {
  clearLog()
  log.info("t", "a")
  const snapshot = getLogEntries()
  snapshot.push({ ts: 0, level: "info", tag: "x", message: "injected" } as LogEntry)
  assert.equal(getLogEntries().length, 1)
})

test("clearLog empties the buffer", () => {
  clearLog()
  log.info("t", "a")
  log.info("t", "b")
  assert.equal(getLogEntries().length, 2)
  clearLog()
  assert.equal(getLogEntries().length, 0)
})

test("formatLogLines renders ISO time, padded level, tag, and message", () => {
  const entries: LogEntry[] = [
    { ts: Date.UTC(2026, 0, 2, 3, 4, 5, 678), level: "info", tag: "net", message: "hello" },
    { ts: Date.UTC(2026, 0, 2, 3, 4, 6, 0), level: "error", tag: "db", message: "boom" },
  ]
  const out = formatLogLines(entries)
  const lines = out.split("\n")
  assert.equal(lines.length, 2)
  assert.equal(lines[0], "03:04:05.678 INFO  [net] hello")
  assert.equal(lines[1], "03:04:06.000 ERROR [db] boom")
})

test("formatLogLines of an empty list is an empty string", () => {
  assert.equal(formatLogLines([]), "")
})
