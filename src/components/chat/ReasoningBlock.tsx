import { useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native"
import { useTranslation } from "react-i18next"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { monoFont } from "./tui"

interface Props {
  text: string
  isDark: boolean
  palette?: AppPalette
}

// TUI-style reasoning: a dimmed one-line summary ("Thought" + duration) with
// a +/- disclosure marker, expanding to dimmed mono text behind a left rule
// (mirrors the TUI's collapsed reasoning group: warning-tinted label,
// left-border detail — see message-parts.tsx ReasoningPart).
export function ReasoningBlock({ text, isDark, palette }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const mono = monoFont(Platform.OS)

  return (
    <TouchableOpacity
      style={[s.block, { borderLeftColor: c.borderSubtle }]}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={s.header}>
        <Text style={[s.marker, { fontFamily: mono, color: c.warning }]}>{expanded ? "-" : "+"}</Text>
        <Text style={[s.label, { fontFamily: mono, color: c.warning }]}>{t("chat.reasoningBlock.label")}</Text>
      </View>
      {expanded && (
        <Text style={[s.text, { fontFamily: mono, color: c.muted }]} selectable>
          {text}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  block: {
    marginVertical: 6,
    paddingLeft: 8,
    borderLeftWidth: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  marker: { fontSize: 12, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", flex: 1 },
  text: { fontSize: 13, lineHeight: 20, marginTop: 6 },
})
