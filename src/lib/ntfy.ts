// Pure ntfy client core: parser + polling subscriber.
//
// Wire format: oc-notify publishes its envelope (see oc-notify/src/payload.ts)
// as extra top-level fields on the ntfy JSON publish body, so a delivered
// message looks like:
//   {"id":"…","time":123,"event":"message","topic":"oc-phone",
//    "message":"…human text…","title":"[server] …",
//    "type":"permission"|"idle"|"error","server":"…","sessionID":"…","at":"…"}
//
// Type strings are verified against oc-notify/src/payload.ts NotifyType — do
// not add new ones here without updating the publisher first.
//
// This module deliberately has NO imports (not even ../notify-format): files
// loaded under plain `node --test` must be import-free leaves, because node
// type-stripping cannot resolve the extensionless cross-imports that Metro
// and tsc use (see AGENTS.md module constraints). The `clean` helper below
// therefore mirrors sanitizeBody's rules instead of importing it — keep the
// two in sync (strip C0/DEL, trim, cap at 200 chars).
//
// ---------------------------------------------------------------------------
// BACKGROUND DELIVERY — read before promising anything to the user:
// NtfySubscriber only runs inside the app's JS process. It delivers while the
// app is foregrounded or briefly after backgrounding (same constraint as the
// SSE stream in stores/events.ts — Android freezes JS timers and usually
// drops sockets under Doze/app standby, and iOS suspends the JS runtime
// minutes after backgrounding). When the app is killed, NOTHING runs here and
// ntfy messages are missed until the next launch — mitigated on start by
// suppressing only messages older than the launch (START_SKEW_MS), so
// anything published while away but still in the ntfy server cache IS
// delivered on next start/foreground. Reliable killed-app delivery would need
// either FCM or an Android foreground service with a persistent ntfy
// connection re-broadcast into expo-notifications — neither exists in this
// codebase today. Do not claim otherwise in UI copy.
// ---------------------------------------------------------------------------

export type NtfyNotifyType = "permission" | "idle" | "error"

export interface NtfyNotification {
  type: NtfyNotifyType
  title: string
  body: string
  sessionID: string
  server: string
  at: string
  /** ntfy server-side message id, used for since/dedupe. Empty when absent. */
  ntfyId: string
  /** ntfy `time` field (unix seconds). 0 when absent or not a number. */
  time: number
}

export interface NtfyTarget {
  baseUrl: string
  topic: string
}

const TYPES: ReadonlySet<string> = new Set(["permission", "idle", "error"])

const FALLBACK_TITLE: Record<NtfyNotifyType, string> = {
  permission: "Agent needs approval",
  idle: "Turn finished",
  error: "Session error",
}

const MAX_BODY = 200

// Mirrors sanitizeBody (lib/notify-format.ts) — see header note for why it
// is inlined rather than imported.
function clean(s: string | undefined, fallback: string): string {
  return (s ? s.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, MAX_BODY) : "") || fallback
}

