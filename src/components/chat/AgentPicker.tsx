import { useState, useCallback, useMemo } from "react"
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import BottomSheet, { BottomSheetBackdrop, BottomSheetTextInput } from "@gorhom/bottom-sheet"
import { useTranslation } from "react-i18next"
import type { Agent } from "../../lib/sdk"

interface Props {
  agents: Agent[]
  selected: string
  isDark: boolean
  onSelect: (name: string) => void
  sheetRef: React.RefObject<BottomSheet | null>
}

export function AgentPicker({ agents, selected, isDark, onSelect, sheetRef }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")

  const items = useMemo(() => {
    const list = Array.isArray(agents) ? agents.filter((a) => !a.hidden) : []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q) ||
        (a.mode || "").toLowerCase().includes(q),
    )
  }, [agents, search])

  const handleSelect = useCallback(
    (name: string) => {
      onSelect(name)
      setSearch("")
      sheetRef.current?.close()
    },
    [onSelect, sheetRef],
  )

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={["50%", "80%"]}
      // See DirectoryBrowserSheet.tsx for why this is required alongside
      // static snapPoints (issue #104): without it the sheet can never open.
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={isDark ? s.sheetDark : s.sheet}
      handleIndicatorStyle={{ backgroundColor: isDark ? "#666666" : "#cccccc" }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
      )}
      onChange={(idx) => {
        if (idx === -1) setSearch("")
      }}
    >
      <View style={s.header}>
        <Text style={[s.title, isDark && s.textWhite]}>{t("chat.agentPicker.title")}</Text>
        <BottomSheetTextInput
          style={[s.search, isDark && s.searchDark]}
          placeholder={t("chat.agentPicker.searchPlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => {
          const active = selected === item.name
          return (
            <TouchableOpacity
              style={[s.row, isDark && s.rowDark, active && (isDark ? s.rowSelectedDark : s.rowSelected)]}
              onPress={() => handleSelect(item.name)}
              testID={`agent-option-${item.name}`}
            >
              <View style={[s.dot, { backgroundColor: item.color || "#8b5cf6" }]} />
              <View style={s.rowText}>
                <Text style={[s.rowName, isDark && s.textWhite]} numberOfLines={1}>
                  {item.name}
                </Text>
                {!!item.description && (
                  <Text style={[s.rowDescription, isDark && s.metaDark]} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
              </View>
              {active && <Ionicons name="checkmark-circle" size={20} color="#8b5cf6" />}
            </TouchableOpacity>
          )
        }}
        contentContainerStyle={s.content}
      />
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#ffffff" },
  sheetDark: { backgroundColor: "#1a1a1a" },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  title: { fontSize: 18, fontWeight: "700", color: "#0a0a0a" },
  textWhite: { color: "#ffffff" },
  search: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0a0a0a",
  },
  searchDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  content: { paddingBottom: 40 },
  metaDark: { color: "#666666" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  rowDark: { borderBottomColor: "#2a2a2a" },
  rowSelected: { backgroundColor: "#f5f3ff" },
  rowSelectedDark: { backgroundColor: "#1f1a2e" },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: "500", color: "#0a0a0a" },
  rowDescription: { fontSize: 12, color: "#999999", marginTop: 1 },
})
