import { useEffect, useRef, useState } from "react"
import { Stack, router } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { View, ActivityIndicator, AppState } from "react-native"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet"
import { I18nextProvider, useTranslation } from "react-i18next"
import i18n from "../src/lib/i18n/config"
import { useAuth } from "../src/stores/auth"
import { useConnections } from "../src/stores/connections"
import { useServerTheme } from "../src/stores/server-theme"
import { useAppPalette } from "../src/components/useAppPalette"
import { useEvents } from "../src/stores/events"
import { useCatalog } from "../src/stores/catalog"
import { useSettings } from "../src/stores/settings"
import { useNtfy } from "../src/stores/ntfy"
import { useSessionWatch } from "../src/stores/session-watch"
import { syncBackgroundPoll } from "../src/lib/background-poll"
import { syncForegroundService } from "../src/lib/foreground-service"
import { AuthGate } from "../src/components/AuthGate"
import { ErrorBoundary } from "../src/components/ErrorBoundary"
import { TelemetryConsentModal } from "../src/components/TelemetryConsentModal"
import * as notifications from "../src/lib/notifications"
import { addBreadcrumb, wrap } from "../src/lib/sentry"
import { loadTelemetryConsent, setTelemetryConsent } from "../src/lib/telemetry"
import { initAnalytics, trackAppOpened } from "../src/lib/analytics"
import { flushPendingSignups } from "../src/lib/waitlist-queue-storage"

const queryClient = new QueryClient()