// Maps an ntfy notify type onto the app's existing notification categories
// (src/lib/notifications.ts) so ntfy messages reuse the same prefs + plumbing.
export function categoryForType(type: NtfyNotifyType): "permissions" | "completed" | "errors" {
  switch (type) {
    case "permission":
      return "permissions"
    case "idle":
      return "completed"
    case "error":
      return "errors"
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

// Parses one already-decoded ntfy message object. Returns null for anything
// that is not a deliverable agent notification: open/keepalive event lines,
// non-objects, unknown `type` values.
//
// Envelope location: oc-notify publishes the envelope as extra top-level
// fields (see oc-notify/src/payload.ts buildNtfyBody), and this parser reads
// them there first. BUT live-probed against the self-hosted server
// (2026-10-14: POST echo drops unknown top-level fields, so a poll read-back
// carries only standard ntfy fields) — stock ntfy decodes into a fixed
// struct and discards the extras. As a fallback the parser therefore also
// accepts the envelope JSON-encoded inside the `message` string (the only
// channel guaranteed to survive); outer fields win when both are present.
// If the publisher ever embeds the envelope in `message`, this keeps working
// with zero changes.
export function parseNtfyObject(input: unknown): NtfyNotification | null {
  if (typeof input !== "object" || input === null) return null
  const o = input as Record<string, unknown>
  const event = text(o.event)
  if (event && event !== "message") return null
  if (TYPES.has(text(o.type))) return assemble(o)
  // Fallback: envelope embedded as JSON in the message string.
  const raw = text(o.message)
  if (!raw) return null
  let inner: unknown
  try {
    inner = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof inner !== "object" || inner === null) return null
  if (!TYPES.has(text((inner as Record<string, unknown>).type))) return null
  return assemble({ ...o, ...(inner as Record<string, unknown>) })
}

function assemble(o: Record<string, unknown>): NtfyNotification | null {
  const type = text(o.type) as NtfyNotifyType
  if (!TYPES.has(type)) return null
  const time = typeof o.time === "number" ? o.time : 0
  return {
    type,
    title: clean(text(o.title) || undefined, FALLBACK_TITLE[type]),
    body: clean(text(o.message) || undefined, FALLBACK_TITLE[type]),
    sessionID: text(o.sessionID),
    server: text(o.server),
    at: text(o.at),
    ntfyId: text(o.id),
    time,
  }
}

// Parses one raw line from the `GET {base}/{topic}/json` NDJSON stream.
// Malformed JSON and blank lines yield null (never throw — the stream must
// survive one bad line).
export function parseNtfyLine(line: string): NtfyNotification | null {
  if (!line || !line.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  return parseNtfyObject(parsed)
}

// ---------------------------------------------------------------------------
// Self-test publish body — the exact JSON-publish shape the settings test
// button sends. MUST keep the envelope JSON-encoded inside `message` (the
// only carrier ntfy preserves verbatim): unknown top-level fields are
// silently stripped by the server, so a plain-text `message` reads back
// with no envelope and parseNtfyObject returns null — the round trip can
// never succeed (live-verified 2026-10-15). Pure (no imports) so it stays
// testable under plain `node --test` like the rest of this module.
export const TEST_TITLE = "[phone] Test notification"
export const TEST_BODY_TEXT = "ntfy setup works — the phone received this via the topic poll"

export function buildTestPublishBody(topic: string, at: string): Record<string, unknown> {
  const envelope = {
    type: "idle",
    server: "phone",
    sessionID: "",
    title: TEST_TITLE,
    message: TEST_BODY_TEXT,
    at,
  }
  return {
    topic,
    message: JSON.stringify(envelope),
    title: envelope.title,
    priority: 3,
    tags: ["white_check_mark", "opencode"],
    // Forward-compat mirror (stripped by ntfy today, preferred by the
    // parser if a future server preserves them).
    type: envelope.type,
    server: envelope.server,
    sessionID: envelope.sessionID,
    at,
  }
}

// ---------------------------------------------------------------------------
// Subscriber — interval polling, not streaming.
// ---------------------------------------------------------------------------

export interface NtfySubscriberOptions {
  fetchImpl?: typeof fetch
  /** ms between successful polls. Default 10_000. */
  pollIntervalMs?: number
  /** backoff ladder for failed polls. Default mirrors the SSE ladder. */
  backoffMs?: readonly number[]
}

export const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const
const MAX_DELAY_MS = 15_000
// Messages older than launch (minus skew) are marked seen-but-not-delivered
// on the first poll, so a fresh start doesn't replay stale cache history.
const START_SKEW_MS = 10_000
const SEEN_CAP = 500

function keyOf(n: NtfyNotification): string {
  return n.ntfyId || `${n.time}|${n.type}|${n.sessionID}|${n.title}|${n.body}`
}

// Polls `GET {base}/{topic}/json?poll=1&since=…` on an interval instead of
// holding the streaming `/json` endpoint or `/ws` open, because React
// Native's fetch has no reliable streaming-body reader — a hung chunked
// response would wedge the loop with no timeout to catch it. ntfy caches
// recent messages server-side, so polling with `since=<last id>` still
// delivers everything; worst-case latency is one poll interval.
export class NtfySubscriber {
  private readonly notify: (n: NtfyNotification) => void
  private readonly fetchImpl: typeof fetch
  private readonly intervalMs: number
  private readonly backoff: readonly number[]
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  // Monotonic generation bumped by every stopTimers(): a poll() or timer
  // callback from an older generation is stale and must not schedule — this
  // is what keeps exactly one poll chain alive when update()/reconnectNow()
  // overlap an in-flight fetch whose abort is ignored (the old fetch still
  // resolves and would otherwise fork a second chain; see the overlap test).
  private epoch = 0
  private target: NtfyTarget | null = null
  private seen = new Set<string>()
  private seenOrder: string[] = []
  private lastId: string | null = null
  private baselined = false
  private startedAt = 0
  private attempts = 0
  private stopped = true

  constructor(notify: (n: NtfyNotification) => void, options: NtfySubscriberOptions = {}) {
    this.notify = notify
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS
  }

  get running(): boolean {
    return !this.stopped
  }

  // (Re)targets the subscriber. Null stops it. Changing target resets
  // since/dedupe state so ids from another topic can't suppress delivery.
  update(target: NtfyTarget | null): void {
    const key = target ? `${target.baseUrl} ${target.topic}` : ""
    const current = this.target ? `${this.target.baseUrl} ${this.target.topic}` : ""
    if (key === current && (target ? !this.stopped : this.stopped)) return
    this.stopTimers()
    this.target = target ? { baseUrl: target.baseUrl.replace(/\/+$/, ""), topic: target.topic } : null
    this.seen = new Set()
    this.seenOrder = []
    this.lastId = null
    this.baselined = false
    this.attempts = 0
    if (!this.target) {
      this.stopped = true
      return
    }
    this.stopped = false
    this.startedAt = Date.now()
    void this.poll(this.epoch)
  }

  stop(): void {
    this.stopTimers()
    this.target = null
    this.stopped = true
  }

  // Immediate re-poll, bypassing backoff/interval. Called on app foreground
  // (mirrors the SSE reconnectNow in _layout.tsx) — timers were frozen while
  // backgrounded, so waiting them out just adds latency.
  reconnectNow(): void {
    if (this.stopped || !this.target) return
    this.stopTimers()
    this.attempts = 0
    void this.poll(this.epoch)
  }

  private stopTimers(): void {
    this.epoch += 1
    this.controller?.abort()
    this.controller = null
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private remember(n: NtfyNotification): boolean {
    const key = keyOf(n)
    if (this.seen.has(key)) return false
    this.seen.add(key)
    this.seenOrder.push(key)
    if (this.seenOrder.length > SEEN_CAP) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seen.delete(oldest)
    }
    if (n.ntfyId) this.lastId = n.ntfyId
    return true
  }

  private ingest(body: string): void {
    const fresh: NtfyNotification[] = []
    const trimmed = body.trim()
    if (!trimmed) return
    // ntfy answers poll requests with NDJSON lines; accept a bare JSON
    // array too in case of server/proxy variation.
    if (trimmed.startsWith("[")) {
      let arr: unknown
      try {
        arr = JSON.parse(trimmed)
      } catch {
        return
      }
      if (!Array.isArray(arr)) return
      for (const item of arr) {
        const n = parseNtfyObject(item)
        if (n) fresh.push(n)
      }
    } else {
      for (const line of trimmed.split("\n")) {
        const n = parseNtfyLine(line)
        if (n) fresh.push(n)
      }
    }
    for (const n of fresh) {
      if (!this.baselined) {
        // First successful poll: swallow cache history older than launch,
        // deliver anything fresh (e.g. a just-published test message).
        this.remember(n)
        if (n.time === 0 || n.time * 1000 >= this.startedAt - START_SKEW_MS) this.notify(n)
        continue
      }
      if (this.remember(n)) this.notify(n)
    }
    this.baselined = true
  }

  private schedule(delayMs: number, epoch: number): void {
    if (this.stopped || epoch !== this.epoch) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.poll(epoch)
    }, delayMs)
  }

  private async poll(epoch: number): Promise<void> {
    const target = this.target
    if (this.stopped || !target || epoch !== this.epoch) return
    this.controller = new AbortController()
    const signal = this.controller.signal
    const url =
      `${target.baseUrl}/${encodeURIComponent(target.topic)}/json?poll=1` +
      (this.lastId ? `&since=${encodeURIComponent(this.lastId)}` : "")
    try {
      const res = await this.fetchImpl(url, { signal, headers: { Accept: "application/json" } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      this.ingest(await res.text())
      this.attempts = 0
      console.log("[ntfy] Poll ok")
    } catch (err) {
      if (signal.aborted || this.stopped) return
      this.attempts += 1
      const base = this.backoff[Math.min(this.attempts - 1, this.backoff.length - 1)]
      const delay = Math.min(MAX_DELAY_MS, Math.round(base * (0.75 + Math.random() * 0.5)))
      console.warn(`[ntfy] Poll failed, retrying in ${delay}ms:`, err)
      this.schedule(delay, epoch)
      return
    }
    this.schedule(this.intervalMs, epoch)
  }
}
