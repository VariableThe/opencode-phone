import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native"
import { useAppPalette } from "../../src/components/useAppPalette"
import { GUTTER_USER, monoFont } from "../../src/components/chat/tui"
import { useLocalSearchParams, Stack, useRouter, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTranslation } from "react-i18next"
import * as ImagePicker from "expo-image-picker"
import * as ImageManipulator from "expo-image-manipulator"
import * as Clipboard from "expo-clipboard"
import type BottomSheet from "@gorhom/bottom-sheet"
// KeyboardAvoidingView from react-native-keyboard-controller (not react-native
// core): core KAV relies on legacy Keyboard events whose metrics misreport
// under Android's mandatory edge-to-edge mode (Expo SDK 54 / RN 0.81), leaving
// the composer hidden behind the keyboard. This library drives avoidance from
// native WindowInsets and is the standard fix for that setup.
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import {
  MessageBubble,
  PermissionPrompt,
  QuestionPrompt,
  StatusIndicator,
  SlashPopover,
  ModelPicker,
  AgentPicker,
  VariantPicker,
  ImageAttachments,
  SessionInfo,
  MessageTextSheet,
  type SlashCommand,
  type Attachment,
} from "../../src/components/chat"
import { useSessions } from "../../src/stores/sessions"
import { useEvents, refreshPending } from "../../src/stores/events"
import { useSubagents } from "../../src/stores/subagents"
import { useConnections } from "../../src/stores/connections"
import { useAuth } from "../../src/stores/auth"
import { useCatalog } from "../../src/stores/catalog"
import { useSpeech } from "../../src/lib/speech"
import { messagePartsToSelectableText } from "../../src/lib/message-text"
import { mergeCommandList, resolveSlash } from "../../src/lib/composer-queue"

// --- Builtin slash commands ---
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    trigger: "new",
    title: "New Session",
    description: "Start a new session",
    icon: "add-circle-outline",
    type: "builtin",
  },
  {
    trigger: "model",
    title: "Switch Model",
    description: "Choose a different model",
    icon: "hardware-chip-outline",
    type: "builtin",
  },
  {
    trigger: "agent",
    title: "Switch Agent",
    description: "Cycle to next agent",
    icon: "person-outline",
    type: "builtin",
  },
]

function getShortDir(dir?: string): string | null {
  if (!dir) return null
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] || null
}

