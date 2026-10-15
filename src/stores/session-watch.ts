import AsyncStorage from "@react-native-async-storage/async-storage"
import { AppState } from "react-native"
import * as SecureStore from "expo-secure-store"
import { create } from "zustand"
import { send as notify } from "../lib/notifications"
import { sanitizeBody } from "../lib/notify-format"
import { alertKey, classifySettlement } from "../lib/session-settlement"
import { createClient } from "../lib/sdk"
import type { Client } from "../lib/sdk"
import { useConnections } from "./connections"
import { useEvents } from "./events"
import { abortedSessions } from "./sessions"

// Server-driven notification evaluator + periodic watcher.
//
// The reference design (alvarolorentedev/opencode-mobile — see
// THIRD_PARTY_NOTICES) keeps a settlement-gated "should notify" store: only
// finished/failed/needs-input sessions alert, aborted runs are dropped. This
// is that store, adapted to this codebase's server API:
//
// - Watched sessions are recorded when the user sends a prompt (sessions.ts
//   sendMessage -> track) and dropped on abort or terminal settlement.
// - The live SSE path (stores/events.ts) owns alerting while the app is
//   foregrounded and connected; evaluateNow() covers everything else
//   (backgrounded app, dead SSE stream, background-fetch task, foreground
//   service tick) and shares the same alert-key scheme + persisted seen-set,
//   so the two paths cannot double-fire across a restart.
// - Records are NON-SECRET (connection id, session id, title, directory).
//   Credentials are never stored here — evaluateNow() reuses the live client,
//   and the background entry rebuilds one from SecureStore like
//   connections.loadConnections does.

export interface WatchedSession {
  connectionId: string
  sessionId: string
  directory?: string
  title?: string
  requestedAt: number
}

const WATCH_KEY = "opencode_watch_sessions"
const SEEN_KEY = "opencode_watch_seen"
const SEEN_CAP = 500

// Minimal structural view of server rows — only the fields the evaluator reads.
interface PendingPrompt {
  id: string
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key).catch(() => null)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined)
}

function rememberKey(seen: string[], key: string): string[] {
  if (seen.includes(key)) return seen
  const next = [...seen, key]
  return next.length > SEEN_CAP ? next.slice(next.length - SEEN_CAP) : next
}

interface WatchState {
  watched: WatchedSession[]
  seen: string[]
  hydrated: boolean
  hydrate: () => Promise<void>
  track: (session: Omit<WatchedSession, "requestedAt">) => void
  untrack: (connectionId: string, sessionId: string) => void
  /** Drop every record for a session id across connections (abort path). */
  dropSession: (sessionId: string) => void
  /** Record an alert key fired by the SSE path so later passes stay silent. */
  markSent: (key: string) => void
  /** A new run started — re-arm finished/failed alerts for that session. */
  resetTerminal: (connectionId: string, sessionId: string) => void
  /**
   * Re-check every watched session on the active connection against the
   * server and notify on finished/failed/needs-input. Skipped while the app
   * is foregrounded with a live SSE stream — that path owns alerting then.
   */
  evaluateNow: (reason: string) => Promise<{ checked: number; notified: number; skipped: string | null }>
}

