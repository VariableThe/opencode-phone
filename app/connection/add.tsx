import { useState } from "react"
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
} from "react-native"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useConnections } from "../../src/stores/connections"
import type { ConnectionType } from "../../src/lib/types"
import { probeConnection, shareReport } from "../../src/lib/diagnostics"
import { captureDiagnostic } from "../../src/lib/sentry"
import { normalizeServerHost, normalizeServerUrl } from "../../src/lib/server-host"
import { buildAuth } from "../../src/lib/auth"
import { AnalyticsEvent, track } from "../../src/lib/analytics"

export default function AddConnectionScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { addConnection, testConnection } = useConnections()

  const [mode, setMode] = useState<"quick" | "advanced">("quick")
  const [type, setType] = useState<ConnectionType>("local")
  const [name, setName] = useState("")
  const [ip, setIp] = useState("")
  const [port, setPort] = useState("4096")
  const [url, setUrl] = useState("")
  const [directory, setDirectory] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)

  const buildUrl = () => {
    if (mode === "advanced") return url.trim()
    // Bare MagicDNS names and 100.x addresses normalize to http://host:port
    // here (same helper the edit screen uses) so quick connect accepts
    // hostnames, not just IPs.
    return normalizeServerHost(ip.trim(), port.trim() || "4096") ?? ""
  }

  const handleQuickConnect = async () => {
    const serverUrl = buildUrl()
    if (!serverUrl) {
      Alert.alert(t("common.error"), t("connection.add.alerts.enterIp"))
      return
    }

    track(AnalyticsEvent.ConnectionFormSubmitted, { mode: "quick" })
    setIsConnecting(true)

    // Test connection first. Quick Connect has no username field, so the
    // connection is intentionally saved without one — buildAuth() defaults
    // it to "opencode" wherever auth is built. Sending the `username` state
    // here would leak a value typed earlier in Advanced mode (issue: Back to
    // Quick silently overriding the default).
    const result = await testConnection(
      {
        id: "",
        name: name || t("connection.shared.namePlaceholder"),
        type: "local",
        url: serverUrl,
      },
      "onboarding",
      password || undefined,
    )

    if (result.ok) {
      // Save and go back
      try {
        await addConnection(
          {
            name: name.trim() || t("connection.shared.namePlaceholder"),
            type: "local",
            url: serverUrl,
            // Carry the transport the pre-flight probe already determined, so the
            // save does not probe the same server a second time.
            api: result.api,
            serverVersion: result.serverVersion,
          },
          password || undefined,
        )
        setIsConnecting(false)
        router.back()
      } catch {
        setIsConnecting(false)
        Alert.alert(
          t("connection.shared.alerts.saveFailedTitle"),
          t("connection.shared.alerts.saveFailedMessage"),
        )
      }
    } else {
      // Failed: run active diagnostics, capture to Sentry, offer a shareable report.
      const report = await probeConnection(serverUrl, buildAuth(undefined, password))
      captureDiagnostic(report)
      setIsConnecting(false)
      Alert.alert(
        t("connection.shared.alerts.connectionFailedTitle"),
        t("connection.add.alerts.connectionFailedMessage", {
          summary: report.summary,
          target: serverUrl,
          error: result.error || t("connection.shared.alerts.unknownError"),
        }),
        [
          { text: t("common.ok"), style: "cancel" },
          { text: t("common.shareReport"), onPress: () => shareReport(report) },
        ],
      )
    }
  }

  const handleAdvancedSave = async () => {
    if (!name.trim()) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterName"))
      return
    }
    // Bare MagicDNS / 100.x hosts upgrade to http://host:4096; full URLs
    // pass through. Null means not an address at all.
    const normalized = normalizeServerUrl(url)
    if (!url.trim()) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterUrl"))
      return
    }
    if (!normalized) {
      Alert.alert(t("connection.shared.alerts.invalidUrlTitle"), t("connection.shared.alerts.invalidUrlMessage"))
      return
    }

    track(AnalyticsEvent.ConnectionFormSubmitted, { mode: "advanced" })
    setIsConnecting(true)

    // Pre-flight, mirroring Quick Connect: previously Advanced mode saved
    // directly with no health check, so bad credentials (401/403) or an
    // unreachable server silently became the active connection with zero
    // feedback (issue #76). testConnection() also fires the
    // connection_attempted/succeeded/failed analytics events.
    const result = await testConnection(
      {
        id: "",
        name: name.trim(),
        type,
        url: normalized,
        directory: directory.trim() || undefined,
        username: username.trim() || undefined,
      },
      "onboarding",
      password || undefined,
    )

    if (result.ok) {
      try {
        await addConnection(
          {
            name: name.trim(),
            type,
            url: normalized,
            directory: directory.trim() || undefined,
            username: username.trim() || undefined,
            api: result.api,
            serverVersion: result.serverVersion,
          },
          password || undefined,
        )
        setIsConnecting(false)
        router.back()
      } catch {
        setIsConnecting(false)
        Alert.alert(
          t("connection.shared.alerts.saveFailedTitle"),
          t("connection.shared.alerts.saveFailedMessage"),
        )
      }
      return
    }

    // Failed: same "Connection Failed" alert as Quick Connect — run active
    // diagnostics, capture to Sentry, and offer a shareable report instead of
    // silently persisting an unreachable/unauthorized connection.
    const report = await probeConnection(normalized, buildAuth(username, password))
    captureDiagnostic(report)
    setIsConnecting(false)
    Alert.alert(
      t("connection.shared.alerts.connectionFailedTitle"),
      t("connection.add.alerts.connectionFailedMessage", {
        summary: report.summary,
        target: normalized,
        error: result.error || t("connection.shared.alerts.unknownError"),
      }),
      [
        { text: t("common.ok"), style: "cancel" },
        { text: t("common.shareReport"), onPress: () => shareReport(report) },
      ],
    )
  }

  // Quick connect mode - simplified
  if (mode === "quick") {
    return (
      <ScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.quickHeader}>
          <Ionicons name="wifi" size={48} color={isDark ? "#ffffff" : "#0a0a0a"} />
          <Text style={[styles.quickTitle, isDark && styles.textDark]}>{t("connection.add.quick.title")}</Text>
          <Text style={[styles.quickSubtitle, isDark && styles.hintDark]}>{t("connection.add.quick.subtitle")}</Text>
        </View>

        {/* IP Address */}
        <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.add.quick.ipAddressLabel")}</Text>
        <View style={styles.ipRow}>
          <TextInput
            style={[styles.input, styles.ipInput, isDark && styles.inputDark]}
            placeholder="192.168.1.100"
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={ip}
            onChangeText={setIp}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="connect-ip-input"
          />
          <Text style={[styles.ipColon, isDark && styles.textDark]}>:</Text>
          <TextInput
            style={[styles.input, styles.portInput, isDark && styles.inputDark]}
            placeholder="4096"
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            testID="connect-port-input"
          />
        </View>

        {/* Optional name */}
        <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.add.quick.nameOptionalLabel")}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder={t("connection.add.quick.namePlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={name}
          onChangeText={setName}
        />

        {/* Password if needed */}
        <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.add.quick.passwordIfSetLabel")}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder={t("connection.add.quick.passwordPlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          testID="connect-password-input"
        />
        <Text style={[styles.usernameHint, isDark && styles.hintDark]}>
          {t("connection.add.quick.usernameHintPrefix")}
          <Text style={styles.code}>opencode</Text>
          {t("connection.add.quick.usernameHintMiddle")}
          <Text style={styles.usernameHintLink} onPress={() => setMode("advanced")}>
            {t("connection.add.quick.advancedOptionsLink")}
          </Text>
          {t("connection.add.quick.usernameHintSuffix")}
        </Text>

        {/* Connect button */}
        <TouchableOpacity
          style={[styles.connectButton, isDark && styles.connectButtonDark]}
          onPress={handleQuickConnect}
          disabled={isConnecting}
          testID="connect-submit-button"
        >
          {isConnecting ? (
            <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
          ) : (
            <>
              <Ionicons name="flash" size={20} color={isDark ? "#0a0a0a" : "#ffffff"} />
              <Text style={[styles.connectButtonText, isDark && styles.connectButtonTextDark]}>
                {t("connection.add.quick.connectButton")}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* QR scan entry point */}
        <TouchableOpacity style={styles.scanButton} onPress={() => router.push("/connection/scan")}>
          <Ionicons name="qr-code-outline" size={20} color={isDark ? "#ffffff" : "#0a0a0a"} />
          <Text style={[styles.scanButtonText, isDark && styles.textDark]}>{t("qrScan.openScannerButton")}</Text>
        </TouchableOpacity>

        {/* Help text */}
        <View style={[styles.helpBox, isDark && styles.helpBoxDark]}>
          <Text style={[styles.helpTitle, isDark && styles.textDark]}>{t("connection.add.quick.helpTitle")}</Text>
          <Text style={[styles.helpText, isDark && styles.hintDark]}>
            {t("connection.add.quick.helpMacPrefix")}
            {"\n"}
            <Text style={styles.code}>ipconfig getifaddr en0</Text>
          </Text>
          <Text style={[styles.helpText, isDark && styles.hintDark, { marginTop: 8 }]}>
            {t("connection.add.quick.helpTailscalePrefix")}
            {"\n"}
            <Text style={styles.code}>http://100.64.12.34:4096</Text>
            {"\n"}
            <Text style={styles.code}>http://my-mac.tailnet.ts.net:4096</Text>
          </Text>
          <Text style={[styles.helpText, isDark && styles.hintDark, { marginTop: 8 }]}>
            {t("connection.add.quick.helpProtocolPrefix")}
            <Text style={styles.code}>http://</Text>
            {t("connection.add.quick.helpProtocolMiddle")}
            <Text style={styles.code}>https://</Text>
            {t("connection.add.quick.helpProtocolSuffix")}
          </Text>
          <Text style={[styles.helpText, isDark && styles.hintDark, { marginTop: 8 }]}>
            {t("connection.add.quick.helpRunningPrefix")}
            {"\n"}
            <Text style={styles.code}>opencode serve --hostname 0.0.0.0</Text>
          </Text>
        </View>

        {/* Advanced mode link */}
        <TouchableOpacity style={styles.advancedLink} onPress={() => setMode("advanced")}>
          <Text style={[styles.advancedLinkText, isDark && styles.hintDark]}>
            {t("connection.add.quick.advancedLink")}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={isDark ? "#888888" : "#666666"} />
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // Advanced mode - full options
  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity style={styles.backToQuick} onPress={() => setMode("quick")}>
        <Ionicons name="chevron-back" size={16} color={isDark ? "#888888" : "#666666"} />
        <Text style={[styles.backToQuickText, isDark && styles.hintDark]}>{t("connection.add.advanced.backToQuick")}</Text>
      </TouchableOpacity>

      {/* Connection Type */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.connectionType")}</Text>
      <View style={styles.typeContainer}>
        {[
          { type: "local" as const, label: t("connection.shared.types.local"), icon: "wifi" as const },
          { type: "tunnel" as const, label: t("connection.shared.types.tunnel"), icon: "globe" as const },
          { type: "cloud" as const, label: t("connection.shared.types.cloud"), icon: "cloud" as const },
        ].map((opt) => (
          <TouchableOpacity
            key={opt.type}
            style={[
              styles.typeOption,
              isDark && styles.typeOptionDark,
              type === opt.type && styles.typeOptionSelected,
              type === opt.type && isDark && styles.typeOptionSelectedDark,
            ]}
            onPress={() => setType(opt.type)}
          >
            <Ionicons
              name={opt.icon}
              size={20}
              color={type === opt.type ? (isDark ? "#0a0a0a" : "#ffffff") : isDark ? "#888888" : "#666666"}
            />
            <Text
              style={[
                styles.typeLabel,
                isDark && styles.textDark,
                type === opt.type && styles.typeLabelSelected,
                type === opt.type && isDark && styles.typeLabelSelectedDark,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Name */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.name")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={t("connection.shared.namePlaceholder")}
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={name}
        onChangeText={setName}
      />

      {/* URL */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.serverUrl")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={
          type === "local"
            ? "http://192.168.1.100:4096"
            : type === "tunnel"
              ? "https://your-tunnel.trycloudflare.com"
              : "https://api.opencode.ai"
        }
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={[styles.hint, isDark && styles.hintDark]}>
        {t("connection.add.advanced.urlHintPrefix")}
        <Text style={styles.code}>http://100.64.12.34:4096</Text>
        {t("connection.add.advanced.urlHintOr")}
        <Text style={styles.code}>http://my-mac.tailnet.ts.net:4096</Text>
        {t("connection.add.advanced.urlHintUse")}
        <Text style={styles.code}>https://</Text>
        {t("connection.add.advanced.urlHintSuffix")}
      </Text>

      {/* Directory */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.directoryOptional")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="/path/to/project"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={directory}
        onChangeText={setDirectory}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.add.advanced.directoryHint")}</Text>

      {/* Auth */}
      <Text style={[styles.sectionTitle, isDark && styles.textDark]}>{t("connection.shared.authentication")}</Text>

      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.username")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="admin"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.password")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="password"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {/* Save */}
      <TouchableOpacity
        style={[styles.connectButton, isDark && styles.connectButtonDark, { marginTop: 32 }]}
        onPress={handleAdvancedSave}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
        ) : (
          <Text style={[styles.connectButtonText, isDark && styles.connectButtonTextDark]}>
            {t("connection.add.advanced.saveButton")}
          </Text>
        )}
      </TouchableOpacity>
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
  // Quick connect styles
  quickHeader: {
    alignItems: "center",
    paddingVertical: 24,
  },
  quickTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0a0a0a",
    marginTop: 16,
  },
  quickSubtitle: {
    fontSize: 15,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  ipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ipInput: {
    flex: 1,
  },
  ipColon: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  portInput: {
    width: 80,
  },
  connectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
    marginTop: 24,
  },
  connectButtonDark: {
    backgroundColor: "#ffffff",
  },
  connectButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
  },
  connectButtonTextDark: {
    color: "#0a0a0a",
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    marginTop: 12,
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  helpBox: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  helpBoxDark: {
    backgroundColor: "#1a1a1a",
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
    marginBottom: 8,
  },
  helpText: {
    fontSize: 13,
    color: "#666666",
    lineHeight: 20,
  },
  code: {
    fontFamily: "monospace",
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  usernameHint: {
    fontSize: 12,
    color: "#666666",
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 18,
  },
  usernameHintLink: {
    color: "#6366f1",
    fontWeight: "600",
  },
  advancedLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 16,
    marginTop: 16,
  },
  advancedLinkText: {
    fontSize: 14,
    color: "#666666",
  },
  backToQuick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
  },
  backToQuickText: {
    fontSize: 14,
    color: "#666666",
  },
  // Original styles
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
  typeContainer: {
    flexDirection: "row",
    gap: 8,
  },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    gap: 6,
  },
  typeOptionDark: {
    backgroundColor: "#1a1a1a",
  },
  typeOptionSelected: {
    backgroundColor: "#0a0a0a",
  },
  typeOptionSelectedDark: {
    backgroundColor: "#ffffff",
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666666",
  },
  textDark: {
    color: "#ffffff",
  },
  typeLabelSelected: {
    color: "#ffffff",
  },
  typeLabelSelectedDark: {
    color: "#0a0a0a",
  },
  hint: {
    fontSize: 13,
    color: "#666666",
    marginTop: 8,
  },
  hintDark: {
    color: "#888888",
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 32,
    marginBottom: 8,
  },
})