export default function SessionScreen() {
  const { id, directory } = useLocalSearchParams<{ id: string; directory?: string }>()
  const router = useRouter()
  // Server-theme colors for the whole screen: the TUI transcript style is the
  // design for everyone, painted from the palette (server theme when the
  // toggle matches, tokyonight-derived built-ins otherwise).
  const { isDark, palette: p, themed } = useAppPalette()
  const mono = monoFont(Platform.OS)
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  const flatListRef = useRef<FlatList>(null)
  const modelSheetRef = useRef<BottomSheet>(null)
  const agentSheetRef = useRef<BottomSheet>(null)
  const variantSheetRef = useRef<BottomSheet>(null)
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showInfo, setShowInfo] = useState(false)
  // Raw text of the message opened in the full-screen selection sheet
  const [textSheet, setTextSheet] = useState<string | null>(null)

  const {
    currentSession,
    messages,
    parts,
    isLoading,
    loadingMore,
    hasMore,
    error,
    selectSession,
    sendMessage,
    abortSession,
    loadOlderMessages,
    revertToMessage,
    unrevertSession,
    cancelQueued,
  } = useSessions()

  // Derive sending state for this specific session
  const isSending = useSessions((s) => !!(currentSession && s.sending[currentSession.id]))
  // Session busy (SSE truth) drives queue delivery; v1 servers have no inbox
  // API so they always send immediately.
  const isBusy = useEvents((s) => (currentSession ? s.sessionStatus[currentSession.id]?.type === "busy" : false))
  const isV1 = useConnections((s) => s.activeConnection?.api === "v1")
  // Queued (accepted, not yet delivered) inbox ids for this session.
  const queuedBySession = useSessions((s) => s.queued)
  const queuedSet = useMemo(
    () => new Set(currentSession ? queuedBySession[currentSession.id] || [] : []),
    [queuedBySession, currentSession],
  )

  const { authenticateForMessage } = useAuth()
  const { client, clientForDirectory } = useConnections()

  // Use directory-aware client for sessions that belong to a project other than the active one
  const sessionClient = useMemo(
    () => (currentSession?.directory ? (clientForDirectory(currentSession.directory) ?? client) : client),
    [currentSession?.directory, clientForDirectory, client],
  )

  // Catalog
  const catalog = useCatalog()
  const agents = Array.isArray(catalog.agents) ? catalog.agents : []
  const serverCommands = Array.isArray(catalog.commands) ? catalog.commands : []
  const providers = Array.isArray(catalog.providers) ? catalog.providers : []
  const agent = catalog.agent || ""
  const model = catalog.model
  const switchAgent = catalog.switchAgent
  const switchModel = catalog.switchModel
  const variant = catalog.variant
  const setVariant = catalog.setVariant
  const cycleAgent = catalog.cycleAgent

  // Permission & question state
  const sessionID = currentSession?.id
  const permissions = useEvents((s) => (sessionID ? s.permissions[sessionID] : undefined)) || []
  const questions = useEvents((s) => (sessionID ? s.questions[sessionID] : undefined)) || []

  const shortDir = getShortDir(currentSession?.directory)
  const [showScrollButton, setShowScrollButton] = useState(false)

  // SSE reconnect banner
  const reconnectAttempts = useEvents((s) => s.reconnectAttempts)
  const [showConnectedFlash, setShowConnectedFlash] = useState(false)
  const prevReconnecting = useRef(false)

  // Voice input — transcript appends to the text input on completion
  const speech = useSpeech(
    useCallback((text: string) => {
      setInput((prev) => (prev ? prev + " " + text : text))
    }, []),
  )

  // Surface speech recognition failures (e.g. mic permission denied). Keyed
  // on the error value itself so it only fires once per distinct error, not
  // on every re-render while it remains set.
  useEffect(() => {
    if (!speech.error) return
    Alert.alert(t("session.alerts.speechErrorTitle"), t("session.alerts.speechErrorMessage"))
  }, [speech.error, t])

  // Slash command state. The popover stays open while the user types arguments
  // after the command name — filtering always runs on the first token only.
  const firstToken = input.startsWith("/") ? input.split(" ")[0] : ""
  const slashActive = input.startsWith("/") && !input.includes("\n")
  const slashQuery = slashActive ? firstToken.slice(1) : ""

  // Local builtins shadow same-named server commands (see composer-queue.ts
  // for the precedence rule) — builtins sort first, collisions dropped.
  const allCommands = useMemo<SlashCommand[]>(() => {
    const custom: SlashCommand[] = serverCommands.map((cmd) => ({
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      icon: "code-slash-outline",
      type: "custom",
    }))
    return mergeCommandList(BUILTIN_COMMANDS, custom)
  }, [serverCommands])

  // While a revert is pending, the reverted message and everything after it
  // still exist server-side (cleanup only runs on the next prompt/unrevert)
  // — hide them client-side so editing feels immediate. Message IDs are
  // lexicographically sortable, same comparison the TUI uses. Optimistic
  // "temp-" IDs (assigned client-side before the server responds, see
  // sendMessage) aren't part of that sort order — always keep them so a
  // message sent concurrently with a revert isn't hidden.
  const revertMessageID = currentSession?.revert?.messageID

  // Inverted FlatList: data is reversed (newest first) so newest renders at bottom
  const messageData = useMemo(
    () =>
      (messages || [])
        .filter((msg) => !revertMessageID || msg.id.startsWith("temp-") || msg.id < revertMessageID)
        .map((msg) => ({
          message: msg,
          parts: (parts && parts[msg.id]) || [],
        }))
        .reverse(),
    [messages, parts, revertMessageID],
  )

  // Tracks the latest composer text without pulling `input` into startEditFlow's
  // deps — kept as a plain ref assignment (not state) so the callback stays
  // referentially stable across keystrokes for MessageBubble's memo comparator.
  const inputRef = useRef(input)
  inputRef.current = input

  const applyRevertResult = useCallback((result: Awaited<ReturnType<typeof revertToMessage>>) => {
    if (!result.ok) {
      if (result.reason === "unsupported") {
        Alert.alert(t("session.alerts.notSupportedTitle"), t("session.alerts.notSupportedMessage"))
      } else if (result.reason === "auth") {
        Alert.alert(t("session.alerts.revertAuthFailedTitle"), t("session.alerts.revertAuthFailedMessage"))
      } else {
        Alert.alert(t("session.alerts.editFailedTitle"), t("session.alerts.editFailedMessage"))
      }
      return
    }
    setInput(result.text)
    // Restore attachments in the same shape the composer's own picker
    // functions (pickFromLibrary/pickFromCamera/pasteFromClipboard) use.
    setAttachments(
      result.files
        .filter((f): f is typeof f & { url: string; mime: string } => !!f.url && !!f.mime)
        .map((f) => ({ uri: f.url, mime: f.mime, filename: f.filename })),
    )
  }, [t])

  // Full-screen selectable view: native text selection can't be trusted inside
  // FlatList rows on Android (react-native#46999), so selection happens in a
  // plain ScrollView outside the list. Reached from the assistant bubble's
  // "Select text" button (a tap — assistant bubbles have no long-press) and
  // from the user bubble's long-press action sheet. Covers the whole message:
  // assistant text, reasoning and tool calls (name/input/result/error), not
  // just text parts. Stable so MessageBubble's memo comparator can bail early.
  const openSelectTextSheet = useCallback(
    (messageID: string) => {
      const messageParts = useSessions.getState().parts[messageID] || []
      setTextSheet(
        messagePartsToSelectableText(messageParts, {
          thinking: t("session.sheet.thinking"),
          tool: t("session.sheet.tool"),
          input: t("session.sheet.input"),
          result: t("session.sheet.result"),
          error: t("session.sheet.error"),
          file: t("session.sheet.file"),
        }),
      )
    },
    [t],
  )

  // Editing a user message reverts the session to it and loads it into the
  // composer. Reached from the user bubble's "Edit" button and from its
  // long-press action sheet. Stable so MessageBubble's memo comparator bails.
  const startEditFlow = useCallback(
    (messageID: string) => {
      const doRevert = async () => {
        const result = await useSessions.getState().revertToMessage(messageID)
        applyRevertResult(result)
      }
      // Editing overwrites the composer — don't silently clobber an
      // in-progress unsent draft.
      if (inputRef.current.trim()) {
        Alert.alert(
          t("session.alerts.replaceDraftTitle"),
          t("session.alerts.replaceDraftMessage"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("session.actions.replace"), style: "destructive", onPress: doRevert },
          ],
          { cancelable: false },
        )
        return
      }
      doRevert()
    },
    [applyRevertResult, t],
  )

  // Message actions live in the bubble header as buttons (Select text / Edit),
  // so there is no long-press action sheet here any more — holding a message
  // must not pop a menu, because a long-press on the bubble competed with
  // horizontal scrolling in code blocks and with text selection.

  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated })
  }, [])

  // Re-select on every focus, not just mount. currentSession/messages/
  // permissions are a single global store, and the native stack keeps screens
  // underneath a pushed one mounted. Without re-selecting on focus, navigating
  // to another session and back would leave this screen bound to the *other*
  // session's data (and its permission/question prompts) — so a user could
  // approve the wrong session's tool call. useFocusEffect re-binds this screen
  // to its own session whenever it becomes visible again.
  useFocusEffect(
    useCallback(() => {
      if (!id) return
      let cancelled = false
      selectSession(id, directory).then(() => {
        // Re-fetch pending permissions/questions from the server to recover from
        // missed SSE events or failed optimistic removals
        const connState = useConnections.getState()
        const c = directory ? (connState.clientForDirectory(directory) ?? connState.client) : connState.client
        if (!c) return
        refreshPending(c, id)
        // Discover child (subagent) sessions so their live activity renders
        // nested under the delegating tool call — and their past work survives
        // a reload via the same fetch. Untracked on blur below.
        if (!cancelled) void useSubagents.getState().trackParent(id, c)
      })
      return () => {
        cancelled = true
        useSubagents.getState().untrackParent(id)
      }
    }, [id, directory]),
  )

  // Adopt the SESSION's stored agent/model once per session — the server
  // is the source of truth (a switch persists there and survives
  // navigation), so the chips reflect stored state instead of local guesses.
  // Deliberately NOT re-run on new messages: that reverted an explicit user
  // switch back to whatever the last assistant message carried.
  const syncedSessionID = useRef<string | null>(null)
  useEffect(() => {
    const sessionID = currentSession?.id
    if (!sessionID || syncedSessionID.current === sessionID) return
    syncedSessionID.current = sessionID
    const store = useCatalog.getState()
    if (currentSession.agent && store.agents.some((a) => a.name === currentSession.agent)) {
      store.setAgent(currentSession.agent)
    }
    const stored = currentSession.model
    if (stored && store.providers.some((p) => p.id === stored.providerID && p.models.some((m) => m.id === stored.modelID))) {
      store.setModel({ providerID: stored.providerID, modelID: stored.modelID })
    }
  }, [currentSession?.id])

  // Slash command handler
  // Local builtin actions shared by popover selection and by sending a
  // builtin line (`/model`, ...) directly.
  const runBuiltin = useCallback(
    (trigger: string) => {
      switch (trigger) {
        case "new":
          router.back()
          return
        case "model":
          setInput("")
          modelSheetRef.current?.expand()
          return
        case "agent":
          setInput("")
          cycleAgent()
          return
      }
    },
    [router, cycleAgent],
  )

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.type === "builtin") {
        runBuiltin(cmd.trigger)
        return
      }
      // Server command: swap the name token, keep any arguments already typed.
      const rest = input.startsWith("/") ? input.slice(firstToken.length) : ""
      setInput(`/${cmd.trigger}${rest.startsWith(" ") || rest === "" ? rest : ` ${rest}`}`)
    },
    [runBuiltin, input, firstToken],
  )

  // --- Image picking ---

  // Convert any image (including HEIC/HEIF from iOS) to guaranteed JPEG bytes
  const MAX_DIMENSION = 1568 // Anthropic recommended max
  async function toJpeg(uri: string, width: number, height: number): Promise<Attachment> {
    const actions: ImageManipulator.Action[] = []
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height)
      actions.push({ resize: { width: Math.round(width * scale), height: Math.round(height * scale) } })
    }
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.8,
      base64: true,
    })
    return {
      uri: result.uri,
      mime: "image/jpeg",
      filename: "image.jpg",
      width: result.width,
      height: result.height,
      base64: result.base64 || undefined,
    }
  }

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1, // full quality - we compress in manipulator
    })
    if (result.canceled) return
    const settled = await Promise.allSettled(result.assets.map((a) => toJpeg(a.uri, a.width, a.height)))
    const items = settled.filter((r) => r.status === "fulfilled").map((r) => r.value)
    if (items.length) setAttachments((prev) => [...prev, ...items])
    if (settled.some((r) => r.status === "rejected")) {
      console.error(
        "Failed to process image(s):",
        settled.filter((r) => r.status === "rejected").map((r) => r.reason),
      )
      Alert.alert(t("session.alerts.imageFailedTitle"), t("session.alerts.imageFailedMessage"))
    }
  }, [t])

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t("session.alerts.cameraPermissionTitle"), t("session.alerts.cameraPermissionMessage"))
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 })
    if (result.canceled) return
    const a = result.assets[0]
    try {
      const item = await toJpeg(a.uri, a.width, a.height)
      setAttachments((prev) => [...prev, item])
    } catch (err) {
      console.error("Failed to process photo:", err)
      Alert.alert(t("session.alerts.imageFailedTitle"), t("session.alerts.imageFailedMessage"))
    }
  }, [t])

  const pasteFromClipboard = useCallback(async () => {
    // Try image first
    const hasImage = await Clipboard.hasImageAsync()
    if (hasImage) {
      const img = await Clipboard.getImageAsync({ format: "png" })
      if (img?.data) {
        const uri = img.data.startsWith("data:") ? img.data : `data:image/png;base64,${img.data}`
        const item = await toJpeg(uri, img.size.width, img.size.height)
        setAttachments((prev) => [...prev, item])
        return
      }
    }
    // Fall back to text
    const hasText = await Clipboard.hasStringAsync()
    if (hasText) {
      const text = await Clipboard.getStringAsync()
      if (text) {
        setInput((prev) => prev + text)
        return
      }
    }
    Alert.alert(t("session.alerts.emptyClipboardTitle"), t("session.alerts.emptyClipboardMessage"))
  }, [t])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // --- Send ---
  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return
    const authenticated = await authenticateForMessage()
    if (!authenticated) {
      Alert.alert(t("session.alerts.authRequiredTitle"), t("session.alerts.authRequiredMessage"))
      return
    }

    const text = input.trim()
    const files = [...attachments]

    // Slash lines never send as literal chat text. Bare "/" names nothing,
    // builtins run locally (shadowing same-named server commands), server
    // commands POST to the session command route with their argument text,
    // and anything else gets a truthful unknown-command message.
    if (text.startsWith("/") && files.length === 0) {
      const resolution = resolveSlash(
        text,
        BUILTIN_COMMANDS.map((c) => c.trigger),
        serverCommands.map((c) => c.name),
      )
      if (resolution.kind === "bare") {
        Alert.alert(t("session.alerts.bareCommandTitle"), t("session.alerts.bareCommandMessage"))
        return
      }
      if (resolution.kind === "builtin") {
        setInput("")
        runBuiltin(resolution.name)
        return
      }
      if (resolution.kind === "server") {
        if (!sessionClient || !currentSession) return
        const target = currentSession
        setInput("")
        setAttachments([])
        const failure: unknown = await sessionClient.session
          .command(target.id, {
            command: resolution.name,
            arguments: resolution.args,
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
          })
          .then(
            () => null,
            (err) => err,
          )
        if (failure) {
          const detail = failure instanceof Error ? failure.message : String(failure)
          Alert.alert(
            t("session.alerts.commandFailedTitle"),
            t("session.alerts.commandFailedMessage", { name: resolution.name, detail }),
          )
        }
        return
      }
      Alert.alert(t("session.alerts.unknownCommandTitle"), t("session.alerts.unknownCommandMessage", { name: resolution.name }))
      return
    }

    // A busy session must not swallow the follow-up or blow away the running
    // turn: `delivery: "queue"` parks it in the server inbox (shown pending
    // until `inbox.delivered`). Idle sends go immediately with no delivery
    // flag, and v1 connections always send immediately (no inbox API).
    const delivery = isBusy && !isV1 ? ("queue" as const) : undefined
    setInput("")
    setAttachments([])
    try {
      await sendMessage(text, model || undefined, agent || undefined, files, variant || undefined, delivery)
    } catch (err) {
      console.error("Send failed:", err)
      // Restore the user's text and attachments so their input isn't lost.
      setInput((prev) => (prev ? prev : text))
      setAttachments((prev) => (prev.length ? prev : files))
      Alert.alert(t("session.alerts.sendFailedTitle"), t("session.alerts.sendFailedMessage"))
    }
  }

  // Cancel a queued message (DELETE .../inbox/{id}); the bubble is already
  // gone optimistically, so a failure restores it and says so.
  const handleCancelQueued = useCallback(
    async (messageID: string) => {
      const result = await cancelQueued(messageID)
      if (!result.ok) {
        Alert.alert(t("session.alerts.queueCancelFailedTitle"), t("session.alerts.queueCancelFailedMessage"))
      }
    },
    [cancelQueued, t],
  )

  // Editing a queued message is cancel-and-resend: the server cannot edit
  // queued text (PATCH only moves the delivery mode), so drop the queued
  // entry and prefill the composer with its text.
  const handleQueuedEdit = useCallback(
    async (messageID: string) => {
      const messageParts = useSessions.getState().parts[messageID] || []
      const queuedText = messageParts
        .filter((p) => p.type === "text")
        .map((p) => p.text || "")
        .join("\n")
      const doResend = async () => {
        const result = await useSessions.getState().cancelQueued(messageID)
        if (!result.ok) {
          Alert.alert(t("session.alerts.queueCancelFailedTitle"), t("session.alerts.queueCancelFailedMessage"))
          return
        }
        setInput(queuedText)
      }
      if (inputRef.current.trim()) {
        Alert.alert(
          t("session.alerts.replaceDraftTitle"),
          t("session.alerts.replaceDraftMessage"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("session.actions.replace"), style: "destructive", onPress: doResend },
          ],
          { cancelable: false },
        )
        return
      }
      void doResend()
    },
    [t],
  )

  // One stable edit entry point for bubbles: queued items cancel-and-resend,
  // committed messages run the revert flow. Reads the queue from the store
  // directly so MessageBubble's memo comparator stays effective.
  const handleBubbleEdit = useCallback(
    (messageID: string) => {
      const state = useSessions.getState()
      const ids = state.currentSession ? state.queued[state.currentSession.id] || [] : []
      if (ids.includes(messageID)) {
        void handleQueuedEdit(messageID)
        return
      }
      startEditFlow(messageID)
    },
    [handleQueuedEdit, startEditFlow],
  )

  // In inverted mode, offset 0 = bottom. Show scroll button when scrolled away from bottom.
  const handleScroll = useCallback((event: any) => {
    const { contentOffset } = event.nativeEvent
    setShowScrollButton(contentOffset.y > 200)
  }, [])

  // Debounce: onEndReached can fire multiple times during a single scroll gesture
  const loadingTriggered = useRef(false)
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loadingTriggered.current) {
      loadingTriggered.current = true
      loadOlderMessages()
    }
  }, [hasMore, loadingMore, loadOlderMessages])

  // Reset trigger when loading finishes
  useEffect(() => {
    if (!loadingMore) loadingTriggered.current = false
  }, [loadingMore])

  // Detect reconnecting → stable transition for the "Connected ✓" flash.
  // reconnectAttempts and lastDisconnectAt reset in the same set() call, so we
  // can't use lastDisconnectAt alone; a useRef tracks the prior reconnecting state.
  useEffect(() => {
    const isReconnecting = reconnectAttempts > 0
    if (prevReconnecting.current && !isReconnecting) {
      setShowConnectedFlash(true)
      const t = setTimeout(() => setShowConnectedFlash(false), 2000)
      return () => clearTimeout(t)
    }
    prevReconnecting.current = isReconnecting
  }, [reconnectAttempts])

  const handlePermissionReply = async (requestID: string, reply: "once" | "always" | "reject") => {
    if (!sessionClient || !sessionID) return
    // Snapshot for rollback
    const snapshot = useEvents.getState().permissions[sessionID] || []
    // Optimistically remove from UI
    useEvents.setState((state) => ({
      permissions: {
        ...state.permissions,
        [sessionID]: snapshot.filter((p) => p.id !== requestID),
      },
    }))
    try {
      await sessionClient.permission.reply(requestID, reply)
    } catch (err) {
      console.error("Permission reply failed:", err)
      // Restore the prompt so the user can retry
      useEvents.setState((state) => ({
        permissions: { ...state.permissions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.replyFailedTitle"), t("session.alerts.replyFailedMessage"))
    }
  }

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    if (!sessionClient || !sessionID) return
    const snapshot = useEvents.getState().questions[sessionID] || []
    useEvents.setState((state) => ({
      questions: {
        ...state.questions,
        [sessionID]: snapshot.filter((q) => q.id !== requestID),
      },
    }))
    try {
      await sessionClient.question.reply(requestID, answers)
    } catch (err) {
      console.error("Question reply failed:", err)
      useEvents.setState((state) => ({
        questions: { ...state.questions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.replyFailedTitle"), t("session.alerts.replyFailedMessage"))
    }
  }

  const handleQuestionReject = async (requestID: string) => {
    if (!sessionClient || !sessionID) return
    const snapshot = useEvents.getState().questions[sessionID] || []
    useEvents.setState((state) => ({
      questions: {
        ...state.questions,
        [sessionID]: snapshot.filter((q) => q.id !== requestID),
      },
    }))
    try {
      await sessionClient.question.reject(requestID)
    } catch (err) {
      console.error("Question reject failed:", err)
      useEvents.setState((state) => ({
        questions: { ...state.questions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.rejectFailedTitle"), t("session.alerts.rejectFailedMessage"))
    }
  }

  // Agent/model switches persist as v2 session state (POST + re-read
  // confirmation in the catalog store). Local state changes only after the
  // server confirms — a rejected switch alerts and the chips keep showing
  // the stored values instead of a phantom selection.
  const handleModelSelect = useCallback(
    async (providerID: string, modelID: string) => {
      if (!currentSession) {
        useCatalog.getState().setModel({ providerID, modelID })
        return
      }
      const result = await switchModel(currentSession.id, { providerID, modelID }, sessionClient ?? undefined)
      if (!result.ok) {
        Alert.alert(t("session.alerts.switchFailedTitle"), t("session.alerts.switchFailedMessage"))
      }
    },
    [currentSession, sessionClient, switchModel, t],
  )

  const handleAgentSelect = useCallback(
    async (name: string) => {
      if (!currentSession) return
      const result = await switchAgent(currentSession.id, name, sessionClient ?? undefined)
      if (!result.ok) {
        Alert.alert(t("session.alerts.switchFailedTitle"), t("session.alerts.switchFailedMessage"))
      }
    },
    [currentSession, sessionClient, switchAgent, t],
  )

  // Current agent display
  const currentAgent = agents.find((a) => a.name === agent)
  const agentColor = currentAgent?.color || "#8b5cf6"
  const modelLabel = model?.modelID ? model.modelID.split("/").pop() || model.modelID : "default"

  // Variants for current model (for reasoning effort picker)
  const currentModelVariants = useMemo(() => {
    if (!model) return undefined
    const provider = providers.find((p) => p.id === model.providerID)
    const found = provider?.models.find((m) => m.id === model.modelID)
    return found?.variants
  }, [model, providers])

  return (
    <>
      <Stack.Screen
        options={{
          title: currentSession?.title || t("session.titleFallback"),
          headerRight: () => (
            <View style={s.headerRight}>
              {/* TUI status line: agent · model · directory, dim and compact */}
              <Text style={[s.statusLine, { fontFamily: mono, color: p.muted }]} numberOfLines={1}>
                {agent || "build"} · {modelLabel}
                {shortDir ? ` · ${shortDir}` : ""}
              </Text>
              <TouchableOpacity onPress={() => setShowInfo((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showInfo ? "stats-chart" : "stats-chart-outline"}
                  size={20}
                  color={showInfo ? p.info : p.muted}
                />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={[s.container, isDark && s.containerDark, themed && { backgroundColor: p.background }]}
        // "padding" pushes the composer/toolbar above the keyboard. On Android
        // the padding is driven by react-native-keyboard-controller's native
        // inset tracking (see import note above); on iOS by the keyboard frame
        // events. History: this screen previously used the core RN KAV with
        // behavior="padding" (#147), which regressed under edge-to-edge — the
        // core component's JS-measured keyboard height no longer matched the
        // real inset, so the input stayed hidden behind the keyboard.
        behavior="padding"
        // automaticOffset: measure this view's true on-screen position via
        // native viewPositionInWindow instead of the layout-relative frame.
        // Under RN core edge-to-edge the content area is already inset by
        // status/nav bars, so layout-relative math under-counts the keyboard
        // padding by exactly those insets (composer ends up partly behind the
        // keyboard — measured 609px of padding for an 820px IME inset).
        automaticOffset
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {/* Session info pulldown */}
        <SessionInfo
          session={currentSession}
          messages={messages || []}
          providers={providers}
          visible={showInfo}
          isDark={isDark}
          palette={p}
          hasMore={hasMore}
          loadingAll={loadingMore}
          onLoadAll={() => {
            if (hasMore && !loadingMore) loadOlderMessages()
          }}
          onScrollToTop={() => {
            flatListRef.current?.scrollToEnd({ animated: true })
          }}
          onClose={() => setShowInfo(false)}
        />

        {/* Full-screen selectable text (message action sheet -> "Select text") */}
        <MessageTextSheet visible={textSheet !== null} text={textSheet ?? ""} onClose={() => setTextSheet(null)} />

        {/* Session error (agent run failed) — session.error SSE event sets
            this while the user is viewing the session. Dismissible; also
            cleared by the next send. */}
        {error && (
          <View style={[s.banner, s.bannerError]}>
            <Text style={[s.bannerText, s.bannerErrorText]} numberOfLines={3}>
              {error}
            </Text>
            <TouchableOpacity onPress={() => useSessions.setState({ error: null })} hitSlop={8}>
              <Text style={s.bannerErrorAction}>{t("session.banners.dismiss")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* SSE reconnect/connected banner */}
        {reconnectAttempts > 0 && (
          <View style={[s.banner, s.bannerReconnecting]}>
            <Text style={s.bannerText}>{t("session.banners.reconnecting", { attempt: reconnectAttempts })}</Text>
          </View>
        )}
        {showConnectedFlash && reconnectAttempts === 0 && (
          <View style={[s.banner, s.bannerConnected]}>
            <Text style={s.bannerText}>{t("session.banners.connected")}</Text>
          </View>
        )}

        {/* Pending revert (from "Edit message") — offer a way back before it's
            cleaned up by the next prompt. */}
        {revertMessageID && (
          <View style={[s.banner, s.bannerRevert]}>
            <Text style={s.bannerText}>{t("session.banners.reverted")}</Text>
            <TouchableOpacity
              onPress={() => {
                unrevertSession()
                // The composer was prefilled with the reverted message's text/
                // attachments (see applyRevertResult) — clear it so Undo doesn't
                // leave a stale draft that could be sent as a duplicate.
                setInput("")
                setAttachments([])
              }}
              hitSlop={8}
            >
              <Text style={s.bannerAction}>{t("session.banners.undo")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isLoading ? (
          <View style={s.loading}>
            <ActivityIndicator size="large" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
          </View>
        ) : (
          <View style={s.listWrap}>
            <FlatList
              ref={flatListRef}
              data={messageData}
              inverted
              keyExtractor={(item) => item.message.id}
              renderItem={({ item }) => (
                <MessageBubble
                  message={item.message}
                  parts={item.parts}
                  isDark={isDark}
                  palette={p}
                  queued={queuedSet.has(item.message.id)}
                  onSelectText={openSelectTextSheet}
                  onEdit={handleBubbleEdit}
                  onCancelQueued={handleCancelQueued}
                />
              )}
              contentContainerStyle={s.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              // Prevent jump when older messages are prepended
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              ListFooterComponent={
                loadingMore ? (
                  <View style={s.loadingMore}>
                    <ActivityIndicator size="small" color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
                    <Text style={[s.loadingMoreText, isDark && s.metaDark, themed && { color: p.muted }]}>
                      {t("session.loadingOlder")}
                    </Text>
                  </View>
                ) : null
              }
            />
            {/* Empty state rendered OUTSIDE the inverted list to avoid the
                inverted transform mirroring its text/icon (see #ui-mirror). */}
            {messageData.length === 0 && (
              <View style={s.emptyOverlay} pointerEvents="none">
                <Ionicons name="chatbubble-outline" size={48} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
                <Text style={[s.emptyText, isDark && s.metaDark, themed && { color: p.muted }]}>
                  {t("session.empty.title")}
                </Text>
                <Text style={[s.emptyHint, isDark && s.metaDark, themed && { color: p.muted }]}>
                  {t("session.empty.hint")}
                </Text>
              </View>
            )}
            {showScrollButton && (
              <TouchableOpacity
                style={[s.scrollBtn, isDark && s.scrollBtnDark, themed && { backgroundColor: p.element }]}
                onPress={() => scrollToBottom(true)}
              >
                <Ionicons name="chevron-down" size={24} color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Status */}
        {currentSession && <StatusIndicator sessionID={currentSession.id} isDark={isDark} palette={p} />}

        {/* Permissions */}
        {permissions.map((perm) => (
          <PermissionPrompt
            key={perm.id}
            permission={perm}
            isDark={isDark}
            palette={p}
            onReply={(reply) => handlePermissionReply(perm.id, reply)}
          />
        ))}

        {/* Questions */}
        {questions.map((q) => (
          <QuestionPrompt
            key={q.id}
            request={q}
            isDark={isDark}
            palette={p}
            onReply={(answers) => handleQuestionReply(q.id, answers)}
            onReject={() => handleQuestionReject(q.id)}
          />
        ))}

        {/* Slash popover */}
        {slashActive && (
          <SlashPopover query={slashQuery} commands={allCommands} isDark={isDark} palette={p} onSelect={handleSlashSelect} />
        )}

        {/* Agent/model toolbar: flat TUI chrome, 1px rules, mono labels */}
        <View style={[s.toolbar, { backgroundColor: p.background, borderTopColor: p.borderSubtle }]}>
          <TouchableOpacity
            style={[s.agentChip, { borderColor: p.borderSubtle }]}
            onPress={() => agentSheetRef.current?.expand()}
            onLongPress={() => cycleAgent()}
            testID="agent-chip"
          >
            <View style={[s.agentDot, { backgroundColor: agentColor }]} />
            <Text style={[s.agentLabel, { fontFamily: mono, color: p.text }]}>{agent || "build"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modelChip, { borderColor: p.borderSubtle }]}
            onPress={() => modelSheetRef.current?.expand()}
            testID="model-chip"
          >
            <Text style={[s.modelLabel, { fontFamily: mono, color: p.muted }]} numberOfLines={1}>
              {modelLabel}
            </Text>
          </TouchableOpacity>

          {currentModelVariants && Object.keys(currentModelVariants).length > 0 && (
            <TouchableOpacity
              style={[s.variantChip, { borderColor: variant ? p.accent : p.borderSubtle }]}
              onPress={() => variantSheetRef.current?.expand()}
              testID="variant-chip"
            >
              <Text
                style={[s.variantLabel, { fontFamily: mono, color: variant ? p.accent : p.muted }]}
                numberOfLines={1}
              >
                {variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : t("session.toolbar.auto")}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Attachment preview */}
        <ImageAttachments attachments={attachments} isDark={isDark} onRemove={removeAttachment} />

        {/* Input: terminal prompt — flat, `>` marker, monospace, no bubble */}
        <View
          style={[
            s.inputContainer,
            { backgroundColor: p.background, borderTopColor: p.borderSubtle },
            { paddingBottom: Math.max(12, insets.bottom) },
          ]}
        >
          <View style={s.inputRow}>
            <Text style={[s.promptMark, { fontFamily: mono, color: p.primary }]}>{GUTTER_USER}</Text>
            {/* Attach button */}
            <TouchableOpacity style={s.attachBtn} onPress={pickFromLibrary} onLongPress={pickFromCamera}>
              <Ionicons name="add-circle-outline" size={26} color={p.muted} />
            </TouchableOpacity>

            {/* Clipboard paste button */}
            <TouchableOpacity style={s.attachBtn} onPress={pasteFromClipboard}>
              <Ionicons name="clipboard-outline" size={22} color={p.muted} />
            </TouchableOpacity>

            <TextInput
              style={[s.input, { fontFamily: mono, color: p.text }, speech.listening && s.inputListening]}
              placeholder={
                speech.listening
                  ? t("session.input.placeholderListening")
                  : isSending
                    ? t("session.input.placeholderFollowUp")
                    : t("session.input.placeholderDefault")
              }
              placeholderTextColor={speech.listening ? "#ef4444" : p.muted}
              value={speech.listening ? speech.transcript : input}
              onChangeText={speech.listening ? undefined : setInput}
              editable={!speech.listening}
              multiline
              maxLength={10000}
              testID="chat-message-input"
            />
            {/* Stop button: only when busy and no input */}
            {isSending && !input.trim() && attachments.length === 0 && !speech.listening && (
              <TouchableOpacity style={s.stopBtn} onPress={abortSession}>
                <Ionicons name="stop" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
            {/* Mic button: when no input, not sending, and not listening */}
            {!isSending && !input.trim() && attachments.length === 0 && !speech.listening && (
              <TouchableOpacity style={s.micBtn} onPress={speech.start}>
                <Ionicons name="mic" size={22} color={p.muted} />
              </TouchableOpacity>
            )}
            {/* Listening indicator: tap to stop */}
            {speech.listening && (
              <TouchableOpacity style={s.micBtnActive} onPress={speech.stop}>
                <Ionicons name="mic" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}
            {/* Send button: when there's input */}
            {!speech.listening && (input.trim() || attachments.length > 0) && (
              <TouchableOpacity
                style={[s.sendBtn, { backgroundColor: p.primary }]}
                onPress={handleSend}
                testID="chat-send-button"
              >
                <Ionicons name="send" size={20} color={p.background} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Model picker bottom sheet */}
      <ModelPicker
        sheetRef={modelSheetRef}
        providers={providers}
        selected={model}
        isDark={isDark}
        onSelect={handleModelSelect}
      />

      {/* Agent picker bottom sheet — lists agents from the connected server */}
      <AgentPicker
        sheetRef={agentSheetRef}
        agents={agents}
        selected={agent}
        isDark={isDark}
        onSelect={handleAgentSelect}
      />

      {/* Reasoning effort (variant) picker bottom sheet */}
      <VariantPicker
        sheetRef={variantSheetRef}
        variants={currentModelVariants}
        selected={variant}
        isDark={isDark}
        onSelect={setVariant}
      />
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  listWrap: { flex: 1, position: "relative" },

  // Messages: full-width TUI blocks carry their own gutters + rules, so the
  // list adds no horizontal padding.
  messageList: { paddingVertical: 8 },

  // Scroll button
  scrollBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollBtnDark: { backgroundColor: "#2a2a2a" },

  // Loading more (appears at top in inverted list = ListFooterComponent)
  loadingMore: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  loadingMoreText: { fontSize: 13, color: "#999999" },

  // Empty state overlay — sits on top of the (empty) inverted list, untransformed,
  // so its text/icon render upright and un-mirrored on Android.
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },

  // Empty
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 64 },
  emptyText: { fontSize: 16, color: "#999999", marginTop: 12 },
  emptyHint: { fontSize: 13, color: "#bbbbbb", marginTop: 4 },
  metaDark: { color: "#666666" },
  textWhite: { color: "#ffffff" },

  // Toolbar: flat TUI chrome
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  toolbarDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  agentDot: { width: 8, height: 8, borderRadius: 4 },
  agentLabel: { fontSize: 12, fontWeight: "600" },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modelChipDark: { backgroundColor: "#1a1a1a" },
  modelLabel: { fontSize: 12, maxWidth: 160 },

  // Variant (reasoning effort) chip
  variantChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  variantChipDark: { backgroundColor: "#1a1a1a" },
  variantChipActive: { backgroundColor: "#f5f3ff" },
  variantLabel: { fontSize: 12 },
  variantLabelActive: { color: "#8b5cf6" },

  // Input: terminal prompt
  inputContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  inputContainerDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  promptMark: {
    fontSize: 18,
    fontWeight: "700",
    paddingBottom: 8,
    paddingRight: 2,
  },
  attachBtn: {
    width: 36,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  inputDark: { backgroundColor: "#1a1a1a", color: "#ffffff" },
  inputListening: { borderWidth: 1, borderColor: "#ef4444" },
  sendBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#cccccc" },
  micBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  micBtnActive: {
    width: 40,
    height: 40,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  stopBtn: {
    width: 40,
    height: 40,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  // Header status line: agent · model · directory, dim and compact
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusLine: { fontSize: 12, maxWidth: 220 },

  // SSE reconnect/connected banner
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignItems: "center",
  },
  bannerReconnecting: { backgroundColor: "#92400e" },
  bannerConnected: { backgroundColor: "#065f46" },
  bannerText: { color: "#ffffff", fontSize: 13, fontWeight: "500" },

  // Session error banner (agent run failed)
  bannerError: {
    backgroundColor: "#991b1b",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  bannerErrorAction: { color: "#fecaca", fontSize: 13, fontWeight: "700" },
  bannerErrorText: { flex: 1 },

  // Pending revert (edit message) banner
  bannerRevert: {
    backgroundColor: "#1e3a8a",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bannerAction: { color: "#93c5fd", fontSize: 13, fontWeight: "700" },
})
