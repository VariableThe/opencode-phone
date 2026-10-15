import { create } from "zustand"
import { send as notify } from "../lib/notifications"
import { buildTestPublishBody, categoryForType, NtfySubscriber, type NtfyNotification } from "../lib/ntfy"
import { useSettings } from "./settings"

// Bridges the ntfy poll subscriber into the app's EXISTING notification path
// (lib/notifications send()): same categories, same per-category prefs, same
// tap-to-session routing wired in app/_layout.tsx. No second mechanism.
//
// Note send() intentionally suppresses while the app is foregrounded (the
// in-app permission/question prompts already cover that case) — so an ntfy
// message received in the foreground records lastReceived but may not post
// a system notification. That matches the SSE path's behaviour.

interface LastReceived {
  title: string
  type: string
  at: number
}

interface NtfyState {
  running: boolean
  lastError: string | null
  lastReceived: LastReceived | null
  /** Start/stop the subscriber to match the current ntfy settings. */
  sync: () => void
  /** Immediate re-poll (foreground resume). Mirrors SSE reconnectNow. */
  reconnectNow: () => void
  /**
   * Publish a test message to the configured topic and wait for our own
   * subscriber to receive it back (round-trip proof). Resolves ok:false
   * with a human-readable detail on publish failure or timeout.
   */
  publishTest: () => Promise<{ ok: boolean; detail: string }>
}

// Round-trip wait: two poll intervals plus margin for the publish to land.
const ROUND_TRIP_TIMEOUT_MS = 25_000
const ROUND_TRIP_POLL_MS = 500

function forward(n: NtfyNotification): void {
  useNtfy.setState({ lastReceived: { title: n.title, type: n.type, at: Date.now() }, lastError: null })
  void notify({
    category: categoryForType(n.type),
    title: n.title,
    body: n.body,
    sessionId: n.sessionID,
    dedupeKey: `ntfy-${n.ntfyId || `${n.at}-${n.sessionID}-${n.type}`}`,
    dedupeCooldownMs: 60_000,
  })
}

const subscriber = new NtfySubscriber(forward)

async function waitForRoundTrip(mark: number): Promise<boolean> {
  const deadline = Date.now() + ROUND_TRIP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const last = useNtfy.getState().lastReceived
    if (last && last.at >= mark) return true
    await new Promise((resolve) => setTimeout(resolve, ROUND_TRIP_POLL_MS))
  }
  return false
}

export const useNtfy = create<NtfyState>((set, get) => ({
  running: false,
  lastError: null,
  lastReceived: null,

  sync: () => {
    // Idempotent by construction: subscriber.update() early-returns when the
    // target is unchanged, so repeated sync() calls (StrictMode remount,
    // settings reload after SecureStore load, publishTest) never fork a
    // second poll chain — and any residual overlap is killed by the
    // subscriber's epoch guard (see lib/ntfy.ts).
    const ntfy = useSettings.getState().ntfy
    if (!ntfy.enabled || !ntfy.baseUrl.trim() || !ntfy.topic.trim()) {
      subscriber.stop()
      if (get().running) set({ running: false })
      return
    }
    subscriber.update({ baseUrl: ntfy.baseUrl.trim(), topic: ntfy.topic.trim() })
    if (!get().running) set({ running: true, lastError: null })
  },

  reconnectNow: () => {
    subscriber.reconnectNow()
  },

  publishTest: async () => {
    const ntfy = useSettings.getState().ntfy
    const baseUrl = ntfy.baseUrl.trim().replace(/\/+$/, "")
    const topic = ntfy.topic.trim()
    if (!baseUrl || !topic) return { ok: false, detail: "ntfy server URL or topic is empty" }
    const at = new Date().toISOString()
    // Same wire shape oc-notify publishes (see oc-notify/src/payload.ts
    // buildNtfyBody and buildTestPublishBody in lib/ntfy.ts): the envelope
    // JSON-encoded inside `message` is the authoritative carrier.
    const body = JSON.stringify(buildTestPublishBody(topic, at))
    const mark = Date.now()
    try {
      const res = await fetch(`${baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      if (!res.ok) return { ok: false, detail: `publish failed: HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, detail: `publish failed: ${err instanceof Error ? err.message : String(err)}` }
    }
    // The subscriber must be running to observe the round trip.
    get().sync()
    const seen = await waitForRoundTrip(mark)
    if (seen) return { ok: true, detail: "received back via the topic poll" }
    set({ lastError: "test message published but not received within 25s" })
    return { ok: false, detail: "published, but nothing came back within 25s — is the listener running and the topic correct?" }
  },
}))
