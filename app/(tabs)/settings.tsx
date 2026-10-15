import { useCallback, useEffect, useState } from "react"
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Linking,
  Alert,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useAuth } from "../../src/stores/auth"
import { useSettings } from "../../src/stores/settings"
import { useAppPalette } from "../../src/components/useAppPalette"
import { useNtfy } from "../../src/stores/ntfy"
import { foregroundServiceSupported, syncForegroundService } from "../../src/lib/foreground-service"
import { syncBackgroundPoll } from "../../src/lib/background-poll"
import {
  categories,
  categoryMeta,
  setup as setupNotifications,
  granted as notificationsGranted,
} from "../../src/lib/notifications"
import type { Category } from "../../src/lib/notifications"
import { hasTelemetryConsent, setTelemetryConsent } from "../../src/lib/telemetry"
import { PRIVACY_POLICY_URL } from "../../src/lib/links"
import { CURRENT_VERSION, checkForUpdate, type AvailableUpdate } from "../../src/lib/update-check"
import type { LocalePreference } from "../../src/lib/i18n/locale-resolve"

function SettingRow({
  icon,
  label,
  description,
  isDark,
  right,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  description?: string
  isDark: boolean
  right?: React.ReactNode
  onPress?: () => void
}) {
  // Server-theme colors; trailing `themed &&` overrides keep the unthemed
  // look byte-identical while painting themed surfaces when active.
  const { palette: p, themed } = useAppPalette()
  const content = (
    <View style={[styles.settingRow, isDark && styles.settingRowDark, themed && { borderBottomColor: p.border }]}>
      <View style={[styles.settingIcon, isDark && styles.settingIconDark, themed && { backgroundColor: p.element }]}>
        <Ionicons name={icon} size={22} color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingLabel, isDark && styles.textDark, themed && { color: p.text }]}>{label}</Text>
        {description && (
          <Text style={[styles.settingDescription, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {description}
          </Text>
        )}
      </View>
      {right}
    </View>
  )

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>
  }

  return content
}

