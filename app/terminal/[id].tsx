import { useCallback, useEffect, useRef, useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native"
import { useAppPalette } from "../../src/components/useAppPalette"
import { WebView, type WebViewMessageEvent } from "react-native-webview"
import { useLocalSearchParams, Stack } from "expo-router"
import { useTranslation } from "react-i18next"
import { Ionicons } from "@expo/vector-icons"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { useConnections } from "../../src/stores/connections"
import { buildRequestHeaders } from "../../src/lib/headers"
import { isPtyAuthError, PtyError } from "../../src/lib/pty"
import { ptyConnectUrl, parsePtyFrame, ptyGoneReason } from "../../src/lib/pty-wire"
import { tmuxNameFromRecord } from "../../src/lib/tmux-pty"
import { buildTerminalHtml } from "../../src/lib/terminal-html"
import { XTERM_CSS, XTERM_JS, FIT_JS } from "../../src/lib/terminal-vendor.generated"

// Interactive server terminal: the WebSocket (with the connection's Basic
// auth headers — RN's WebSocket takes them in the third options arg) is owned
// here in RN, and xterm.js runs inside the WebView purely as a renderer.
// Output flows RN -> WebView via injected __ptyWrite calls; keystrokes flow
// WebView -> RN via postMessage and are written to the same socket. The
// WebView never opens its own socket (it could not set auth headers).
//
// Wire rules (reverse-engineered live, see src/lib/pty-wire.ts): server
// frames are raw terminal bytes except a NUL-prefixed {"cursor":N} control
// frame; input is raw text (lines end with \r); resize is
// PUT /api/pty/{id} {size:{rows,cols}}; shell exit closes the socket (1000).
//
// Tmux attach: the tmux tab opens this screen with `?tmux=<name>` against a
// PTY created as `tmux attach-session -t <name>` (see src/lib/tmux-pty.ts).
// The header shows the session name and detaching is framed as safe (the
// tmux session keeps running). When the attach PTY exits (user detached),
// the screen DELETEs the PTY record once so attach-PTYS don't accumulate —
// that kills only the `tmux attach` client, never the tmux session itself.

// Hermes ships RN's WebSocket (not the DOM one): same two-arg shape plus an
// options bag whose headers land on the native socket (Android OkHttp honors
// them — that is how the Basic Authorization header reaches the upgrade).
// The cast documents the runtime/type split without `any`.
type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket
const RNWebSocket = WebSocket as unknown as RNWebSocketCtor

type Phase = "loading" | "connecting" | "connected" | "disconnected" | "exited" | "auth-failed" | "not-found"

const MAX_AUTO_RETRIES = 8
const WRITE_SLICE = 16_384
const RESIZE_DEBOUNCE_MS = 500

// Inlined once: xterm.js + fit addon + bridge init. Built from the vendored
// dist at module load so the WebView renders with no network access.
const TERMINAL_HTML = buildTerminalHtml({ css: XTERM_CSS, js: XTERM_JS, fit: FIT_JS })

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 8000)
}

function ctrlCode(letter: string): string {
  return String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)
}

const ARROWS: Record<string, { plain: string; ctrl: string; icon: "arrow-back-outline" | "arrow-up-outline" | "arrow-down-outline" | "arrow-forward-outline" }> = {
  up: { plain: "\x1b[A", ctrl: "\x1b[1;5A", icon: "arrow-up-outline" },
  down: { plain: "\x1b[B", ctrl: "\x1b[1;5B", icon: "arrow-down-outline" },
  right: { plain: "\x1b[C", ctrl: "\x1b[1;5C", icon: "arrow-forward-outline" },
  left: { plain: "\x1b[D", ctrl: "\x1b[1;5D", icon: "arrow-back-outline" },
}

