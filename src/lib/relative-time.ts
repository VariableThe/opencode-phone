// Pure relative-time derivation shared by every relative label in the app
// (session list, SessionInfo panel). Extracted so the bucket boundaries are
// unit-testable under plain `node --test` — the previous copies lived inline
// in app/(tabs)/index.tsx and SessionInfo.tsx and were only ever computed
// once per mount, so labels went stale until a full reload.
//
// Components must re-render on a tick (see use-now.ts) for labels to advance;
// this module only answers "what bucket is this timestamp in right now".
export type RelativeUnit = "now" | "minute" | "hour" | "day" | "date"

// Bucket thresholds, in milliseconds. Matches the long-standing session-list
// buckets: <1m "just now", <1h minutes, <24h hours, <7d days, else absolute.
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const WEEK = 604_800_000

export interface RelativeBucket {
  unit: RelativeUnit
  // Whole units (minutes/hours/days) for the counted buckets; 0 otherwise.
  count: number
}

export function describeRelative(timestamp: number, now: number = Date.now()): RelativeBucket {
  const diff = now - timestamp
  if (diff < MIN) return { unit: "now", count: 0 }
  if (diff < HOUR) return { unit: "minute", count: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: "hour", count: Math.floor(diff / HOUR) }
  if (diff < WEEK) return { unit: "day", count: Math.floor(diff / DAY) }
  return { unit: "date", count: 0 }
}

export type TimeTranslator = (key: string, opts?: Record<string, unknown>) => string

// Renders a bucket through the caller's own translation namespace (e.g.
// "sessionsList.time" or "chat.sessionInfo.time") so each surface keeps its
// long-standing copy byte-identical. Returns null for the date bucket — the
// caller falls back to its existing absolute-date format, unchanged.
export function formatRelativeTime(
  timestamp: number,
  now: number,
  t: TimeTranslator,
  prefix: string,
): string | null {
  const bucket = describeRelative(timestamp, now)
  if (bucket.unit === "now") return t(`${prefix}.justNow`)
  if (bucket.unit === "date") return null
  const key = bucket.unit === "minute" ? "minutesAgo" : bucket.unit === "hour" ? "hoursAgo" : "daysAgo"
  return t(`${prefix}.${key}`, { count: bucket.count })
}