function SettingSection({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  const { palette: p, themed } = useAppPalette()
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark, themed && { color: p.muted }]}>
        {title}
      </Text>
      <View
        style={[
          styles.sectionContent,
          isDark && styles.sectionContentDark,
          themed && { backgroundColor: p.panel, borderColor: p.border },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

export default function SettingsScreen() {
  const { isDark, palette: p, themed, themeName } = useAppPalette()
  const { t } = useTranslation()

  const { settings, hasBiometrics, updateSettings, lock } = useAuth()
  const { notifications, setNotification, locale, setLocale, ntfy, setNtfyEnabled, setNtfy, matchServerTheme, setMatchServerTheme, backgroundPoll, setBackgroundPoll, foregroundService, setForegroundService } =
    useSettings()
  const { running: ntfyRunning, lastError: ntfyError, lastReceived: ntfyLast, publishTest } = useNtfy()
  const [osGranted, setOsGranted] = useState<boolean | null>(null)
  const [telemetryUpdating, setTelemetryUpdating] = useState(false)
  const [testingNtfy, setTestingNtfy] = useState(false)
  const [urlDraft, setUrlDraft] = useState(ntfy.baseUrl)
  const [topicDraft, setTopicDraft] = useState(ntfy.topic)

  // Drafts follow the stored values (e.g. after first load from SecureStore).
  useEffect(() => {
    setUrlDraft(ntfy.baseUrl)
  }, [ntfy.baseUrl])
  useEffect(() => {
    setTopicDraft(ntfy.topic)
  }, [ntfy.topic])

  // Settings is where a user goes to ask "what am I running?". Answer it, and if
  // a newer build exists say so here too — the banner on the sessions list is
  // dismissible, this row is not (AGE-110). Uses the same 24h-throttled check,
  // so opening Settings repeatedly costs no extra requests.
  const [updateAvailable, setUpdateAvailable] = useState<AvailableUpdate | null>(null)
  useEffect(() => {
    let cancelled = false
    checkForUpdate({ ignoreDismissed: true })
      .then((result) => {
        if (!cancelled) setUpdateAvailable(result)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Telemetry consent: hasTelemetryConsent() returns null (unknown), true, or false.
  // We initialise local state from in-memory value; updates call setTelemetryConsent().
  const [crashReporting, setCrashReporting] = useState<boolean>(hasTelemetryConsent() ?? false)

  const handleCrashReportingToggle = useCallback(
    async (value: boolean) => {
      setTelemetryUpdating(true)
      try {
        await setTelemetryConsent(value)
        setCrashReporting(value)
      } catch {
        setCrashReporting(hasTelemetryConsent() ?? false)
        Alert.alert(t("settings.alerts.privacyNotSavedTitle"), t("settings.alerts.privacyNotSavedMessage"))
      } finally {
        setTelemetryUpdating(false)
      }
    },
    [t],
  )

  // Check OS permission state on first toggle attempt
  const handleToggle = useCallback(
    async (category: Category, enabled: boolean) => {
      if (enabled) {
        const ok = await setupNotifications()
        setOsGranted(ok)
        if (!ok) {
          Alert.alert(t("settings.alerts.notificationsDisabledTitle"), t("settings.alerts.notificationsDisabledMessage"))
          return
        }
      }
      setNotification(category, enabled)
    },
    [setNotification, t],
  )

  // ntfy listener toggle: same OS-permission gate as the category switches,
  // since received messages forward into the same send() path.
  const handleNtfyToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const ok = await setupNotifications()
        setOsGranted(ok)
        if (!ok) {
          Alert.alert(t("settings.alerts.notificationsDisabledTitle"), t("settings.alerts.notificationsDisabledMessage"))
          return
        }
      }
      setNtfyEnabled(enabled)
    },
    [setNtfyEnabled, t],
  )

  // In-app/background transport toggles. Same OS-permission gate as the
  // category switches: both paths forward into send().
  const handleBackgroundPollToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const ok = await setupNotifications()
        setOsGranted(ok)
        if (!ok) {
          Alert.alert(t("settings.alerts.notificationsDisabledTitle"), t("settings.alerts.notificationsDisabledMessage"))
          return
        }
      }
      await setBackgroundPoll(enabled)
      await syncBackgroundPoll(enabled)
    },
    [setBackgroundPoll, t],
  )

  const handleForegroundServiceToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const ok = await setupNotifications()
        setOsGranted(ok)
        if (!ok) {
          Alert.alert(t("settings.alerts.notificationsDisabledTitle"), t("settings.alerts.notificationsDisabledMessage"))
          return
        }
      }
      await setForegroundService(enabled)
      await syncForegroundService(enabled)
    },
    [setForegroundService, t],
  )

  const handleNtfyTest = useCallback(async () => {
    if (!ntfy.enabled) {
      Alert.alert(t("settings.ntfy.alerts.enableFirstTitle"), t("settings.ntfy.alerts.enableFirstMessage"))
      return
    }
    setTestingNtfy(true)
    try {
      const result = await publishTest()
      if (result.ok) {
        Alert.alert(t("settings.ntfy.alerts.testOkTitle"), t("settings.ntfy.alerts.testOkMessage", { detail: result.detail }))
      } else {
        Alert.alert(t("settings.ntfy.alerts.testFailedTitle"), result.detail)
      }
    } finally {
      setTestingNtfy(false)
    }
  }, [ntfy.enabled, publishTest, t])

  // Lazy-check OS permission for status display
  if (osGranted === null) {
    notificationsGranted()
      .then(setOsGranted)
      .catch(() => setOsGranted(false))
  }

  const localeLabels: Record<LocalePreference, string> = {
    system: t("settings.language.system"),
    en: t("settings.language.en"),
    "zh-Hans": t("settings.language.zhHans"),
  }

  const handleLanguagePress = useCallback(() => {
    Alert.alert(t("settings.language.title"), undefined, [
      { text: localeLabels.system, onPress: () => setLocale("system") },
      { text: localeLabels.en, onPress: () => setLocale("en") },
      { text: localeLabels["zh-Hans"], onPress: () => setLocale("zh-Hans") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, setLocale, localeLabels])

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}
      contentContainerStyle={styles.content}
    >
      <SettingSection title={t("settings.sections.appearance")} isDark={isDark}>
        <SettingRow
          icon="color-palette"
          label={t("settings.appearance.matchServerTheme.label")}
          description={
            matchServerTheme && themeName
              ? t("settings.appearance.matchServerTheme.descriptionOn", { name: themeName })
              : t("settings.appearance.matchServerTheme.descriptionOff")
          }
          isDark={isDark}
          right={
            <Switch
              value={matchServerTheme}
              onValueChange={(value) => setMatchServerTheme(value)}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.security")} isDark={isDark}>
        <SettingRow
          icon="finger-print"
          label={t("settings.security.biometricOpen.label")}
          description={
            hasBiometrics
              ? t("settings.security.biometricOpen.descriptionEnabled")
              : t("settings.security.biometricOpen.descriptionUnavailable")
          }
          isDark={isDark}
          right={
            <Switch
              value={settings.requireBiometric}
              onValueChange={(value) => updateSettings({ requireBiometric: value })}
              disabled={!hasBiometrics}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        <SettingRow
          icon="lock-closed"
          label={t("settings.security.biometricSend.label")}
          description={t("settings.security.biometricSend.description")}
          isDark={isDark}
          right={
            <Switch
              value={settings.requireBiometricForMessages}
              onValueChange={(value) => updateSettings({ requireBiometricForMessages: value })}
              disabled={!hasBiometrics || !settings.requireBiometric}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        {settings.requireBiometric && (
          <SettingRow
            icon="exit"
            label={t("settings.security.lockNow.label")}
            description={t("settings.security.lockNow.description")}
            isDark={isDark}
            onPress={lock}
            right={<Ionicons name="chevron-forward" size={20} color={themed ? p.muted : isDark ? "#666666" : "#999999"} />}
          />
        )}
      </SettingSection>

      <SettingSection title={t("settings.sections.notifications")} isDark={isDark}>
        {categories.map((category) => {
          const meta = categoryMeta[category]
          return (
            <SettingRow
              key={category}
              icon={meta.icon as keyof typeof Ionicons.glyphMap}
              label={t(meta.labelKey)}
              description={t(meta.descriptionKey)}
              isDark={isDark}
              right={
                <Switch
                  value={notifications[category]}
                  onValueChange={(value) => handleToggle(category, value)}
                  trackColor={{ false: "#767577", true: "#22c55e" }}
                />
              }
            />
          )
        })}
        {osGranted === false && (
          <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
            <Text style={[styles.settingDescription, { color: themed ? p.error : "#ef4444", paddingLeft: 48 }]}>
              {t("settings.notifications.disabledNotice")}
            </Text>
          </View>
        )}
      </SettingSection>

      <SettingSection title={t("settings.sections.inapp")} isDark={isDark}>
        <SettingRow
          icon="refresh"
          label={t("settings.inapp.poll.label")}
          description={t("settings.inapp.poll.description")}
          isDark={isDark}
          right={
            <Switch
              value={backgroundPoll}
              onValueChange={(value) => handleBackgroundPollToggle(value)}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        {foregroundServiceSupported && (
          <SettingRow
            icon="pulse"
            label={t("settings.inapp.foreground.label")}
            description={t("settings.inapp.foreground.description")}
            isDark={isDark}
            right={
              <Switch
                value={foregroundService}
                onValueChange={(value) => handleForegroundServiceToggle(value)}
                trackColor={{ false: "#767577", true: "#22c55e" }}
              />
            }
          />
        )}
        <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
          <Text style={[styles.settingDescription, { paddingLeft: 48 }, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {t("settings.inapp.limits")}
          </Text>
        </View>
      </SettingSection>

      <SettingSection title={t("settings.sections.ntfy")} isDark={isDark}>
        <SettingRow
          icon="notifications"
          label={t("settings.ntfy.enabled.label")}
          description={t("settings.ntfy.enabled.description")}
          isDark={isDark}
          right={
            <Switch
              value={ntfy.enabled}
              onValueChange={(value) => handleNtfyToggle(value)}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        <View style={[styles.fieldRow, isDark && styles.settingRowDark, themed && { borderBottomColor: p.border }]}>
          <Text style={[styles.settingLabel, isDark && styles.textDark, themed && { color: p.text }]}>{t("settings.ntfy.baseUrl.label")}</Text>
          <TextInput
            style={[styles.fieldInput, isDark && styles.fieldInputDark, themed && { backgroundColor: p.element, color: p.text }]}
            value={urlDraft}
            onChangeText={setUrlDraft}
            onEndEditing={() => setNtfy({ baseUrl: urlDraft.trim() })}
            placeholder="http://<TAILSCALE-IP>:2586"
            placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={[styles.settingDescription, isDark && styles.metaDark]}>{t("settings.ntfy.baseUrl.description")}</Text>
        </View>
        <View style={[styles.fieldRow, isDark && styles.settingRowDark, themed && { borderBottomColor: p.border }]}>
          <Text style={[styles.settingLabel, isDark && styles.textDark, themed && { color: p.text }]}>{t("settings.ntfy.topic.label")}</Text>
          <TextInput
            style={[styles.fieldInput, isDark && styles.fieldInputDark, themed && { backgroundColor: p.element, color: p.text }]}
            value={topicDraft}
            onChangeText={setTopicDraft}
            onEndEditing={() => setNtfy({ topic: topicDraft.trim() })}
            placeholder="oc-phone"
            placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.settingDescription, isDark && styles.metaDark]}>{t("settings.ntfy.topic.description")}</Text>
        </View>
        <SettingRow
          icon="flask"
          label={t("settings.ntfy.testButton")}
          description={
            testingNtfy
              ? t("settings.ntfy.testing")
              : ntfyRunning
                ? t("settings.ntfy.statusListening")
                : t("settings.ntfy.statusOff")
          }
          isDark={isDark}
          onPress={testingNtfy ? undefined : handleNtfyTest}
          right={<Ionicons name="send" size={20} color={themed ? p.muted : isDark ? "#666666" : "#999999"} />}
        />
        {ntfyLast && (
          <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
            <Text style={[styles.settingDescription, { paddingLeft: 48 }, isDark && styles.metaDark, themed && { color: p.muted }]}>
              {t("settings.ntfy.lastReceived", { title: ntfyLast.title })}
            </Text>
          </View>
        )}
        {ntfyError && (
          <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
            <Text style={[styles.settingDescription, { color: themed ? p.error : "#ef4444", paddingLeft: 48 }]}>
              {t("settings.ntfy.lastError", { detail: ntfyError })}
            </Text>
          </View>
        )}
        <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
          <Text style={[styles.settingDescription, { paddingLeft: 48 }, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {t("settings.ntfy.foregroundNote")}
          </Text>
        </View>
      </SettingSection>

      <SettingSection title={t("settings.sections.privacy")} isDark={isDark}>
        <SettingRow
          icon="shield-checkmark"
          label={t("settings.privacy.crashReporting.label")}
          description={t("settings.privacy.crashReporting.description")}
          isDark={isDark}
          right={
            <Switch
              value={crashReporting}
              onValueChange={handleCrashReportingToggle}
              disabled={telemetryUpdating}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        <SettingRow
          icon="document-text"
          label={t("settings.privacy.privacyPolicy.label")}
          description={t("settings.privacy.privacyPolicy.description")}
          isDark={isDark}
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          right={<Ionicons name="open-outline" size={20} color={themed ? p.muted : isDark ? "#666666" : "#999999"} />}
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.about")} isDark={isDark}>
        <SettingRow
          icon="language"
          label={t("settings.language.label")}
          description={localeLabels[locale]}
          isDark={isDark}
          onPress={handleLanguagePress}
          right={<Ionicons name="chevron-forward" size={20} color={themed ? p.muted : isDark ? "#666666" : "#999999"} />}
        />
        <SettingRow
          icon="information-circle"
          label={t("settings.about.version")}
          // Was hard-coded "1.0.0" — wrong for every build ever shipped, and the
          // one place a user could have checked what they are running while 64%
          // of the base sat on a four-week-old build (AGE-110).
          description={
            updateAvailable
              ? `${CURRENT_VERSION} → ${updateAvailable.version}`
              : `${CURRENT_VERSION} · ${t("update.upToDate")}`
          }
          isDark={isDark}
          onPress={updateAvailable ? () => Linking.openURL(updateAvailable.url) : undefined}
          right={
            updateAvailable ? (
              <Ionicons name="arrow-up-circle" size={20} color={isDark ? "#7dd3fc" : "#0369a1"} />
            ) : undefined
          }
        />
        <SettingRow
          icon="logo-github"
          label={t("settings.about.github.label")}
          description={t("settings.about.github.description")}
          isDark={isDark}
          onPress={() => Linking.openURL("https://github.com/anomalyco/opencode")}
          right={<Ionicons name="open-outline" size={20} color={themed ? p.muted : isDark ? "#666666" : "#999999"} />}
        />
        <SettingRow
          icon="document-text"
          label={t("settings.about.docs.label")}
          description={t("settings.about.docs.description")}
          isDark={isDark}
          onPress={() => Linking.openURL("https://opencode.ai/docs")}
          right={<Ionicons name="open-outline" size={20} color={themed ? p.muted : isDark ? "#666666" : "#999999"} />}
        />
      </SettingSection>

      <View style={styles.footer}>
        <Text style={[styles.footerText, isDark && styles.metaDark, themed && { color: p.muted }]}>{t("settings.footer.appName")}</Text>
        <Text style={[styles.footerText, isDark && styles.metaDark, themed && { color: p.muted }]}>{t("settings.footer.tagline")}</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  content: {
    paddingBottom: 32,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
    marginLeft: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  sectionTitleDark: {
    color: "#888888",
  },
  sectionContent: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e5e5",
  },
  sectionContentDark: {
    backgroundColor: "#1a1a1a",
    borderColor: "#2a2a2a",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  settingRowDark: {
    borderBottomColor: "#2a2a2a",
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  settingIconDark: {
    backgroundColor: "#2a2a2a",
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: "#0a0a0a",
  },
  textDark: {
    color: "#ffffff",
  },
  settingDescription: {
    fontSize: 13,
    color: "#666666",
    marginTop: 2,
  },
  fieldRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    gap: 6,
  },
  fieldInput: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: "#0a0a0a",
  },
  fieldInputDark: {
    backgroundColor: "#2a2a2a",
    color: "#ffffff",
  },
  metaDark: {
    color: "#888888",
  },
  footer: {
    alignItems: "center",
    padding: 32,
  },
  footerText: {
    fontSize: 13,
    color: "#999999",
    textAlign: "center",
  },
})