export default function TerminalScreen() {
  const { id, tmux } = useLocalSearchParams<{ id: string; tmux?: string }>()
  const { t } = useTranslation()
  const { isDark, palette: p, themed } = useAppPalette()
  const { activeConnection, client, clientBase, isLoading } = useConnections()

  const [phase, setPhase] = useState<Phase>("loading")
  const [title, setTitle] = useState<string | null>(null)
  const [recordTmux, setRecordTmux] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [ctrlLatched, setCtrlLatched] = useState(false)
  const [typing, setTyping] = useState(false)
  const [inputKey, setInputKey] = useState(0)

  const webview = useRef<WebView>(null)
  const input = useRef<TextInput>(null)
  const socket = useRef<WebSocket | null>(null)
  const cursor = useRef(0)
  const ready = useRef(false)
  const pending = useRef<string[]>([])
  const attempts = useRef(0)
  const closedByUs = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ctrlRef = useRef(false)
  const phaseRef = useRef<Phase>("loading")
  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  // The tmux session this PTY is attached to, if any. The explicit `?tmux=`
  // param (set by the tmux tab's Open action) wins; otherwise fall back to
  // the PTY record's argv/title so attach-PTYS opened from the Server PTYs
  // tab still read as tmux sessions.
  const paramTmux = typeof tmux === "string" && tmux.trim() ? tmux.trim() : null
  const tmuxName = paramTmux ?? recordTmux

  const ptyId = typeof id === "string" ? id : null
  // v1 servers have no PTY API at all — same gate as the terminals list.
  const pty = client && "pty" in client && activeConnection?.api !== "v1" ? client.pty : null
  const needsV2 = activeConnection?.api === "v1" || (client && !("pty" in client))

  const inject = useCallback((js: string) => {
    webview.current?.injectJavaScript(js)
  }, [])

  const writeOutput = useCallback(
    (text: string) => {
      if (!ready.current) {
        pending.current.push(text)
        return
      }
      for (let i = 0; i < text.length; i += WRITE_SLICE) {
        inject(`window.__ptyWrite(${JSON.stringify(text.slice(i, i + WRITE_SLICE))});true;`)
      }
    },
    [inject],
  )

  const flushPending = useCallback(() => {
    const queued = pending.current
    pending.current = []
    for (const text of queued) writeOutput(text)
  }, [writeOutput])

  const send = useCallback(
    (data: string) => {
      const ws = socket.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(data)
    },
    [],
  )

  const pressArrow = useCallback(
    (dir: keyof typeof ARROWS) => {
      const latched = ctrlRef.current
      ctrlRef.current = false
      setCtrlLatched(false)
      send(latched ? ARROWS[dir].ctrl : ARROWS[dir].plain)
    },
    [send],
  )

  // One-tap detach: the default tmux prefix (Ctrl-b) followed by `d`.
  // Detaches the client; the tmux session keeps running on the server.
  const detachTmux = useCallback(() => {
    send("\x02d")
  }, [send])

  const clearRetry = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
  }, [])

  const closeSocket = useCallback(() => {
    clearRetry()
    const ws = socket.current
    socket.current = null
    if (ws) {
      closedByUs.current = true
      ws.close()
    }
  }, [clearRetry])

  const pushSize = useCallback(
    (cols: number, rows: number) => {
      if (!pty || !ptyId || phaseRef.current !== "connected") return
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
      resizeTimer.current = setTimeout(() => {
        void pty.update(ptyId, { size: { rows, cols } }).then(undefined, () => {})
      }, RESIZE_DEBOUNCE_MS)
    },
    [pty, ptyId],
  )

  const scheduleRetry = useCallback(() => {
    attempts.current += 1
    if (attempts.current > MAX_AUTO_RETRIES) {
      setPhaseBoth("disconnected")
      return
    }
    setPhaseBoth("disconnected")
    retryTimer.current = setTimeout(() => {
      void connectRef.current?.()
    }, backoffMs(attempts.current))
  }, [setPhaseBoth])

  const classifySocketLoss = useCallback(
    (code: number, reason: string) => {
      if (code === 4404) {
        const gone = ptyGoneReason(reason)
        if (gone === "exited") {
          setPhaseBoth("exited")
          if (pty && ptyId) {
            void pty.get(ptyId).then(
              (record) => setExitCode(record.exitCode ?? 0),
              () => setExitCode(0),
            )
          }
          return
        }
        setPhaseBoth("not-found")
        return
      }
      // A clean close means the shell ended — confirm via the record before
      // declaring exit (a proxy can also close 1000 on a live shell).
      if (pty && ptyId) {
        void pty.get(ptyId).then(
          (record) => {
            if (record.status === "exited") {
              setExitCode(record.exitCode ?? 0)
              setPhaseBoth("exited")
              return
            }
            scheduleRetry()
          },
          (error: unknown) => {
            if (isPtyAuthError(error)) setPhaseBoth("auth-failed")
            else if (error instanceof PtyError && error.status === 404) setPhaseBoth("not-found")
            else scheduleRetry()
          },
        )
        return
      }
      scheduleRetry()
    },
    [pty, ptyId, scheduleRetry, setPhaseBoth],
  )

  const connect = useCallback(() => {
    if (!pty || !ptyId || !clientBase) return
    clearRetry()
    closeSocket()
    closedByUs.current = false
    if (phaseRef.current !== "loading") setPhaseBoth("connecting")
    // Bad credentials are a config problem, not a retry problem — check the
    // record first so auth failures never enter the reconnect loop.
    void pty.get(ptyId).then(
      (record) => {
        setTitle(record.title ?? null)
        setRecordTmux(tmuxNameFromRecord(record))
        if (record.status === "exited") {
          setExitCode(record.exitCode ?? 0)
          setPhaseBoth("exited")
          return
        }
        if (!clientBase.auth) return
        setPhaseBoth("connecting")
        const url = ptyConnectUrl(clientBase.baseUrl, ptyId, cursor.current > 0 ? cursor.current : undefined)
        const headers = buildRequestHeaders({ directory: activeConnection?.directory, auth: clientBase.auth })
        const ws = new RNWebSocket(url, undefined, { headers })
        socket.current = ws
        ws.onopen = () => {
          // Resume appends (cursor>0); without a cursor the replay would
          // duplicate what xterm already shows, so clear first.
          if (cursor.current <= 0 && attempts.current > 0) inject("window.__ptyClear();true;")
          attempts.current = 0
          setPhaseBoth("connected")
        }
        ws.onmessage = (event: { data?: unknown }) => {
          const frame = parsePtyFrame(String(event.data ?? ""))
          if (frame.kind === "meta") {
            cursor.current = frame.cursor
            return
          }
          writeOutput(frame.text)
        }
        ws.onerror = () => {
          // Classification happens on close (which always follows).
        }
        ws.onclose = (event: { code: number; reason: string }) => {
          socket.current = null
          if (closedByUs.current) return
          classifySocketLoss(event.code, event.reason)
        }
      },
      (error: unknown) => {
        if (isPtyAuthError(error)) setPhaseBoth("auth-failed")
        else if (error instanceof PtyError && error.status === 404) setPhaseBoth("not-found")
        else scheduleRetry()
      },
    )
  }, [pty, ptyId, clientBase, activeConnection, clearRetry, closeSocket, setPhaseBoth, inject, writeOutput, classifySocketLoss, scheduleRetry])

  const connectRef = useRef<(() => void) | null>(null)
  connectRef.current = connect

  const retryNow = useCallback(() => {
    attempts.current = 0
    connectRef.current?.()
  }, [])

  useEffect(() => {
    if (needsV2) return
    if (!pty || !ptyId) {
      if (!isLoading) setPhaseBoth("not-found")
      return
    }
    connect()
    return () => {
      closeSocket()
    }
    // Reconnect only when the target or transport changes — never on phase.
  }, [connect, closeSocket, setPhaseBoth, pty, ptyId, needsV2, isLoading])

  useEffect(
    () => () => {
      closeSocket()
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
    },
    [closeSocket],
  )

  // Attach-PTY hygiene: once the user detaches (tmux client gone, PTY
  // exited), DELETE the PTY record so attach-PTYS don't pile up in
  // GET /api/pty. This kills only the `tmux attach` client — the tmux
  // session itself keeps running. Fires once; a failed DELETE is non-fatal
  // (the record stays visible in the Server PTYs tab for manual cleanup).
  const cleaned = useRef(false)
  useEffect(() => {
    if (phase !== "exited" || !tmuxName || !pty || !ptyId || cleaned.current) return
    cleaned.current = true
    void pty.remove(ptyId).then(undefined, () => {})
  }, [phase, tmuxName, pty, ptyId])

  // xterm colors: explicit server-theme palette when active, otherwise the
  // long-standing dark/light call. Colors are JSON-quoted (they are validated
  // hex from the mapper, but quoting keeps the injected JS well-formed).
  const themeJs = themed
    ? `window.__ptyPalette(${JSON.stringify(p.background)},${JSON.stringify(p.text)},${JSON.stringify(p.primary)},${JSON.stringify(p.element)});true;`
    : `window.__ptyTheme(${isDark ? "true" : "false"});true;`

  const onWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: { type?: string; data?: unknown; cols?: unknown; rows?: unknown }
      try {
        msg = JSON.parse(event.nativeEvent.data) as typeof msg
      } catch {
        return
      }
      if (msg.type === "ready") {
        ready.current = true
        inject(themeJs)
        inject("window.__ptyFit();true;")
        flushPending()
        return
      }
      if (msg.type === "input" && typeof msg.data === "string") {
        send(msg.data)
        return
      }
      if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        pushSize(msg.cols, msg.rows)
      }
    },
    [flushPending, inject, pushSize, send, themeJs],
  )

  useEffect(() => {
    if (ready.current) inject(themeJs)
  }, [inject, themeJs])

  const toggleCtrl = useCallback(() => {
    ctrlRef.current = !ctrlRef.current
    setCtrlLatched(ctrlRef.current)
  }, [])

  const toggleTyping = useCallback(() => {
    if (typing) input.current?.blur()
    else {
      setTyping(true)
      setTimeout(() => input.current?.focus(), 50)
    }
  }, [typing])

  // The hidden input is deliberately UNCONTROLLED (no `value` prop): key
  // events can arrive faster than React re-renders, so echoing state back
  // into `value` races and duplicates characters. Instead we track how much
  // of the native text was already consumed and only forward the delta;
  // Enter remounts the field (via inputKey) to clear it.
  const consumed = useRef(0)

  const sendChunk = useCallback(
    (chunk: string) => {
      if (ctrlRef.current && /^[a-zA-Z]$/.test(chunk)) {
        ctrlRef.current = false
        setCtrlLatched(false)
        send(ctrlCode(chunk))
        return
      }
      send(chunk)
    },
    [send],
  )

  const onBufChange = useCallback(
    (text: string) => {
      const prev = consumed.current
      if (text.length > prev) sendChunk(text.slice(prev))
      else if (text.length < prev) {
        for (let i = text.length; i < prev; i++) send("\x7f")
      }
      consumed.current = text.length
    },
    [send, sendChunk],
  )

  const onInputKeyPress = useCallback(
    ({ nativeEvent }: { nativeEvent: { key: string } }) => {
      if (nativeEvent.key === "Backspace" && consumed.current === 0) send("\x7f")
    },
    [send],
  )

  const submitBuf = useCallback(() => {
    send("\r")
    consumed.current = 0
    setInputKey((k) => k + 1)
  }, [send])

  if (needsV2) {
    return (
      <View style={[styles.center, isDark && styles.centerDark, themed && { backgroundColor: p.background }]}>
        <Stack.Screen options={{ title: t("terminal.title") }} />
        <Text style={[styles.centerTitle, isDark && styles.textDark, themed && { color: p.text }]}>
          {t("terminal.needsV2Title")}
        </Text>
        <Text style={[styles.centerBody, isDark && styles.metaDark, themed && { color: p.muted }]}>
          {t("terminal.needsV2Body", { name: activeConnection?.name ?? "" })}
        </Text>
      </View>
    )
  }

  if (!pty || !ptyId) {
    return (
      <View style={[styles.center, isDark && styles.centerDark, themed && { backgroundColor: p.background }]}>
        <Stack.Screen options={{ title: t("terminal.title") }} />
        <Text style={[styles.centerBody, isDark && styles.metaDark, themed && { color: p.muted }]}>
          {t("terminal.loadFailed")}
        </Text>
      </View>
    )
  }

  const connected = phase === "connected"
  const banner =
    phase === "loading" || phase === "connecting" ? (
      <View style={[styles.banner, isDark && styles.bannerDark, themed && { backgroundColor: p.element }]}>
        <ActivityIndicator size="small" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
        <Text style={[styles.bannerText, isDark && styles.textDark, themed && { color: p.text }]}>
          {t("terminal.connecting")}
        </Text>
      </View>
    ) : phase === "disconnected" ? (
      <View style={[styles.banner, styles.bannerError, themed && { backgroundColor: p.panel }]}>
        <Text style={[styles.bannerErrorText, themed && { color: p.error }]}>{t("terminal.disconnected")}</Text>
        <TouchableOpacity onPress={retryNow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.bannerRetry, themed && { color: p.info }]}>{t("common.retry")}</Text>
        </TouchableOpacity>
      </View>
    ) : phase === "exited" ? (
      <View style={[styles.banner, isDark && styles.bannerDark, themed && { backgroundColor: p.element }]}>
        <Text style={[styles.bannerText, isDark && styles.textDark, themed && { color: p.text }]}>
          {tmuxName
            ? t("terminal.detached", { name: tmuxName })
            : `${t("terminal.exited")} — ${t("terminal.exitedBody", { code: exitCode ?? "?" })}`}
        </Text>
      </View>
    ) : phase === "auth-failed" ? (
      <View style={[styles.banner, styles.bannerError, themed && { backgroundColor: p.panel }]}>
        <Text style={[styles.bannerErrorText, themed && { color: p.error }]}>{t("terminal.authFailed")}</Text>
      </View>
    ) : phase === "not-found" ? (
      <View style={[styles.banner, styles.bannerError, themed && { backgroundColor: p.panel }]}>
        <Text style={[styles.bannerErrorText, themed && { color: p.error }]}>{t("terminal.notFound")}</Text>
      </View>
    ) : null

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <Stack.Screen options={{ title: tmuxName ? t("terminal.tmuxTitle", { name: tmuxName }) : (title ?? t("terminal.title")) }} />
      {tmuxName && phase !== "exited" && phase !== "not-found" && phase !== "auth-failed" && (
        <View style={[styles.banner, isDark && styles.bannerDark, themed && { backgroundColor: p.element }]}>
          <Ionicons name="layers-outline" size={16} color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
          <Text style={[styles.bannerText, isDark && styles.textDark, themed && { color: p.text }]}>
            {t("terminal.tmuxAttachedHint", { name: tmuxName })}
          </Text>
          <TouchableOpacity onPress={detachTmux} disabled={!connected} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.bannerAction, !connected && styles.keyDim, themed && { color: p.info }]}>
              {t("terminal.detach")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {banner}
      <View
        style={styles.term}
        onLayout={() => {
          if (ready.current) inject("window.__ptyFit();true;")
        }}
      >
        <WebView
          ref={webview}
          source={{ html: TERMINAL_HTML }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled={false}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          onMessage={onWebViewMessage}
          style={isDark ? styles.webviewDark : styles.webview}
        />
      </View>
      <View style={[styles.keyRow, isDark && styles.keyRowDark]}>
        <KeyBtn label="Esc" a11y={t("terminal.keys.esc")} onPress={() => send("\x1b")} isDark={isDark} dim={!connected} />
        <KeyBtn label="Tab" a11y={t("terminal.keys.tab")} onPress={() => send("\t")} isDark={isDark} dim={!connected} />
        <KeyBtn
          label="Ctrl"
          a11y={t("terminal.keys.ctrl")}
          onPress={toggleCtrl}
          isDark={isDark}
          dim={!connected}
          active={ctrlLatched}
        />
        <KeyBtn label="^C" a11y={t("terminal.keys.int")} onPress={() => send("\x03")} isDark={isDark} dim={!connected} />
        <ArrowBtn dir="left" a11y={t("terminal.keys.left")} onPress={() => pressArrow("left")} isDark={isDark} dim={!connected} />
        <ArrowBtn dir="up" a11y={t("terminal.keys.up")} onPress={() => pressArrow("up")} isDark={isDark} dim={!connected} />
        <ArrowBtn dir="down" a11y={t("terminal.keys.down")} onPress={() => pressArrow("down")} isDark={isDark} dim={!connected} />
        <ArrowBtn dir="right" a11y={t("terminal.keys.right")} onPress={() => pressArrow("right")} isDark={isDark} dim={!connected} />
        <TouchableOpacity
          accessibilityLabel={t("terminal.keys.keyboard")}
          onPress={toggleTyping}
          style={[styles.key, isDark && styles.keyDark, typing && styles.keyActive]}
          disabled={!connected}
        >
          <Ionicons name="keypad-outline" size={18} color={typing ? "#ffffff" : isDark ? "#e5e5e5" : "#0a0a0a"} />
        </TouchableOpacity>
      </View>
      {typing && (
        <TextInput
          key={inputKey}
          ref={input}
          defaultValue=""
          onChangeText={onBufChange}
          onKeyPress={onInputKeyPress}
          onSubmitEditing={submitBuf}
          onBlur={() => setTyping(false)}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          blurOnSubmit={false}
          returnKeyType="go"
          accessibilityLabel={t("terminal.inputLabel")}
          style={styles.hiddenInput}
        />
      )}
    </KeyboardAvoidingView>
  )
}

