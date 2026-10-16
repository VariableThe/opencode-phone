import { Platform } from "react-native"
import * as BackgroundFetch from "expo-background-fetch"
import * as TaskManager from "expo-task-manager"

// Periodic background re-check for watched sessions.
//
// Honest limits (surfaced verbatim in Settings copy):
// - Android delivers these runs through JobScheduler with a ~15 minute
//   minimum interval, deferred further under Doze/battery-saver. This is a
//   safety net, not timely delivery — expect completion alerts minutes late.
// - iOS grants background time opportunistically (BGAppRefresh); a completion
//   is delivered when the system next runs us, not immediately.
// - When the app is force-stopped (swiped away + Force stop, or "killed"),
//   the OS may never run this task until the app is opened again. Timely
//   killed-app delivery needs the Android foreground service instead
//   (android/.../SessionMonitorService.kt), which the user can enable in
//   Settings — at the cost of a persistent notification.
//
// The task body rebuilds server clients from SecureStore (see
// evaluateAllConnectionsBackground) because the zustand stores may never have
// hydrated in this JS context. It notifies through the same send() path with
// the same alert keys, so it can neither double-fire with the SSE path nor
// re-fire after a restart.

const TASK_NAME = "opencode-session-watch"
export const BACKGROUND_POLL_MIN_MINUTES = 15

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const { useSettings } = await import("../stores/settings")
      if (!useSettings.getState().backgroundPoll) return BackgroundFetch.BackgroundFetchResult.NoData
      const { evaluateAllConnectionsBackground } = await import("../stores/session-watch")
      const { notified } = await evaluateAllConnectionsBackground()
      return notified > 0 ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData
    } catch (err) {
      console.warn("[watch] background evaluation failed:", err)
      return BackgroundFetch.BackgroundFetchResult.Failed
    }
  })
}

export async function syncBackgroundPoll(enabled: boolean): Promise<void> {
  if (Platform.OS === "web") return
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME).catch(() => false)
  if (enabled && !registered) {
    await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: BACKGROUND_POLL_MIN_MINUTES * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    }).catch((err) => console.warn("[watch] background task registration failed:", err))
    return
  }
  if (!enabled && registered) {
    await BackgroundFetch.unregisterTaskAsync(TASK_NAME).catch(() => undefined)
  }
}

export async function backgroundPollStatus(): Promise<{ registered: boolean; status: string }> {
  if (Platform.OS === "web") return { registered: false, status: "unsupported" }
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME).catch(() => false)
  const raw = await BackgroundFetch.getStatusAsync().catch(() => null)
  const label =
    raw === BackgroundFetch.BackgroundFetchStatus.Available
      ? "available"
      : raw === BackgroundFetch.BackgroundFetchStatus.Denied
        ? "denied"
        : raw === BackgroundFetch.BackgroundFetchStatus.Restricted
          ? "restricted"
          : "unknown"
  return { registered, status: label }
}
