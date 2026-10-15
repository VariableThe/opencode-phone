import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Platform } from "react-native"
import { Stack, useRouter } from "expo-router"
import { useTranslation } from "react-i18next"
import { MessageBubble, PermissionPrompt } from "../src/components/chat"
import { useAppPalette } from "../src/components/useAppPalette"
import { monoFont } from "../src/components/chat/tui"
import { buildDemoScript, buildDemoCompletionMessage, buildDemoDenialMessage } from "../src/lib/demo-script"
import { SETUP_GUIDE_URL } from "../src/lib/links"
import { track, AnalyticsEvent } from "../src/lib/analytics"
import {
  demoStepAdvancedProps,
  demoCompletedOutcome,
  demoExitedToConnectProps,
  type DemoPermissionReply,
} from "../src/lib/demo-analytics"

// Fully offline, scripted walkthrough for installers with no self-hosted
// opencode server. ISOLATION: every message/part below is hardcoded local
// data built once with useMemo — this screen never calls useSessions,
// useConnections, useEvents, or any sdk.ts client method, so it cannot
// create a real session, touch the network, or corrupt real app state. The
// permission "reply" only flips local component state (below); it never
// calls sessionClient.permission.reply the way app/session/[id].tsx does.
export default function DemoScreen() {
  const router = useRouter()
  const { isDark, palette: p } = useAppPalette()
  const mono = monoFont(Platform.OS)
  const { t } = useTranslation()

  // Built once per mount from pure, hardcoded data (src/lib/demo-script.ts).
  const script = useMemo(() => buildDemoScript(), [])
  const [reply, setReply] = useState<DemoPermissionReply | null>(null)

  // Fires once per screen mount — this is a fully offline, consent-gated
  // event (track() is a no-op without telemetry consent, same as every
  // other analytics call site).
  useEffect(() => {
    track(AnalyticsEvent.DemoStarted)
  }, [])

  const handleReply = useCallback((r: DemoPermissionReply) => {
    setReply(r)
    track(AnalyticsEvent.DemoStepAdvanced, demoStepAdvancedProps(r))
    track(AnalyticsEvent.DemoCompleted, { outcome: demoCompletedOutcome(r) })
  }, [])

  const handleConnectPress = useCallback(() => {
    track(AnalyticsEvent.DemoExitedToConnect, demoExitedToConnectProps(reply !== null))
    router.push("/connection/add")
  }, [reply, router])

  const completion = useMemo(() => {
    if (!reply) return null
    return reply === "reject" ? buildDemoDenialMessage() : buildDemoCompletionMessage()
  }, [reply])

  const [userMessage, assistantMessage] = script.messages

  return (
    <>
      <Stack.Screen options={{ title: t("demo.title"), presentation: "card" }} />
      <View style={[s.container, { backgroundColor: p.background }]} testID="demo-screen">
        <View style={[s.banner, { borderBottomColor: p.borderSubtle }]} testID="demo-banner">
          <Text style={[s.bannerMark, { fontFamily: mono, color: p.primary }]}>{">"}</Text>
          <Text style={[s.bannerText, { fontFamily: mono, color: p.muted }]}>{t("demo.banner")}</Text>
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <MessageBubble message={userMessage} parts={script.parts[userMessage.id] || []} isDark={isDark} palette={p} />
          <MessageBubble
            message={assistantMessage}
            parts={script.parts[assistantMessage.id] || []}
            isDark={isDark}
            palette={p}
          />

          {!reply && <PermissionPrompt permission={script.permission} isDark={isDark} palette={p} onReply={handleReply} />}

          {completion && (
            <MessageBubble message={completion.message} parts={completion.parts} isDark={isDark} palette={p} />
          )}

          <View style={[s.ctaCard, { borderTopColor: p.borderSubtle }]} testID="demo-cta-card">
            <Text style={[s.ctaTitle, { fontFamily: mono, color: p.text }]}>{t("demo.ctaTitle")}</Text>
            <Text style={[s.ctaSubtitle, { fontFamily: mono, color: p.muted }]}>{t("demo.ctaSubtitle")}</Text>
            <TouchableOpacity
              style={[s.connectButton, { borderColor: p.primary }]}
              onPress={handleConnectPress}
              testID="demo-connect-button"
            >
              <Text style={[s.connectButtonText, { fontFamily: mono, color: p.primary }]}>
                {t("demo.connectButton")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.hostedCtaLink}
              onPress={handleConnectPress}
              testID="demo-hosted-cta"
            >
              <Text style={[s.hostedCtaLinkText, { fontFamily: mono, color: p.primary }]}>
                {t("demo.hostedCtaLink")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.setupGuideLink}
              onPress={() => Linking.openURL(SETUP_GUIDE_URL)}
              testID="demo-setup-guide-link"
            >
              <Text style={[s.setupGuideLinkText, { fontFamily: mono, color: p.muted }]}>
                {t("demo.setupGuideLink")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  bannerMark: { fontSize: 14, fontWeight: "700" },
  bannerText: { fontSize: 13, fontWeight: "400", flex: 1 },

  scrollContent: { paddingBottom: 40 },

  // Flat TUI block: thin top rule, mono, left-aligned — no card, no rounding,
  // no centred hero type. The button keeps a centred label (it is a control,
  // not copy) but stretches full-width like a command row.
  ctaCard: {
    marginTop: 8,
    padding: 20,
    borderTopWidth: 1,
    alignItems: "stretch",
  },
  ctaTitle: { fontSize: 14, fontWeight: "600", textAlign: "left" },
  ctaSubtitle: { fontSize: 13, marginTop: 6, textAlign: "left", lineHeight: 18 },
  connectButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    minHeight: 44,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  connectButtonText: { fontWeight: "700", fontSize: 14 },
  hostedCtaLink: { marginTop: 14, minHeight: 44, justifyContent: "center" },
  hostedCtaLinkText: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  setupGuideLink: { marginTop: 6, minHeight: 44, justifyContent: "center" },
  setupGuideLinkText: { fontSize: 14, fontWeight: "600", textAlign: "center" },
})