export const useSessionWatch = create<WatchState>((set, get) => ({
  watched: [],
  seen: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    const [watched, seen] = await Promise.all([
      readJson<WatchedSession[]>(WATCH_KEY, []),
      readJson<string[]>(SEEN_KEY, []),
    ])
    set({ watched, seen, hydrated: true })
  },

  track: (session) => {
    const watched = get().watched.filter(
      (w) => !(w.connectionId === session.connectionId && w.sessionId === session.sessionId),
    )
    watched.push({ ...session, requestedAt: Date.now() })
    set({ watched })
    void writeJson(WATCH_KEY, watched)
  },

  untrack: (connectionId, sessionId) => {
    const watched = get().watched.filter((w) => !(w.connectionId === connectionId && w.sessionId === sessionId))
    set({ watched })
    void writeJson(WATCH_KEY, watched)
  },

  dropSession: (sessionId) => {
    const watched = get().watched.filter((w) => w.sessionId !== sessionId)
    set({ watched })
    void writeJson(WATCH_KEY, watched)
  },

  markSent: (key) => {
    const seen = rememberKey(get().seen, key)
    set({ seen })
    void writeJson(SEEN_KEY, seen)
  },

  resetTerminal: (connectionId, sessionId) => {
    const prefix = `watch:${connectionId}:${sessionId}:`
    const seen = get().seen.filter((k) => !(k.startsWith(prefix) && (k.endsWith(":finished") || k.endsWith(":failed"))))
    set({ seen })
    void writeJson(SEEN_KEY, seen)
  },

  evaluateNow: async (reason) => {
    await get().hydrate()
    const conn = useConnections.getState()
    const client = conn.client
    const active = conn.activeConnection
    if (!client || !active) return { checked: 0, notified: 0, skipped: "no-client" }

    // The live SSE path owns alerting while it is connected in the
    // foreground. Evaluating on top of it would double-fire (both paths
    // would claim unseen keys for the same transition), so only cover the
    // gaps: backgrounded app, or foreground with a dead stream.
    if (!reason.startsWith("background") && AppState.currentState === "active" && useEvents.getState().connected) {
      return { checked: 0, notified: 0, skipped: "sse-live" }
    }

    const mine = get().watched.filter((w) => w.connectionId === active.id)
    if (mine.length === 0) return { checked: 0, notified: 0, skipped: null }

    let sessions: Array<{ id: string; title?: string }> = []
    try {
      sessions = await client.session.list()
    } catch (err) {
      console.warn("[watch] session list failed:", err)
      return { checked: 0, notified: 0, skipped: "list-failed" }
    }
    const byId = new Map(sessions.map((s) => [s.id, s]))

    let notified = 0
    for (const watch of mine) {
      const row = byId.get(watch.sessionId)
      const outcome = await evaluateOne(client, watch, row?.title ?? watch.title)
      if (outcome === "notified") notified++
    }
    return { checked: mine.length, notified, skipped: null }
  },
}))

// Classify one watched session with fresh server signal and notify when the
// settlement warrants it. Returns "notified" only when an alert fired.
async function evaluateOne(
  client: Client,
  watch: WatchedSession,
  title: string | undefined,
): Promise<"notified" | "silent"> {
  const state = useSessionWatch.getState()
  const scope = watch.connectionId
  const seen = (key: string): boolean => state.seen.includes(key)
  const claim = (key: string): boolean => {
    if (state.seen.includes(key)) return false
    state.markSent(key)
    return true
  }

  // Fresh pending prompts — the needs-input signal. Listed per session so a
  // prompt answered elsewhere (or a session deleted) is observed here even
  // when its SSE event was missed.
  const [perms, forms] = await Promise.all([
    client.permission.list(watch.sessionId).catch(() => [] as PendingPrompt[]),
    client.question.list(watch.sessionId).catch(() => [] as PendingPrompt[]),
  ])
  const permRows = (perms || []) as Array<PendingPrompt & { permission?: string; patterns?: string[] }>
  const formRows = (forms || []) as Array<PendingPrompt & { questions?: Array<{ header?: string; question?: string }> }>

  const blockedKey = (id: string): string => alertKey(scope, watch.sessionId, "blocked", id)
  const unseenPerm = permRows.find((p) => p.id && !seen(blockedKey(p.id)))
  const unseenForm = formRows.find((f) => f.id && !seen(blockedKey(f.id)))
  const pendingInput = permRows.length > 0 || formRows.length > 0

  // Terminal evidence from the message tail: a watched session starts running
  // at prompt time, so only a terminated final assistant message settles it.
  // Anything else (user message last, still streaming) means still busy.
  // A 404 on the tail means the session was deleted -> drop silently.
  let rows: Array<{ info: { role: string; time?: { completed?: number }; error?: { message?: string } } }>
  try {
    rows = (await client.session.messages(watch.sessionId, { limit: 3 })) as unknown as typeof rows
  } catch (err) {
    const gone = /\b404\b/.test(err instanceof Error ? err.message : String(err))
    if (gone) state.untrack(scope, watch.sessionId)
    return "silent" // deleted (dropped) or transient failure — keep watching
  }
  const infos = rows.map((m) => m.info)
  const last = infos[infos.length - 1]
  const terminal =
    last && last.role === "assistant" && (last.time?.completed || last.error) ? { errored: Boolean(last.error) } : null

  const settled = classifySettlement({
    status: terminal ? "idle" : pendingInput ? "busy" : undefined,
    pendingInput,
    errored: terminal?.errored ?? false,
    aborted: abortedSessions.has(watch.sessionId),
    exists: true,
  })

  if (!terminal && !pendingInput) {
    // No terminal evidence and still present: still running (or unknown) —
    // suppress and keep watching.
    return "silent"
  }

  if (settled === "blocked") {
    // Fire once per outstanding prompt: prefer the unseen permission first,
    // then the unseen form. Polls of an already-announced prompt stay silent.
    const perm = unseenPerm
    if (perm && claim(blockedKey(perm.id))) {
      const detail = perm.permission
        ? perm.patterns?.length
          ? `${perm.permission}: ${perm.patterns.join(", ")}`
          : perm.permission
        : perm.patterns?.join(", ")
      await fire("permissions", "Agent needs approval", sanitizeBody(detail, "A tool needs your approval"), watch, scope)
      return "notified"
    }
    const form = unseenForm
    if (form && claim(blockedKey(form.id))) {
      await fire(
        "questions",
        form.questions?.[0]?.header || "Input needed",
        sanitizeBody(form.questions?.[0]?.question, "The assistant has a question"),
        watch,
        scope,
      )
      return "notified"
    }
    return "silent"
  }

  if (settled === "finished" || settled === "failed") {
    const key = alertKey(scope, watch.sessionId, settled)
    if (!claim(key)) return "silent"
    if (settled === "finished") {
      await fire("completed", "Task completed", sanitizeBody(title, "Session finished processing"), watch, scope)
    } else {
      await fire("errors", "Session error", sanitizeBody(title, "Something went wrong"), watch, scope)
    }
    // Terminal: stop polling this session. A later prompt re-tracks it.
    state.untrack(scope, watch.sessionId)
    return "notified"
  }

  return "silent"
}