function RootLayout() {
  // Palette colors replace the hardcoded dark/light values below only while a
  // server theme is active (`themed`); otherwise the UI is pixel-identical.
  const { isDark, palette, themed } = useAppPalette()
  const { t } = useTranslation()

  const { initialize: initAuth, isLoading: authLoading } = useAuth()
  const { loadConnections, isLoading: connectionsLoading, client, activeConnection } = useConnections()
  const sseStarted = useRef(false)
  const notifPermissionRequested = useRef(false)
  // Stringified ntfy target: re-syncs the topic subscriber when the user
  // toggles it or edits URL/topic (including the post-load update from
  // SecureStore, which lands after the mount effect below).
  const ntfyTarget = useSettings((s) => (s.ntfy.enabled ? `${s.ntfy.baseUrl} ${s.ntfy.topic}` : "off"))
  // In-app/background transport prefs (no extra service): the periodic
  // background task registration and the Android foreground service follow
  // these switches, re-syncing after the SecureStore load lands.
  const backgroundPoll = useSettings((s) => s.backgroundPoll)
  const foregroundService = useSettings((s) => s.foregroundService)
  const settingsLoaded = useSettings((s) => s.loaded)
  // Watch-list version counter: re-sends the foreground service config when
  // sessions are tracked/untracked (prompt sent, run settled, abort).
  const watchRevision = useSessionWatch((s) => s.watched.length)

  useEffect(() => {
    useSessionWatch.getState().hydrate()
  }, [])

  useEffect(() => {
    if (settingsLoaded) void syncBackgroundPoll(backgroundPoll)
  }, [settingsLoaded, backgroundPoll])

  useEffect(() => {
    if (settingsLoaded) void syncForegroundService(foregroundService)
    // watchRevision re-sends the native poll set when sessions are
    // tracked/untracked (prompt sent, run settled, abort). Connection
    // switches are covered because the SSE busy hook re-tracks there.
  }, [settingsLoaded, foregroundService, watchRevision])

  useEffect(() => {
    useNtfy.getState().sync()
  }, [ntfyTarget])

  // Telemetry consent state: null = loading, 'unknown' = show modal, else decided
  const [consentState, setConsentState] = useState<"loading" | "unknown" | "decided">("loading")

  useEffect(() => {
    initAuth()
    loadConnections()
    useSettings.getState().load()

    // Connect notification preferences to the notification module
    notifications.configure(() => useSettings.getState().notifications)

    // Navigate to session when user taps a notification. Connection-drop
    // notifications carry no sessionId (they aren't about a session) — route
    // to the home tab instead of "/session/" (an empty, dead-end route).
    // Session alerts carry the owning connection's id (non-secret): when the
    // tap names a connection that is no longer active (e.g. the user
    // switched servers after sending the prompt), switch back first so the
    // session screen resolves against the right server.
    const routeNotificationTap = (data: notifications.NotificationData) => {
      if (!data.sessionId) {
        router.push("/")
        return
      }
      const conn = useConnections.getState()
      if (data.connectionId && data.connectionId !== conn.activeConnection?.id) {
        const known = conn.connections.some((c) => c.id === data.connectionId)
        if (known) {
          void conn.setActiveConnection(data.connectionId).then(() => {
            router.push(`/session/${data.sessionId}`)
          })
          return
        }
      }
      router.push(`/session/${data.sessionId}`)
    }
    const unsubNotifications = notifications.onTap(routeNotificationTap)
    // Killed-app tap: the tap that launched us has no live listener yet, so
    // resolve the stored response once connections are loaded.
    void notifications.lastTap().then((tapped) => {
      if (tapped) {
        const waitForConnections = () => {
          if (useConnections.getState().activeConnection || !useConnections.getState().isLoading) {
            routeNotificationTap(tapped)
            return
          }
          setTimeout(waitForConnections, 500)
        }
        waitForConnections()
      }
    })

    // Load telemetry consent — initialise Sentry only if previously granted
    loadTelemetryConsent()
      .then((state) => {
        if (state === "granted") {
          import("../src/lib/sentry").then(({ initSentry }) => {
            initSentry()
            addBreadcrumb({ category: "app.lifecycle", message: "app started" })
          })
          initAnalytics()
          trackAppOpened()
          setConsentState("decided")
        } else if (state === "denied") {
          addBreadcrumb({ category: "app.lifecycle", message: "app started (telemetry off)" })
          setConsentState("decided")
        } else {
          setConsentState("unknown")
        }
      })
      .catch(() => {
        // SecureStore unavailable — show modal so user can decide
        setConsentState("unknown")
      })

    return unsubNotifications
  }, [])

  // Re-arm the biometric app-lock when the app leaves the foreground. Without
  // this, "Require Biometric to Open" is bypassable: authenticate() sets
  // isAuthenticated=true once at cold start and nothing ever resets it, so the
  // app stays unlocked for the whole JS-process lifetime — anyone with brief
  // physical access can reopen a backgrounded app straight into session
  // history and connection details. lock() flips isAuthenticated back to false
  // so AuthGate shows the lock screen (and re-prompts) on next foreground.
  // Fire on "background" only (not the transient "inactive" that the biometric
  // prompt / app switcher / control center produce) to avoid spurious re-locks.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" && useAuth.getState().settings.requireBiometric) {
        useAuth.getState().lock()
      }
    })
    return () => sub.remove()
  }, [])

  // Server theme: refresh the cached bridge theme whenever the active
  // connection changes and on every foreground (cheap, cached per connection,
  // silent on failure — the UI never blocks on it).
  useEffect(() => {
    void useServerTheme.getState().refresh(activeConnection)
  }, [activeConnection])
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void useServerTheme.getState().refresh(useConnections.getState().activeConnection)
    })
    return () => sub.remove()
  }, [])

  // Retry any waitlist signup that couldn't reach the server when the user
  // tapped Join (AGE-87). Runs at cold start and on every foreground, which is
  // the cheapest reliable proxy for "connectivity may have come back" — it is a
  // no-op (single storage read, no network) when the queue is empty, and it
  // replaces the old silent mailto: fallback that lost 20 of 21 signups.
  useEffect(() => {
    const flush = () => {
      void flushPendingSignups()
        .then((outcome) => {
          if (outcome.synced.length > 0) {
            addBreadcrumb({ category: "waitlist", message: `retried ${outcome.synced.length} queued signup(s)` })
          }
        })
        .catch(() => {
          // Best effort: the entry stays queued for the next foreground.
        })
    }
    flush()
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") flush()
    })
    return () => sub.remove()
  }, [])

  // Android freezes JS timers and usually drops the SSE socket while the app
  // sits in the background (Doze/app standby), and the server may close idle
  // streams too. On return to foreground, re-establish the stream immediately
  // instead of waiting out the reconnect backoff (whose timers were frozen),
  // and resync messages/permissions missed while away. reconnectNow() is
  // idempotent, so an "active" fired by a transient "inactive" (biometric
  // prompt, app switcher) is harmless.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && sseStarted.current) {
        useEvents.getState().reconnectNow()
        // Same reason as SSE: JS timers were frozen while backgrounded, so
        // re-poll ntfy immediately instead of waiting out the interval.
        useNtfy.getState().reconnectNow()
        // Reconcile watched sessions against fresh server state: anything
        // that settled while the stream was dead (or while ntfy was the only
        // listener) notifies now. Skipped internally while SSE is live.
        void useSessionWatch.getState().evaluateNow("foreground")
      }
    })
    return () => sub.remove()
  }, [])

  // Connect/disconnect SSE and load catalog when client changes
  useEffect(() => {
    if (client && !sseStarted.current) {
      sseStarted.current = true
      useEvents.getState().connect()
      useCatalog.getState().load()
      // Request OS notification permission once we have a live connection —
      // the in-context moment the user will start running agent tasks they'll
      // want to be pinged about. Previously this was only ever requested when
      // a user manually toggled a notification switch off→on in Settings; since
      // most categories default on, that path never fired for typical users
      // and send() silently no-op'd on every notification (permission stayed
      // "undetermined"). setup() is idempotent — it won't re-prompt once the
      // OS has a decision — so the ref just avoids redundant calls per session.
      if (!notifPermissionRequested.current) {
        notifPermissionRequested.current = true
        void notifications.setup()
      }
    } else if (!client && sseStarted.current) {
      sseStarted.current = false
      useEvents.getState().disconnect()
    }
    return () => {
      if (sseStarted.current) {
        sseStarted.current = false
        useEvents.getState().disconnect()
      }
    }
  }, [client])

  const isLoading = authLoading || connectionsLoading || consentState === "loading"

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: themed ? palette.background : isDark ? "#0a0a0a" : "#ffffff",
        }}
      >
        <ActivityIndicator size="large" color={themed ? palette.text : isDark ? "#ffffff" : "#0a0a0a"} />
      </View>
    )
  }

  return (
    <ErrorBoundary>
      {/* react-native-keyboard-controller: drives keyboard avoidance from
          native WindowInsets instead of the legacy RN Keyboard events, which
          misreport under Android's mandatory edge-to-edge mode (Expo SDK 54). */}
      <KeyboardProvider>
      <I18nextProvider i18n={i18n}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <QueryClientProvider client={queryClient}>
            <AuthGate>
            <Stack
              screenOptions={{
                headerStyle: {
                  backgroundColor: themed ? palette.background : isDark ? "#0a0a0a" : "#ffffff",
                },
                headerTintColor: themed ? palette.text : isDark ? "#ffffff" : "#0a0a0a",
                contentStyle: {
                  backgroundColor: themed ? palette.background : isDark ? "#0a0a0a" : "#ffffff",
                },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="session/[id]"
                options={{
                  title: t("session.titleFallback"),
                  presentation: "card",
                }}
              />
              <Stack.Screen
                name="connection/add"
                options={{
                  title: t("nav.addConnectionTitle"),
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="connection/[id]"
                options={{
                  title: t("nav.editConnectionTitle"),
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="connection/tailscale-import"
                options={{
                  title: t("nav.tailscaleImportTitle"),
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="connection/scan"
                options={{
                  title: t("nav.qrScanTitle"),
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="terminals"
                options={{
                  title: "Terminals",
                  presentation: "card",
                }}
              />
              <Stack.Screen
                name="browse"
                options={{
                  title: t("browse.title"),
                  presentation: "card",
                }}
              />
              <Stack.Screen
                name="terminal/[id]"
                options={{
                  title: t("terminal.title"),
                  presentation: "card",
                }}
              />
            </Stack>
              <StatusBar style={isDark ? "light" : "dark"} />
            </AuthGate>
          </QueryClientProvider>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
      {/* Telemetry consent modal — shown once on first launch */}
      <TelemetryConsentModal
        visible={consentState === "unknown"}
        onAllow={async () => {
          await setTelemetryConsent(true)
          setConsentState("decided")
        }}
        onDecline={async () => {
          await setTelemetryConsent(false)
          setConsentState("decided")
        }}
      />
      </I18nextProvider>
      </KeyboardProvider>
    </ErrorBoundary>
  )
}

export default wrap(RootLayout)
