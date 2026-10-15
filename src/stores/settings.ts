import { create } from "zustand"
import * as SecureStore from "expo-secure-store"
import { type Category, defaultPreferences } from "../lib/notifications"
import { clampPageSize, mergeStoredSettings } from "../lib/settings-merge"
import { setAppLocale } from "../lib/i18n/config"
import type { LocalePreference } from "../lib/i18n/locale-resolve"

const SETTINGS_KEY = "opencode_settings"

export interface NtfySettings {
  enabled: boolean
  baseUrl: string
  topic: string
}

// Default is intentionally empty — the Tailscale address of the self-hosted
// ntfy server is filled in by QR onboarding / setup-host.sh and stays
// user-overridable (never hard-code it at call sites).
export const DEFAULT_NTFY: NtfySettings = {
  enabled: false,
  baseUrl: "",
  topic: "oc-phone",
}

interface Settings {
  pageSize: number
  notifications: Record<Category, boolean>
  locale: LocalePreference
  ntfy: NtfySettings
  // In-app/background transport (no extra service): periodic re-check of
  // watched sessions while backgrounded. Default on — it is cheap (a few
  // HTTP reads every ~15 min, OS-throttled) and the only delivery path that
  // survives backgrounding without ntfy or the foreground service.
  backgroundPoll: boolean
  // Android foreground service: keeps a native poll loop alive for timely
  // delivery at the cost of a persistent notification. Default off.
  foregroundService: boolean
  // Paint the UI from the active server's opencode theme (bridge GET /theme)
  // instead of the device dark/light defaults. Silent fallback to the
  // defaults when the server has no theme or the fetch fails.
  matchServerTheme: boolean
}

const DEFAULTS: Settings = {
  pageSize: 25,
  notifications: { ...defaultPreferences },
  locale: "system",
  ntfy: { ...DEFAULT_NTFY },
  backgroundPoll: true,
  foregroundService: false,
  matchServerTheme: true,
}

interface SettingsState extends Settings {
  loaded: boolean
  load: () => Promise<void>
  setPageSize: (size: number) => Promise<void>
  setNotification: (category: Category, enabled: boolean) => Promise<void>
  setLocale: (locale: LocalePreference) => Promise<void>
  setNtfyEnabled: (enabled: boolean) => Promise<void>
  setNtfy: (patch: Partial<NtfySettings>) => Promise<void>
  setBackgroundPoll: (enabled: boolean) => Promise<void>
  setForegroundService: (enabled: boolean) => Promise<void>
  setMatchServerTheme: (enabled: boolean) => Promise<void>
}

function snapshot(get: () => SettingsState): Settings {
  return {
    pageSize: get().pageSize,
    notifications: get().notifications,
    locale: get().locale,
    ntfy: get().ntfy,
    backgroundPoll: get().backgroundPoll,
    foregroundService: get().foregroundService,
    matchServerTheme: get().matchServerTheme,
  }
}

async function persist(settings: Settings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings))
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      // Merge stored settings with defaults so new fields/categories get their default
      const merged = mergeStoredSettings(DEFAULTS, parsed)
      // mergeStoredSettings only deep-merges notifications — ntfy needs the
      // same upgrade-path treatment so a partial stored object can't leave
      // baseUrl/topic undefined for users of older builds.
      merged.ntfy = { ...DEFAULTS.ntfy, ...parsed.ntfy }
      set({ ...merged, loaded: true })
      setAppLocale(merged.locale)
      return
    }
    set({ loaded: true })
  },

  setPageSize: async (size) => {
    const clamped = clampPageSize(size)
    set({ pageSize: clamped })
    await persist({ ...snapshot(get), pageSize: clamped })
  },

  setNotification: async (category, enabled) => {
    const notifications = { ...get().notifications, [category]: enabled }
    set({ notifications })
    await persist({ ...snapshot(get), notifications })
  },

  setLocale: async (locale) => {
    set({ locale })
    setAppLocale(locale) // applies immediately
    await persist({ ...snapshot(get), locale })
  },

  setNtfyEnabled: async (enabled) => {
    const ntfy = { ...get().ntfy, enabled }
    set({ ntfy })
    await persist({ ...snapshot(get), ntfy })
  },

  setNtfy: async (patch) => {
    const ntfy = { ...get().ntfy, ...patch }
    set({ ntfy })
    await persist({ ...snapshot(get), ntfy })
  },

  setMatchServerTheme: async (enabled) => {
    set({ matchServerTheme: enabled })
    await persist({ ...snapshot(get), matchServerTheme: enabled })
  },

  setBackgroundPoll: async (enabled) => {
    set({ backgroundPoll: enabled })
    await persist({ ...snapshot(get), backgroundPoll: enabled })
  },

  setForegroundService: async (enabled) => {
    set({ foregroundService: enabled })
    await persist({ ...snapshot(get), foregroundService: enabled })
  },
}))