async function fire(
  category: "permissions" | "questions" | "completed" | "errors",
  title: string,
  body: string,
  watch: WatchedSession,
  scope: string,
): Promise<void> {
  await notify({
    category,
    title,
    body,
    sessionId: watch.sessionId,
    connectionId: scope,
  })
}

// Rebuild a client for the background-fetch task, which may run in a JS
// context where the zustand stores were never hydrated (app killed). Mirrors
// connections.loadConnections: connections record (with the `active` flag and
// probed `api`) in SecureStore under opencode_connections, passwords under
// opencode_password_<id>. Evaluates every watched session on EVERY stored
// connection — not just the active one — because a task started on one server
// survives switching to another (same keying rule as the reference design).
export async function evaluateAllConnectionsBackground(): Promise<{ checked: number; notified: number }> {
  const store = useSessionWatch.getState()
  await store.hydrate()
  if (store.watched.length === 0) return { checked: 0, notified: 0 }

  const raw = await SecureStore.getItemAsync("opencode_connections").catch(() => null)
  if (!raw) return { checked: 0, notified: 0 }
  let connections: Array<{
    id: string
    url: string
    directory?: string
    username?: string
    api?: "v1" | "v2"
  }> = []
  try {
    connections = JSON.parse(raw)
  } catch {
    return { checked: 0, notified: 0 }
  }

  let checked = 0
  let notified = 0
  const watchedByConn = new Map<string, WatchedSession[]>()
  for (const w of store.watched) {
    const list = watchedByConn.get(w.connectionId) ?? []
    list.push(w)
    watchedByConn.set(w.connectionId, list)
  }

  for (const conn of connections) {
    const mine = watchedByConn.get(conn.id)
    if (!mine || mine.length === 0) continue
    const password = conn.username
      ? await SecureStore.getItemAsync(`opencode_password_${conn.id}`).catch(() => null)
      : null
    const client = createClient({
      baseUrl: conn.url,
      directory: conn.directory,
      ...(conn.username && password ? { auth: { username: conn.username, password } } : {}),
      ...(conn.api ? { api: conn.api } : {}),
    })
    for (const watch of mine) {
      checked++
      if ((await evaluateOneBackground(client, watch)) === "notified") notified++
    }
  }
  return { checked, notified }
}

