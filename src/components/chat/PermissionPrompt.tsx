import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native"
import { useTranslation } from "react-i18next"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { monoFont } from "./tui"

interface Props {
  permission: { id: string; permission: string; patterns: string[] }
  isDark: boolean
  palette?: AppPalette
  onReply: (reply: "once" | "always" | "reject") => void
}

// TUI-style permission prompt: flat full-width block with a 1px rule,
// warning-tinted header, mono detail line, and flat bordered actions (44px
// targets). Same reply wiring — only the chrome changed.
export function PermissionPrompt({ permission, isDark, palette, onReply }: Props) {
  const { t } = useTranslation()
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const mono = monoFont(Platform.OS)
  return (
    <View style={[s.card, { backgroundColor: c.background, borderColor: c.warning }]}>
      <View style={s.header}>
        <Text style={[s.marker, { fontFamily: mono, color: c.warning }]}>!</Text>
        <Text style={[s.title, { fontFamily: mono, color: c.warning }]}>{t("chat.permissionPrompt.title")}</Text>
      </View>
      <Text style={[s.type, { fontFamily: mono, color: c.text }]}>
        {permission.permission}: {permission.patterns.join(", ")}
      </Text>
      <View style={s.actions}>
        <TouchableOpacity
          style={[s.btn, { borderColor: c.error }]}
          onPress={() => onReply("reject")}
          accessibilityRole="button"
        >
          <Text style={[s.btnText, { fontFamily: mono, color: c.error }]}>{t("chat.permissionPrompt.deny")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, { borderColor: c.borderSubtle }]}
          onPress={() => onReply("always")}
          accessibilityRole="button"
        >
          <Text style={[s.btnText, { fontFamily: mono, color: c.muted }]}>
            {t("chat.permissionPrompt.always")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, { borderColor: c.success }]}
          onPress={() => onReply("once")}
          accessibilityRole="button"
        >
          <Text style={[s.btnText, { fontFamily: mono, color: c.success }]}>
            {t("chat.permissionPrompt.allow")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 0,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingLeft: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  marker: { fontSize: 14, fontWeight: "700" },
  title: { fontSize: 13, fontWeight: "700" },
  type: { fontSize: 13, lineHeight: 20, marginBottom: 10 },
  actions: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 10, borderWidth: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
  btnText: { fontWeight: "700", fontSize: 13 },
})
