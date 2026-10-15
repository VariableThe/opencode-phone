import { useMemo } from "react"
import { useColorScheme } from "react-native"
import { useConnections } from "../stores/connections"
import { useServerTheme } from "../stores/server-theme"
import { useSettings } from "../stores/settings"
import { resolveAppPalette, type AppPalette, type ThemeMode } from "../lib/opencode-theme"

export interface AppTheme {
  mode: ThemeMode
  isDark: boolean
  palette: AppPalette
  /** True when a server theme is actually painting the UI right now. */
  themed: boolean
  /** Theme name from the server (e.g. "tokyonight"), null when unthemed. */
  themeName: string | null
}

// Single place the app's effective colors come from: device color scheme for
// the mode, the "Match server theme" setting + the active connection's cached
// bridge theme for the colors. When unthemed the palette equals the app's
// long-standing dark/light values, so palette overrides at call sites are
// no-ops and the existing look is preserved exactly.
export function useAppPalette(): AppTheme {
  const colorScheme = useColorScheme()
  const mode: ThemeMode = colorScheme === "dark" ? "dark" : "light"
  const matchEnabled = useSettings((s) => s.matchServerTheme)
  const activeId = useConnections((s) => s.activeConnection?.id)
  const entry = useServerTheme((s) => (activeId ? s.entries[activeId] : undefined))

  return useMemo(() => {
    const resolved = resolveAppPalette({ matchEnabled, mode, themeRaw: entry?.json })
    return {
      mode,
      isDark: mode === "dark",
      palette: resolved.palette,
      themed: resolved.active,
      themeName: resolved.active && entry ? entry.name : null,
    }
  }, [entry, matchEnabled, mode])
}