// Background-context variant of evaluateOne: identical settlement rules, but
// the message-tail probe doubles as the existence check (a 404 rejects, which
// means deleted -> drop silently) instead of relying on a list row.
async function evaluateOneBackground(client: Client, watch: WatchedSession): Promise<"notified" | "silent"> {
  const state = useSessionWatch.getState()
  const scope = watch.connectionId

  const [perms, forms] = await Promise.all([
    client.permission.list(watch.sessionId).catch(() => null),
    client.question.list(watch.sessionId).catch(() => null),
  ])
  // A null list read is a network/auth failure, not an empty prompt box —
  // keep the record for a later run instead of settling on partial signal.
  if (perms === null || forms === null) return "silent"
  const permRows = (perms || []) as Array<PendingPrompt & { permission?: string; patterns?: string[] }>
  const formRows = (forms || []) as Array<PendingPrompt & { questions?: Array<{ header?: string; question?: string }> }>
  const pendingInput = permRows.length > 0 || formRows.length > 0

  // The evaluator is the single source of "should notify" here too: blocked
  // with an unseen prompt id notifies, everything else falls through to the
  // terminal-evidence probe below. (Existence comes from the tail probe's 404
  // -> dropped, so no exists:false branch is needed here.)
  if (pendingInput && classifySettlement({ pendingInput, errored: false, aborted: false, exists: true }) === "blocked") {
    const unseenPerm = permRows.find((p) => p.id && !state.seen.includes(alertKey(scope, watch.sessionId, "blocked", p.id)))
    if (unseenPerm) {
      const key = alertKey(scope, watch.sessionId, "blocked", unseenPerm.id)
      state.markSent(key)
      const detail = unseenPerm.permission
        ? unseenPerm.patterns?.length
          ? `${unseenPerm.permission}: ${unseenPerm.patterns.join(", ")}`
          : unseenPerm.permission
        : unseenPerm.patterns?.join(", ")
      await fire("permissions", "Agent needs approval", sanitizeBody(detail, "A tool needs your approval"), watch, scope)
      return "notified"
    }
    const unseenForm = formRows.find((f) => f.id && !state.seen.includes(alertKey(scope, watch.sessionId, "blocked", f.id)))
    if (unseenForm) {
      const key = alertKey(scope, watch.sessionId, "blocked", unseenForm.id)
      state.markSent(key)
      await fire(
        "questions",
        unseenForm.questions?.[0]?.header || "Input needed",
        sanitizeBody(unseenForm.questions?.[0]?.question, "The assistant has a question"),
        watch,
        scope,
      )
      return "notified"
    }
    return "silent"
  }

  const tail = await client.session.messages(watch.sessionId, { limit: 3 }).catch((err: unknown) => {
    // A 404 means the session was deleted -> drop silently. Any other
    // failure is transient (or auth): keep the record for a later run.
    if (/\b404\b/.test(err instanceof Error ? err.message : String(err))) return "gone" as const
    return null
  })
  if (tail === "gone") {
    state.untrack(scope, watch.sessionId)
    return "silent"
  }
  if (tail === null) {
    // Ambiguous transient failure — keep watching. A deleted session can
    // never produce a terminal tail, so this never notifies wrongly; the
    // next foreground evaluate confirms deletion via its own probe.
    return "silent"
  }
  const infos = (tail || []).map((m) => m.info)
  const last = infos[infos.length - 1]
  const terminal =
    last && last.role === "assistant" && (last.time?.completed || last.error) ? { errored: Boolean(last.error) } : null
  // Single source of "should notify": only a terminal tail settles here.
  const settled = classifySettlement({
    status: terminal ? "idle" : undefined,
    pendingInput: false,
    errored: terminal?.errored ?? false,
    aborted: false,
    exists: true,
  })
  if (settled !== "finished" && settled !== "failed") return "silent"

  const key = alertKey(scope, watch.sessionId, settled)
  if (state.seen.includes(key)) return "silent"
  state.markSent(key)
  if (settled === "finished") {
    await fire("completed", "Task completed", sanitizeBody(watch.title, "Session finished processing"), watch, scope)
  } else {
    const detail = terminal && terminal.errored ? infos[infos.length - 1].error?.message || watch.title : watch.title
    await fire("errors", "Session error", sanitizeBody(detail, "Something went wrong"), watch, scope)
  }
  state.untrack(scope, watch.sessionId)
  return "notified"
}
