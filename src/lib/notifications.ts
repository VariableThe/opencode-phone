import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Platform, AppState } from "react-native"

// ---------------------------------------------------------------------------
// Categories — every notification belongs to exactly one
// ---------------------------------------------------------------------------

export const categories = ["permissions", "questions", "completed", "errors", "connection"] as const
export type Category = (typeof categories)[number]

// Per-category metadata used by both the notification module and the settings UI.
// label/description are i18next keys (not display strings) — this module loads
// before i18next is guaranteed to be ready, so callers (e.g. settings.tsx) resolve
// them with t() at render time instead of reading literal text here.
export const categoryMeta: Record<Category, { labelKey: string; descriptionKey: string; icon: string }> = {
  permissions: {
    labelKey: "notifications.categories.permissions.label",
    descriptionKey: "notifications.categories.permissions.description",
    icon: "shield-checkmark",
  },
  questions: {
    labelKey: "notifications.categories.questions.label",
    descriptionKey: "notifications.categories.questions.description",
    icon: "help-circle",
  },
  completed: {
    labelKey: "notifications.categories.completed.label",
    descriptionKey: "notifications.categories.completed.description",
    icon: "checkmark-circle",
  },
  errors: {
    labelKey: "notifications.categories.errors.label",
    descriptionKey: "notifications.categories.errors.description",
    icon: "alert-circle",
  },
  connection: {
    labelKey: "notifications.categories.connection.label",
    descriptionKey: "notifications.categories.connection.description",
    icon: "wifi",
  },
}

// Default state — permissions, questions, completions, errors and connection
// alerts on. Completion alerts are the point of backgrounding the app: the
// user asked to be told when the agent finishes responding. (send() still
// suppresses while the app is foregrounded — deliberate, see below.)
export const defaultPreferences: Record<Category, boolean> = {
  permissions: true,
  questions: true,
  completed: true,
  errors: true,
  connection: true,
}

// ---------------------------------------------------------------------------
// Notification payload — what callers pass in
// ---------------------------------------------------------------------------

export interface Payload {
  category: Category
  title: string
  body: string
  sessionId: string
  // Non-secret routing scope: the owning connection's id, so a tap can
  // switch back to the connection the session belongs to before opening it.
  // Never credentials — resolution happens against stored connections.
  connectionId?: string
  dedupeKey?: string
  dedupeCooldownMs?: number
}

// Data embedded in the notification for tap handling. Exported so the root
// layout's tap router can type its handler.
export interface NotificationData {
  category: Category
  sessionId: string
  connectionId?: string
}

// ---------------------------------------------------------------------------
// Preferences accessor — injected to avoid circular imports with the store
// ---------------------------------------------------------------------------

type PreferencesAccessor = () => Record<Category, boolean>

let preferences: PreferencesAccessor = () => defaultPreferences
const dedupeSentAt = new Map<string, number>()

export function configure(accessor: PreferencesAccessor) {
  preferences = accessor
}

// ---------------------------------------------------------------------------
// Setup & permissions
// ---------------------------------------------------------------------------

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function setup(): Promise<boolean> {
  if (!Device.isDevice) return false

  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === "granted") {
    await ensureChannel()
    return true
  }

  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== "granted") return false

  await ensureChannel()
  return true
}

export async function granted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  return status === "granted"
}

async function ensureChannel() {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync("prompts", {
    name: "Session Prompts & Updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  })
}

// ---------------------------------------------------------------------------
// Send — single entry point, decides whether to fire
// ---------------------------------------------------------------------------

export async function send(payload: Payload) {
  const prefs = preferences()
  if (!prefs[payload.category]) return
  if (AppState.currentState === "active") return
  if (!(await granted())) return

  if (payload.dedupeKey) {
    const now = Date.now()
    const lastSent = dedupeSentAt.get(payload.dedupeKey) || 0
    const cooldown = payload.dedupeCooldownMs ?? 30_000
    if (now - lastSent < cooldown) return
    dedupeSentAt.set(payload.dedupeKey, now)
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: payload.title,
      body: payload.body,
      data: {
        category: payload.category,
        sessionId: payload.sessionId,
        ...(payload.connectionId ? { connectionId: payload.connectionId } : {}),
      } satisfies NotificationData as Record<string, unknown>,
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "prompts" } : {}),
    },
    trigger: null,
  })
}

// ---------------------------------------------------------------------------
// Tap handler — returns cleanup function
// ---------------------------------------------------------------------------

export function onTap(handler: (data: NotificationData) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const raw = response.notification.request.content.data
    const data = raw as unknown as NotificationData | undefined
    if (!data) return
    if (data.sessionId || data.category === "connection") {
      handler({ category: data.category, sessionId: data.sessionId, connectionId: data.connectionId })
    }
  })
  return () => subscription.remove()
}

// Last-notification tap when the app was killed: expo-router handles the
// deep link itself for warm taps, but a killed app needs the stored response.
export async function lastTap(): Promise<NotificationData | null> {
  const response = await Notifications.getLastNotificationResponseAsync()
  if (!response) return null
  const data = response.notification.request.content.data as unknown as NotificationData | undefined
  if (!data || (!data.sessionId && data.category !== "connection")) return null
  return { category: data.category, sessionId: data.sessionId, connectionId: data.connectionId }
}
