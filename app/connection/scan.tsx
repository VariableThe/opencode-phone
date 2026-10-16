import { useRef, useState } from "react"
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
  Linking,
} from "react-native"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera"
import * as Clipboard from "expo-clipboard"
import { useConnections } from "../../src/stores/connections"
import { parseConnectLink, missingSecrets, type ConnectPayload } from "../../src/lib/connect-link"
import { probeConnection, shareReport } from "../../src/lib/diagnostics"
import { captureDiagnostic } from "../../src/lib/sentry"
import { buildAuth } from "../../src/lib/auth"
import { AnalyticsEvent, track } from "../../src/lib/analytics"

// Scan the workstation QR printed by `oc-phone-qr` and turn it into a saved
// connection. The QR is never saved silently: a scan (or pasted link) lands
// on a confirmation preview first, and secrets the QR omitted (--no-secrets)
// are collected on the same screen before saving.
//
// Camera failure modes: permission denial shows a denial card with a system
// Settings shortcut; a missing/broken camera (onMountError) shows a plain
// message; the paste-the-link fallback works in both cases without a camera.
export default function QrScanScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { addConnection, testConnection, refreshStatuses } = useConnections()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

  const [payload, setPayload] = useState<ConnectPayload | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [pasted, setPasted] = useState("")
  const [password, setPassword] = useState("")
  const [bridgeToken, setBridgeToken] = useState("")
  const [cameraError, setCameraError] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const scanLocked = useRef(false)

  const describeError = (code: string, field?: string): string => {
    const key = `qrScan.errors.${code}` as const
    return t(key, { field: field ?? "?" })
  }

  // Returns true when the scanned/pasted text produced a preview.
  const ingestLink = (raw: string): boolean => {
    const result = parseConnectLink(raw)
    if (!result.ok) {
      setLinkError(describeError(result.error.code, result.error.field))
      return false
    }
    setPayload(result.payload)
    setPassword(result.payload.password ?? "")
    setBridgeToken(result.payload.bridgeToken ?? "")
    setLinkError(null)
    return true
  }

  const handleScanned = (scan: BarcodeScanningResult) => {
    if (scanLocked.current || payload) return
    scanLocked.current = true
    if (!ingestLink(scan.data)) scanLocked.current = false
  }

  const handlePaste = () => {
    scanLocked.current = true
    if (!ingestLink(pasted)) scanLocked.current = false
  }

  const handleRescan = () => {
    setPayload(null)
    setLinkError(null)
    setPasted("")
    setPassword("")
    setBridgeToken("")
    scanLocked.current = false
  }

  const handleSave = async () => {
    if (!payload || isSaving) return
    const missing = missingSecrets({ ...payload, password: password || undefined, bridgeToken: bridgeToken || undefined })
    if (missing.length > 0) {
      Alert.alert(t("common.error"), t("qrScan.secretsMissing"))
      return
    }

    track(AnalyticsEvent.ConnectionFormSubmitted, { mode: "qr" })
    setIsSaving(true)
    const candidate = {
      id: "",
      name: payload.name,
      type: "local" as const,
      url: payload.url,
      username: payload.username,
      bridgeUrl: payload.bridgeUrl,
      bridgeToken: bridgeToken || undefined,
      directory: payload.defaultProjectDir,
      defaultProjectDir: payload.defaultProjectDir,
    }
    const result = await testConnection(candidate, "onboarding", password || undefined)
    if (!result.ok) {
      const report = await probeConnection(payload.url, buildAuth(payload.username, password))
      captureDiagnostic(report)
      setIsSaving(false)
      Alert.alert(
        t("connection.shared.alerts.connectionFailedTitle"),
        t("connection.add.alerts.connectionFailedMessage", {
          summary: report.summary,
          target: payload.url,
          error: result.error || t("connection.shared.alerts.unknownError"),
        }),
        [
          { text: t("common.ok"), style: "cancel" },
          { text: t("common.shareReport"), onPress: () => shareReport(report) },
        ],
      )
      return
    }

    try {
      await addConnection(
        {
          name: payload.name,
          type: "local",
          url: payload.url,
          username: payload.username,
          bridgeUrl: payload.bridgeUrl,
          bridgeToken: bridgeToken || undefined,
          directory: payload.defaultProjectDir,
          defaultProjectDir: payload.defaultProjectDir,
          api: result.api,
          serverVersion: result.serverVersion,
        },
        password || undefined,
      )
    } catch {
      setIsSaving(false)
      Alert.alert(t("connection.shared.alerts.saveFailedTitle"), t("connection.shared.alerts.saveFailedMessage"))
      return
    }
    // Best-effort: the saved row should show a live status immediately.
    await refreshStatuses().catch(() => {
      // statuses are best-effort; the connection is already saved
    })
    setIsSaving(false)
    Alert.alert(t("qrScan.successTitle"), t("qrScan.successMessage", { name: payload.name }), [
      { text: t("common.ok"), onPress: () => router.back() },
    ])
  }

  const permissionLoading = !cameraPermission
  const permissionDenied = cameraPermission && !cameraPermission.granted
  const showCamera = cameraPermission?.granted && !payload && !cameraError
  const secretsMissing = payload ? missingSecrets(payload).length > 0 : false

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {!payload && (
        <View style={styles.header}>
          <Ionicons name="qr-code-outline" size={40} color={isDark ? "#ffffff" : "#0a0a0a"} />
          <Text style={[styles.subtitle, isDark && styles.hintDark]}>{t("qrScan.subtitle")}</Text>
        </View>
      )}

      {permissionLoading && <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />}

      {permissionDenied && (
        <View style={[styles.denialBox, isDark && styles.denialBoxDark]}>
          <Text style={[styles.denialTitle, isDark && styles.textDark]}>{t("qrScan.permissionDeniedTitle")}</Text>
          <Text style={[styles.denialMessage, isDark && styles.hintDark]}>{t("qrScan.permissionDeniedMessage")}</Text>
          <View style={styles.denialRow}>
            <TouchableOpacity
              style={[styles.primaryButton, isDark && styles.primaryButtonDark, styles.denialButton]}
              onPress={() => Linking.openSettings()}
            >
              <Text style={[styles.primaryButtonText, isDark && styles.primaryButtonTextDark]}>
                {t("qrScan.openSettingsButton")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, isDark && styles.secondaryButtonDark, styles.denialButton]}
              onPress={() => void requestCameraPermission()}
            >
              <Text style={[styles.secondaryButtonText, isDark && styles.textDark]}>{t("qrScan.retryButton")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showCamera && (
        <View style={styles.cameraFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleScanned}
            onMountError={() => setCameraError(true)}
          />
          <Text style={[styles.scanHint, isDark && styles.hintDark]}>{t("qrScan.scanHint")}</Text>
        </View>
      )}

      {cameraError && !payload && (
        <View style={[styles.errorBox, isDark && styles.errorBoxDark]}>
          <Text style={styles.errorText}>{t("qrScan.badCamera")}</Text>
        </View>
      )}

      {linkError && (
        <View style={[styles.errorBox, isDark && styles.errorBoxDark]}>
          <Text style={styles.errorText}>{linkError}</Text>
          <TouchableOpacity
            style={styles.retryLink}
            onPress={() => {
              setLinkError(null)
              scanLocked.current = false
            }}
          >
            <Text style={styles.retryLinkText}>{t("qrScan.retryButton")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!payload && (
        <View>
          <Text style={[styles.label, isDark && styles.labelDark]}>{t("qrScan.pasteLabel")}</Text>
          <TextInput
            style={[styles.input, styles.pasteInput, isDark && styles.inputDark]}
            placeholder={t("qrScan.pastePlaceholder")}
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={pasted}
            onChangeText={(value) => {
              setPasted(value)
              setLinkError(null)
            }}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <TouchableOpacity style={[styles.primaryButton, isDark && styles.primaryButtonDark]} onPress={handlePaste}>
            <Text style={[styles.primaryButtonText, isDark && styles.primaryButtonTextDark]}>
              {t("qrScan.parseButton")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.clipboardLink}
            onPress={() =>
              Clipboard.getStringAsync()
                .then((text) => {
                  setPasted(text)
                  setLinkError(null)
                })
                .catch(() => {
                  // Clipboard unreadable — the field above still accepts manual entry.
                })
            }
          >
            <Text style={styles.clipboardLinkText}>{t("qrScan.clipboardButton")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {payload && (
        <View>
          <Text style={[styles.previewTitle, isDark && styles.textDark]}>{t("qrScan.previewTitle")}</Text>
          <View style={[styles.previewCard, isDark && styles.previewCardDark]}>
            <PreviewRow label={t("qrScan.nameLabel")} value={payload.name} isDark={isDark} />
            <PreviewRow label={t("qrScan.serverUrlLabel")} value={payload.url} isDark={isDark} />
            <PreviewRow label={t("qrScan.bridgeUrlLabel")} value={payload.bridgeUrl} isDark={isDark} />
            <PreviewRow label={t("qrScan.projectDirLabel")} value={payload.defaultProjectDir} isDark={isDark} />
            <PreviewRow label={t("qrScan.usernameLabel")} value={payload.username} isDark={isDark} />
            <View style={styles.secretsRow}>
              <Ionicons
                name={secretsMissing ? "alert-circle-outline" : "checkmark-circle-outline"}
                size={18}
                color={secretsMissing ? "#f59e0b" : "#22c55e"}
              />
              <Text style={[styles.secretsText, isDark && styles.hintDark]}>
                {secretsMissing ? t("qrScan.secretsMissing") : t("qrScan.secretsEmbedded")}
              </Text>
            </View>
          </View>

          {secretsMissing && (
            <View>
              <Text style={[styles.label, isDark && styles.labelDark]}>{t("qrScan.passwordLabel")}</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                placeholder={t("qrScan.passwordPlaceholder")}
                placeholderTextColor={isDark ? "#666666" : "#999999"}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <Text style={[styles.label, isDark && styles.labelDark]}>{t("qrScan.bridgeTokenLabel")}</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                placeholder={t("qrScan.bridgeTokenPlaceholder")}
                placeholderTextColor={isDark ? "#666666" : "#999999"}
                value={bridgeToken}
                onChangeText={setBridgeToken}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, isDark && styles.primaryButtonDark]}
            onPress={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
            ) : (
              <Text style={[styles.primaryButtonText, isDark && styles.primaryButtonTextDark]}>
                {t("qrScan.saveButton")}
              </Text>
            )}
          </TouchableOpacity>
          {isSaving && (
            <Text style={[styles.note, isDark && styles.hintDark]}>{t("qrScan.testingMessage")}</Text>
          )}

          <TouchableOpacity style={styles.rescanLink} onPress={handleRescan} disabled={isSaving}>
            <Ionicons name="qr-code-outline" size={16} color={isDark ? "#888888" : "#666666"} />
            <Text style={[styles.rescanText, isDark && styles.hintDark]}>{t("qrScan.rescanButton")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

function PreviewRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View style={styles.previewRow}>
      <Text style={[styles.previewLabel, isDark && styles.hintDark]}>{label}</Text>
      <Text style={[styles.previewValue, isDark && styles.textDark]} selectable>
        {value}
      </Text>
    </View>
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
  textDark: {
    color: "#ffffff",
  },
  hintDark: {
    color: "#888888",
  },
  denialBox: {
    backgroundColor: "#fffbeb",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    gap: 8,
  },
  denialBoxDark: {
    backgroundColor: "#2a230f",
  },
  denialTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  denialMessage: {
    fontSize: 13,
    color: "#666666",
    lineHeight: 20,
  },
  denialRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  denialButton: {
    flex: 1,
    marginTop: 0,
  },
  cameraFrame: {
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 8,
    backgroundColor: "#000000",
  },
  camera: {
    height: 320,
  },
  scanHint: {
    fontSize: 13,
    color: "#666666",
    textAlign: "center",
    paddingVertical: 10,
    backgroundColor: "transparent",
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
  pasteInput: {
    minHeight: 80,
    fontSize: 13,
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
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  secondaryButtonDark: {
    borderColor: "#2a2a2a",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0a0a0a",
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
  retryLink: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  retryLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6366f1",
  },
  clipboardLink: {
    marginTop: 12,
    alignSelf: "center",
  },
  clipboardLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6366f1",
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0a0a0a",
    marginBottom: 12,
  },
  previewCard: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  previewCardDark: {
    backgroundColor: "#1a1a1a",
  },
  previewRow: {
    gap: 2,
  },
  previewLabel: {
    fontSize: 12,
    color: "#666666",
  },
  previewValue: {
    fontSize: 15,
    color: "#0a0a0a",
  },
  secretsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  secretsText: {
    fontSize: 13,
    color: "#666666",
    flex: 1,
  },
  note: {
    fontSize: 13,
    color: "#666666",
    marginTop: 12,
    textAlign: "center",
  },
  rescanLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 16,
    marginTop: 8,
  },
  rescanText: {
    fontSize: 14,
    color: "#666666",
  },
})
