import { NativeModules, Platform } from "react-native"
import { connectionPassword, useConnections } from "../stores/connections"
import { useSessionWatch } from "../stores/session-watch"

// JS bridge for the native SessionMonitorService (android/.../SessionMonitorService.kt).
//
// Honest costs (surfaced verbatim in Settings copy):
// - A persistent, non-dismissible notification ("Watching N session(s)") for
//   as long as the service runs — Android mandates it for foreground services.
// - Extra battery/network use: one poll round per watched session every
//   POLL_INTERVAL_SEC (60s) over the Tailnet.
// - What it buys: timely delivery while backgrounded AND after the app is
//   swiped away (the service restarts with the same config). It does NOT
//   survive Force stop or reboot — reopening the app re-sends the config.
// - Android 14+ may still defer exact timing under extreme battery saver,
//   but a foreground service is exempt from Doze in the normal case.
// - iOS has no equivalent here: background delivery on iOS is the ~15-minute
//   periodic check only.

export const POLL_INTERVAL_SEC = 60

interface NativeBridge {
  start: (config: { targets: string; intervalSec: number }) => Promise<boolean>
  stop: () => Promise<boolean>
  isRunning: () => Promise<boolean>
}

function bridge(): NativeBridge | null {
  if (Platform.OS !== "android") return null
  const mod = (NativeModules as Record<string, unknown>).SessionMonitor as NativeBridge | undefined
  return mod ?? null
}

export const foregroundServiceSupported = Platform.OS === "android"

// (Re)start the service when enabled, stop it when disabled or when there is
// nothing to watch. Called from Settings toggles and from _layout whenever
// the watch list or connections change. Idempotent: starting with identical
// config just refreshes the persistent notification.
export async function syncForegroundService(enabled: boolean): Promise<{ running: boolean; reason: string }> {
  const mod = bridge()
  if (!mod) return { running: false, reason: "unsupported" }
  if (!enabled) {
    await mod.stop().catch(() => undefined)
    return { running: false, reason: "disabled" }
  }
  const { watched } = useSessionWatch.getState()
  const { connections } = useConnections.getState()
  if (watched.length === 0 || connections.length === 0) {
    await mod.stop().catch(() => undefined)
    return { running: false, reason: "nothing-watched" }
  }
  const watchedByConn = new Map<string, typeof watched>()
  for (const w of watched) {
    const list = watchedByConn.get(w.connectionId) ?? []
    list.push(w)
    watchedByConn.set(w.connectionId, list)
  }
  const targets: Array<{
    baseUrl: string
    connectionId: string
    username: string
    password: string
    api: string
    sessions: Array<{ sessionId: string; title: string }>
  }> = []
  for (const conn of connections) {
    const mine = watchedByConn.get(conn.id)
    if (!mine || mine.length === 0) continue
    const password = conn.username ? await connectionPassword(conn.id) : null
    targets.push({
      baseUrl: conn.url,
      connectionId: conn.id,
      username: conn.username ?? "",
      // Credentials travel in the start-intent extras (memory only — the
      // service never writes them to disk). A connection without a stored
      // password still polls when it needs no auth (password "").
      password: password ?? "",
      api: conn.api ?? "v2",
      sessions: mine.map((w) => ({ sessionId: w.sessionId, title: w.title ?? "" })),
    })
  }
  if (targets.length === 0) {
    await mod.stop().catch(() => undefined)
    return { running: false, reason: "nothing-watched" }
  }
  try {
    await mod.start({ targets: JSON.stringify(targets), intervalSec: POLL_INTERVAL_SEC })
    return { running: true, reason: "started" }
  } catch (err) {
    console.warn("[watch] foreground service start failed:", err)
    return { running: false, reason: "start-failed" }
  }
}

export async function stopForegroundService(): Promise<void> {
  await bridge()?.stop().catch(() => undefined)
}

export async function foregroundServiceRunning(): Promise<boolean> {
  const mod = bridge()
  if (!mod) return false
  return mod.isRunning().catch(() => false)
}