function KeyBtn({
  label,
  a11y,
  onPress,
  isDark,
  dim,
  active,
}: {
  label: string
  a11y: string
  onPress: () => void
  isDark: boolean
  dim: boolean
  active?: boolean
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={a11y}
      onPress={onPress}
      disabled={dim}
      style={[styles.key, isDark && styles.keyDark, active && styles.keyActive, dim && styles.keyDim]}
    >
      <Text numberOfLines={1} style={[styles.keyLabel, isDark && styles.keyLabelDark, active && styles.keyLabelActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

function ArrowBtn({
  dir,
  a11y,
  onPress,
  isDark,
  dim,
}: {
  dir: keyof typeof ARROWS
  a11y: string
  onPress: () => void
  isDark: boolean
  dim: boolean
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={a11y}
      onPress={onPress}
      disabled={dim}
      style={[styles.key, isDark && styles.keyDark, dim && styles.keyDim]}
    >
      <Ionicons name={ARROWS[dir].icon} size={18} color={isDark ? "#e5e5e5" : "#0a0a0a"} />
    </TouchableOpacity>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  centerDark: {
    backgroundColor: "#0a0a0a",
  },
  centerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
    textAlign: "center",
  },
  centerBody: {
    fontSize: 14,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  textDark: {
    color: "#ffffff",
  },
  metaDark: {
    color: "#888888",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  bannerDark: {
    borderBottomColor: "#1a1a1a",
  },
  bannerText: {
    fontSize: 13,
    color: "#0a0a0a",
    flexShrink: 1,
  },
  bannerError: {
    backgroundColor: "#fef2f2",
    borderBottomColor: "#fecaca",
  },
  bannerErrorText: {
    fontSize: 13,
    color: "#dc2626",
    flex: 1,
  },
  bannerRetry: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc2626",
  },
  bannerAction: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0ea5e9",
  },
  term: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webviewDark: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#f5f5f5",
  },
  keyRowDark: {
    borderTopColor: "#1a1a1a",
    backgroundColor: "#111111",
  },
  key: {
    flex: 1,
    minWidth: 0,
    height: 40,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    justifyContent: "center",
    alignItems: "center",
  },
  keyDark: {
    backgroundColor: "#1a1a1a",
    borderColor: "#333333",
  },
  keyActive: {
    backgroundColor: "#0ea5e9",
    borderColor: "#0ea5e9",
  },
  keyDim: {
    opacity: 0.4,
  },
  keyLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  keyLabelDark: {
    color: "#e5e5e5",
  },
  keyLabelActive: {
    color: "#ffffff",
  },
  hiddenInput: {
    height: 0,
    opacity: 0,
  },
})
