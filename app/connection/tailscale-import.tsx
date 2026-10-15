import { useEffect, useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useConnections } from "../../src/stores/connections"
import { fetchTailscaleDevices, mapTailscaleDevices, type TailscaleDeviceCandidate } from "../../src/lib/tailscale"

// Import opencode servers from the tailnet via the Tailscale admin API. The
// user pastes an API key or OAuth token; devices list with hostname / DNS
// name / IP / recency, multi-select, and each selected device becomes a
// `http://<100.x>:4096` connection. Health is probed right after import via
// refreshStatuses() and shown in the connections list.
//
// Secret handling: the token is a tailnet-wide credential. It is held in
// component state only, never logged, never sent to analytics/Sentry, and
// persisted to SecureStore only when the user flips the remember switch.

export default function TailscaleImportScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { connections, addConnection, refreshStatuses, saveTailscaleToken, loadTailscaleToken, clearTailscaleToken } =
    useConnections()

  const [token, setToken] = useState("")
  const [remember, setRemember] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [devices, setDevices] = useState<TailscaleDeviceCandidate[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)

  // Prefill a previously remembered key so returning users don't re-paste.
  useEffect(() => {
    let cancelled = false
    void loadTailscaleToken()
      .then((saved) => {
        if (!cancelled && saved) {
          setToken(saved)
          setRemember(true)
        }
      })
      .catch(() => {
        // SecureStore unavailable — user can still paste a key per session.
      })
    return () => {
      cancelled = true
    }
  }, [loadTailscaleToken])

  const existingUrls = new Set(connections.map((c) => c.url))

  const handleLoad = async () => {
    const trimmed = token.trim()
    if (!trimmed) {
      setError(t("tailscaleImport.enterToken"))
      return
    }
    setLoading(true)
    setError(null)
    setEmpty(false)
    const result = await fetchTailscaleDevices(trimmed)
    // Persist (or drop) the key exactly as the user chose. Failures here
    // must not block the import itself.
    try {
      if (remember) await saveTailscaleToken(trimmed)
      if (!remember) await clearTailscaleToken()
    } catch {
      // storage optional
    }
    setLoading(false)
    if (!result.ok) {
      if (result.kind === "unauthorized") setError(t("tailscaleImport.errors.unauthorized", { status: result.status ?? 401 }))
      else if (result.kind === "network") setError(t("tailscaleImport.errors.network"))
      else setError(t("tailscaleImport.errors.unexpected", { status: result.status ?? "?" }))
      return
    }
    const candidates = mapTailscaleDevices(result.devices)
    setDevices(candidates)
    setEmpty(candidates.length === 0)
    if (candidates.length === 0) setError(t("tailscaleImport.errors.empty"))
    // Pre-select everything that isn't known-offline or already added.
    const preselect: Record<string, boolean> = {}
    for (const candidate of candidates) {
      if (candidate.online !== false && !existingUrls.has(candidate.url)) preselect[candidate.url] = true
    }
    setSelected(preselect)
  }

  const toggle = (url: string) => {
    setSelected((current) => ({ ...current, [url]: !current[url] }))
  }

  const selectedCount = devices.filter((d) => selected[d.url]).length

  const handleImport = async () => {
    const chosen = devices.filter((d) => selected[d.url])
    if (chosen.length === 0) {
      Alert.alert(t("common.error"), t("tailscaleImport.noSelection"))
      return
    }
    setImporting(true)
    let imported = 0
    let skipped = 0
    const known = new Set(connections.map((c) => c.url))
    for (const candidate of chosen) {
      if (known.has(candidate.url)) {
        skipped += 1
        continue
      }
      known.add(candidate.url)
      try {
        await addConnection({ name: candidate.name, type: "local", url: candidate.url })
        imported += 1
      } catch {
        // save failure for one device must not abort the rest
      }
    }
    // Probe health for everything just added so the list shows a live status.
    await refreshStatuses().catch(() => {
      // statuses are best-effort; the connections are already saved
    })
    setImporting(false)
    Alert.alert(t("tailscaleImport.doneTitle"), t("tailscaleImport.doneMessage", { imported, skipped }), [
      { text: t("common.ok"), onPress: () => router.back() },
    ])
  }

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Ionicons name="download-outline" size={40} color={isDark ? "#ffffff" : "#0a0a0a"} />
        <Text style={[styles.subtitle, isDark && styles.hintDark]}>{t("tailscaleImport.subtitle")}</Text>
      </View>

      <Text style={[styles.label, isDark && styles.labelDark]}>{t("tailscaleImport.tokenLabel")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={t("tailscaleImport.tokenPlaceholder")}
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={token}
        onChangeText={(value) => {
          setToken(value)
          setError(null)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <View style={styles.rememberRow}>
        <View style={styles.rememberText}>
          <Text style={[styles.rememberLabel, isDark && styles.textDark]}>{t("tailscaleImport.rememberLabel")}</Text>
          <Text style={[styles.rememberHint, isDark && styles.hintDark]}>{t("tailscaleImport.rememberHint")}</Text>
        </View>
        <Switch value={remember} onValueChange={setRemember} />
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, isDark && styles.primaryButtonDark]}
        onPress={handleLoad}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
        ) : (
          <Text style={[styles.primaryButtonText, isDark && styles.primaryButtonTextDark]}>
            {t("tailscaleImport.loadButton")}
          </Text>
        )}
      </TouchableOpacity>

      {loading && <Text style={[styles.note, isDark && styles.hintDark]}>{t("tailscaleImport.loadingDevices")}</Text>}
      {error && (
        <View style={[styles.errorBox, isDark && styles.errorBoxDark]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {devices.map((device) => {
        const isSelected = Boolean(selected[device.url])
        const added = existingUrls.has(device.url)
        return (
          <TouchableOpacity
            key={device.url}
            style={[styles.deviceRow, isDark && styles.deviceRowDark, isSelected && styles.deviceRowSelected]}
            onPress={() => toggle(device.url)}
          >
            <Ionicons
              name={isSelected ? "checkbox" : "square-outline"}
              size={24}
              color={isSelected ? "#22c55e" : isDark ? "#888888" : "#666666"}
            />
            <View style={styles.deviceContent}>
              <Text style={[styles.deviceName, isDark && styles.textDark]}>{device.name}</Text>
              <Text style={[styles.deviceMeta, isDark && styles.hintDark]} numberOfLines={1}>
                {device.dnsName ? `${device.dnsName} · ` : ""}
                {device.address}
              </Text>
              <View style={styles.badgeRow}>
                {device.online === false && (
                  <View style={styles.offlineBadge}>
                    <Text style={styles.offlineBadgeText}>{t("tailscaleImport.device.offline")}</Text>
                  </View>
                )}
                {device.online !== false && !device.lastSeen && (
                  <Text style={[styles.deviceMeta, isDark && styles.hintDark]}>
                    {t("tailscaleImport.device.lastSeenUnknown")}
                  </Text>
                )}
                {added && (
                  <View style={styles.addedBadge}>
                    <Text style={styles.addedBadgeText}>{t("tailscaleImport.device.alreadyAdded")}</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )
      })}

      {devices.length > 0 && (
        <View style={styles.footer}>
          <Text style={[styles.selectedText, isDark && styles.hintDark]}>
            {t("tailscaleImport.selectedCount", { count: selectedCount })}
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, isDark && styles.primaryButtonDark]}
            onPress={handleImport}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
            ) : (
              <Text style={[styles.primaryButtonText, isDark && styles.primaryButtonTextDark]}>
                {t("tailscaleImport.importButton", { count: selectedCount })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#666666",
    textAlign: "center",
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 16,
    marginBottom: 8,
  },
  labelDark: {
    color: "#ffffff",
  },
  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0a0a0a",
  },
  inputDark: {
    backgroundColor: "#1a1a1a",
    color: "#ffffff",
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
  },
  rememberText: {
    flex: 1,
    gap: 2,
  },
  rememberLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  rememberHint: {
    fontSize: 12,
    color: "#666666",
    lineHeight: 18,
  },
  textDark: {
    color: "#ffffff",
  },
  hintDark: {
    color: "#888888",
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
    marginTop: 16,
  },
  primaryButtonDark: {
    backgroundColor: "#ffffff",
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  primaryButtonTextDark: {
    color: "#0a0a0a",
  },
  note: {
    fontSize: 13,
    color: "#666666",
    marginTop: 12,
    textAlign: "center",
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  errorBoxDark: {
    backgroundColor: "#3b1212",
  },
  errorText: {
    fontSize: 13,
    color: "#ef4444",
    lineHeight: 18,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
    marginTop: 8,
  },
  deviceRowDark: {
    backgroundColor: "#1a1a1a",
  },
  deviceRowSelected: {
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  deviceContent: {
    flex: 1,
    gap: 2,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  deviceMeta: {
    fontSize: 12,
    color: "#666666",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  offlineBadge: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  offlineBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  addedBadge: {
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  addedBadgeText: {
    color: "#666666",
    fontSize: 11,
    fontWeight: "600",
  },
  footer: {
    marginTop: 16,
    gap: 4,
  },
  selectedText: {
    fontSize: 13,
    color: "#666666",
    textAlign: "center",
  },
})
