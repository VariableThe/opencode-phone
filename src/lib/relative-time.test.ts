import { test } from "node:test"
import assert from "node:assert/strict"
import { describeRelative, formatRelativeTime } from "./relative-time.ts"

// Fixed reference so boundaries are exact, not timing-sensitive.
const NOW = 1_700_000_000_000

test("describeRelative: just now under a minute", () => {
  assert.deepEqual(describeRelative(NOW, NOW), { unit: "now", count: 0 })
  assert.deepEqual(describeRelative(NOW - 59_999, NOW), { unit: "now", count: 0 })
})

test("describeRelative: minute bucket counts whole minutes", () => {
  assert.deepEqual(describeRelative(NOW - 60_000, NOW), { unit: "minute", count: 1 })
  assert.deepEqual(describeRelative(NOW - 5 * 60_000, NOW), { unit: "minute", count: 5 })
  // 5m taxi meter: a 5m-old stamp reads 15 once the clock advances 10m
  assert.deepEqual(describeRelative(NOW - 5 * 60_000, NOW + 10 * 60_000), { unit: "minute", count: 15 })
  assert.deepEqual(describeRelative(NOW - 59 * 60_000 - 59_999, NOW), { unit: "minute", count: 59 })
})

test("describeRelative: hour/day buckets and week fallback to date", () => {
  assert.deepEqual(describeRelative(NOW - 3_600_000, NOW), { unit: "hour", count: 1 })
  assert.deepEqual(describeRelative(NOW - 5 * 3_600_000, NOW), { unit: "hour", count: 5 })
  assert.deepEqual(describeRelative(NOW - 86_400_000, NOW), { unit: "day", count: 1 })
  assert.deepEqual(describeRelative(NOW - 3 * 86_400_000, NOW), { unit: "day", count: 3 })
  assert.deepEqual(describeRelative(NOW - 604_800_000, NOW), { unit: "date", count: 0 })
})

test("describeRelative: future timestamps read as now, never negative", () => {
  assert.deepEqual(describeRelative(NOW + 60_000, NOW), { unit: "now", count: 0 })
})

// Stub translator with en-style copy: proves the exact user report — a chat
// updated 5 minutes ago reads "5m ago", and after the clock advances 10
// minutes the same stamp renders "15m ago" with no data change.
const stubT = (key: string, opts?: Record<string, unknown>): string => {
  if (key.endsWith("justNow")) return "Just now"
  const unit = key.endsWith("minutesAgo") ? "m" : key.endsWith("hoursAgo") ? "h" : "d"
  return `${opts?.count as number}${unit} ago`
}

test("formatRelativeTime: 5m-ago stamp advances to 15m-ago as the clock moves", () => {
  const stamp = NOW - 5 * 60_000
  assert.equal(formatRelativeTime(stamp, NOW, stubT, "sessionsList.time"), "5m ago")
  assert.equal(formatRelativeTime(stamp, NOW + 10 * 60_000, stubT, "sessionsList.time"), "15m ago")
})

test("formatRelativeTime: buckets map to the caller's namespace, date falls back to null", () => {
  const calls: string[] = []
  const spy = (key: string, opts?: Record<string, unknown>): string => {
    calls.push(opts?.count === undefined ? key : `${key}:${opts.count as number}`)
    return key
  }
  assert.equal(formatRelativeTime(NOW - 10_000, NOW, spy, "chat.sessionInfo.time"), "chat.sessionInfo.time.justNow")
  assert.equal(
    formatRelativeTime(NOW - 3 * 60_000, NOW, spy, "chat.sessionInfo.time"),
    "chat.sessionInfo.time.minutesAgo",
  )
  assert.equal(
    formatRelativeTime(NOW - 2 * 3_600_000, NOW, spy, "chat.sessionInfo.time"),
    "chat.sessionInfo.time.hoursAgo",
  )
  assert.equal(
    formatRelativeTime(NOW - 2 * 86_400_000, NOW, spy, "chat.sessionInfo.time"),
    "chat.sessionInfo.time.daysAgo",
  )
  // Week-old stamps return null so the caller keeps its absolute-date format.
  assert.equal(formatRelativeTime(NOW - 8 * 86_400_000, NOW, spy, "chat.sessionInfo.time"), null)
  assert.deepEqual(calls, [
    "chat.sessionInfo.time.justNow",
    "chat.sessionInfo.time.minutesAgo:3",
    "chat.sessionInfo.time.hoursAgo:2",
    "chat.sessionInfo.time.daysAgo:2",
  ])
})
