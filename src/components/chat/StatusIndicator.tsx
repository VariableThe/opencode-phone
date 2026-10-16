import { View, Text, StyleSheet, ActivityIndicator, Platform } from "react-native"
import { useTranslation } from "react-i18next"
import { useEvents } from "../../stores/events"
import { useSessions } from "../../stores/sessions"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { monoFont } from "./tui"

interface Props {
  sessionID: string
  isDark: boolean
  palette?: AppPalette
}

// TUI status line: dim compact mono text with a spinner — no tinted pill.
export function StatusIndicator({ sessionID, isDark, palette }: Props) {
  const { t } = useTranslation()
  const status = useEvents((s) => s.sessionStatus[sessionID])
  const text = useEvents((s) => s.statusText[sessionID])
  const optimistic = useSessions((s) => s.sending[sessionID])
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const mono = monoFont(Platform.OS)

  // SSE status is the source of truth. The optimistic `sending` flag only
  // covers the gap between the user tapping send and SSE confirming busy.
  // Once SSE reports idle, the indicator hides regardless of the optimistic flag.
  const sseBusy = status && status.type !== "idle"
  const busy = sseBusy || (optimistic && !status)
  if (!busy) return null

  const label =
    status?.type === "retry" ? t("chat.statusIndicator.retrying", { attempt: status.attempt }) : text || t("chat.statusIndicator.working")

  return (
    <View style={[s.bar, { borderTopColor: c.borderSubtle }]}>
      <ActivityIndicator size="small" color={c.primary} />
      <Text style={[s.text, { fontFamily: mono, color: c.muted }]}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  text: { fontSize: 12 },
})
