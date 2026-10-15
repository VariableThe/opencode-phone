// Server file browser: lists the active connection's filesystem starting at
// its defaultProjectDir (then GET /api/location, then the server home),
// opens read-only file previews, and creates a new session in the current
// directory with a first prompt ("New session here").
//
// Read-only by design: this screen only calls file.list / file.read and
// session.create / session.prompt — it never writes through the API.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useConnections } from "../src/stores/connections"
import { ApiError, isAuthError, type Client, type FileContent, type FileEntry } from "../src/lib/sdk"
import { sortFileEntries } from "../src/lib/fs-read"
import {
  breadcrumbSegments,
  isAbsolutePath,
  nameOf,
  normalizeAbsolute,
  parentOf,
  resolveWithinRoot,
} from "../src/lib/path-utils"
import { useAppPalette } from "../src/components/useAppPalette"

const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })

export default function BrowseScreen() {
  const { isDark, palette: p, themed } = useAppPalette()
  const { t } = useTranslation()
  const params = useLocalSearchParams<{ dir?: string }>()
  const rawParam = params.dir
  const paramDir = Array.isArray(rawParam) ? rawParam[0] : rawParam

  const activeConnection = useConnections((s) => s.activeConnection)
  const client = useConnections((s) => s.client)
  const clientForDirectory = useConnections((s) => s.clientForDirectory)
  const serverHome = useConnections((s) => s.serverHome)
  const addRecentDirectory = useConnections((s) => s.addRecentDirectory)

  // The configured browse root (the connection's defaultProjectDir). Null
  // means "no jail" — any absolute path is navigable.
  const root = activeConnection?.defaultProjectDir?.trim() || null

  const [dir, setDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [jump, setJump] = useState("")
  const [filePath, setFilePath] = useState<string | null>(null)
  const [file, setFile] = useState<FileContent | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [resolveNonce, setResolveNonce] = useState(0)
  const loadToken = useRef(0)
  const fileToken = useRef(0)
  const sendingInFlight = useRef(false)

  const noConnection = useMemo(() => t("chat.directoryBrowserSheet.noActiveConnection"), [t])

  const load = useCallback(
    (target: string, refresh = false) => {
      const check = resolveWithinRoot(activeConnection?.defaultProjectDir?.trim() || null, target)
      if (!check.ok) {
        setError(t(check.reason === "outside-root" ? "browse.outsideRoot" : "browse.invalidPath"))
        setLoading(false)
        setRefreshing(false)
        return
      }
      const dirClient: Client | null = clientForDirectory(check.path)
      if (!dirClient) {
        setEntries([])
        setError(noConnection)
        setLoading(false)
        setRefreshing(false)
        return
      }
      const token = ++loadToken.current
      setDir(check.path)
      setFilePath(null)
      setFile(null)
      setFileError(null)
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      dirClient.file
        .list({ path: "." })
        .then((items) => {
          if (loadToken.current !== token) return
          setEntries(items)
        })
        .catch((err) => {
          if (loadToken.current !== token) return
          setEntries([])
          if (isAuthError(err)) setError(t("browse.authFailedMessage"))
          else setError(err instanceof Error ? err.message : t("chat.directoryBrowserSheet.listFailed"))
        })
        .finally(() => {
          if (loadToken.current !== token) return
          setLoading(false)
          setRefreshing(false)
        })
    },
    [activeConnection, clientForDirectory, noConnection, t],
  )

  // Resolve the start directory once per connection: explicit `dir` param,
  // then the connection's defaultProjectDir, then GET /api/location, then
  // the server home. Anything else is a fatal state with a manual input.
  useEffect(() => {
    if (!activeConnection || !client) {
      setFatal(noConnection)
      setLoading(false)
      return
    }
    let cancelled = false
    const run = async () => {
      const explicit = paramDir?.trim() || ""
      let start = explicit || root
      if (!start) {
        try {
          start = (await client.project.current()).path.absolute
        } catch {
          start = null
        }
      }
      if (!start && serverHome) start = serverHome
      if (cancelled) return
      if (!start) {
        setFatal(t("browse.noStartDir"))
        setLoading(false)
        return
      }
      const check = resolveWithinRoot(root, start)
      if (!check.ok) {
        setFatal(t(check.reason === "outside-root" ? "browse.outsideRoot" : "browse.invalidPath"))
        setLoading(false)
        return
      }
      setFatal(null)
      load(check.path)
    }
    void run()
    return () => {
      cancelled = true
    }
    // resolveNonce re-runs resolution for the fatal-state retry button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id, client, resolveNonce])

  const openFile = useCallback(
    (entry: FileEntry) => {
      const abs = normalizeAbsolute(entry.absolute)
      const dirClient: Client | null = clientForDirectory(dir ?? abs) ?? client
      setFilePath(abs)
      setFile(null)
      setFileError(null)
      if (!dirClient) {
        setFileError(noConnection)
        return
      }
      const token = ++fileToken.current
      setFileLoading(true)
      dirClient.file
        .read({ path: abs })
        .then((content) => {
          if (fileToken.current !== token) return
          setFile(content)
        })
        .catch((err) => {
          if (fileToken.current !== token) return
          if (isAuthError(err)) setFileError(t("browse.authFailedMessage"))
          else if (err instanceof ApiError && err.status === 404) setFileError(t("browse.fileNotFound"))
          else if (err instanceof Error && err.message) setFileError(err.message)
          else setFileError(t("browse.fileLoadFailed"))
        })
        .finally(() => {
          if (fileToken.current === token) setFileLoading(false)
        })
    },
    [client, clientForDirectory, dir, noConnection, t],
  )

  const submitComposer = useCallback(async () => {
    const text = prompt.trim()
    if (!text || !dir || sendingInFlight.current) return
    const dirClient: Client | null = clientForDirectory(dir) ?? client
    if (!dirClient) {
      Alert.alert(t("common.error"), noConnection)
      return
    }
    sendingInFlight.current = true
    setSending(true)
    try {
      const session = await dirClient.session.create({ directory: dir })
      await dirClient.session.prompt(session.id, { parts: [{ type: "text", text }] })
      void addRecentDirectory(dir)
      setComposerOpen(false)
      setPrompt("")
      router.push({
        pathname: "/session/[id]",
        params: { id: session.id, ...(session.directory ? { directory: session.directory } : {}) },
      })
    } catch (err) {
      const detail = isAuthError(err)
        ? t("browse.authFailedMessage")
        : err instanceof Error && err.message
          ? err.message
          : t("browse.fileLoadFailed")
      Alert.alert(t("browse.createFailedTitle"), t("browse.createFailedMessage", { detail }))
    } finally {
      sendingInFlight.current = false
      setSending(false)
    }
  }, [addRecentDirectory, client, clientForDirectory, dir, noConnection, prompt, t])

  const goJump = useCallback(() => {
    const raw = jump.trim()
    if (!raw) return
    let target = raw
    if (serverHome && (target === "~" || target.startsWith("~/"))) target = serverHome + target.slice(1)
    if (!isAbsolutePath(target)) {
      setError(t("browse.invalidPath"))
      return
    }
    setJump("")
    load(target)
  }, [jump, load, serverHome, t])

  const rows = useMemo(() => sortFileEntries(entries), [entries])
  const crumbs = useMemo(() => (dir ? breadcrumbSegments(dir) : []), [dir])
  const parent = dir ? parentOf(dir) : null

  const renderRow = ({ item }: { item: FileEntry }) => {
    const isDir = item.type === "directory"
    return (
      <TouchableOpacity
        style={[styles.row, isDark && styles.rowDark, themed && { backgroundColor: p.element }]}
        onPress={() => (isDir ? load(normalizeAbsolute(item.absolute)) : openFile(item))}
        testID={`browse-row-${item.name}`}
      >
        <Ionicons
          name={isDir ? "folder-outline" : "document-text-outline"}
          size={20}
          color={themed ? p.muted : isDark ? "#888888" : "#666666"}
        />
        <Text style={[styles.rowLabel, isDark && styles.textDark, themed && { color: p.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {isDir && <Ionicons name="chevron-forward" size={16} color={themed ? p.muted : isDark ? "#555555" : "#cccccc"} />}
      </TouchableOpacity>
    )
  }

  return (
    <View
      style={[styles.container, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}
      testID="browse-screen"
    >
      {/* Header */}
      <View style={[styles.header, isDark && styles.headerDark, themed && { borderBottomColor: p.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} testID="browse-back">
          <Ionicons name="arrow-back" size={24} color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
        </TouchableOpacity>
        <Text
          style={[styles.title, isDark && styles.textDark, themed && { color: p.text }]}
          numberOfLines={1}
        >
          {dir ? nameOf(dir) : t("browse.title")}
        </Text>
        <TouchableOpacity
          onPress={() => {
            setPrompt("")
            setComposerOpen(true)
          }}
          disabled={!dir}
          hitSlop={12}
          testID="new-session-here-button"
        >
          <Ionicons
            name="add-circle-outline"
            size={24}
            color={!dir ? (isDark ? "#3a3a3a" : "#dddddd") : themed ? p.accent : isDark ? "#8b5cf6" : "#6d28d9"}
          />
        </TouchableOpacity>
      </View>

      {/* Breadcrumb + up */}
      {dir && !filePath && (
        <View style={styles.crumbBar}>
          <TouchableOpacity onPress={() => parent && load(parent)} disabled={!parent} hitSlop={8} testID="browse-up-button">
            <Ionicons
              name="arrow-up-circle-outline"
              size={22}
              color={parent ? (themed ? p.accent : isDark ? "#8b5cf6" : "#6d28d9") : isDark ? "#3a3a3a" : "#dddddd"}
            />
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.crumbScroll}>
            {crumbs.map((crumb, index) => (
              <View key={crumb.path} style={styles.crumbGroup}>
                {/* No separator between the filesystem root ("/", "C:/")
                    and its first child: "/ home" would double the slash. */}
                {index > 1 && (
                  <Text style={[styles.crumbSep, isDark && styles.metaDark, themed && { color: p.muted }]}>/</Text>
                )}
                <TouchableOpacity onPress={() => load(crumb.path)} testID={`browse-crumb-${index}`}>
                  <Text
                    style={[
                      styles.crumb,
                      isDark && styles.metaDark,
                      themed && { color: p.muted },
                      index === crumbs.length - 1 && styles.crumbCurrent,
                      index === crumbs.length - 1 && isDark && styles.textDark,
                      index === crumbs.length - 1 && themed && { color: p.text },
                    ]}
                  >
                    {crumb.label}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Jump to absolute path */}
      {!filePath && (
        <View style={styles.jumpRow}>
          <TextInput
            style={[styles.jumpInput, isDark && styles.jumpInputDark, themed && { backgroundColor: p.element, color: p.text }]}
            placeholder={t("browse.jumpPlaceholder")}
            placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
            value={jump}
            onChangeText={setJump}
            onSubmitEditing={goJump}
            returnKeyType="go"
            autoCapitalize="none"
            autoCorrect={false}
            testID="browse-jump-input"
          />
          {jump.trim() ? (
            <TouchableOpacity
              style={[styles.goButton, isDark && styles.goButtonDark, themed && { backgroundColor: p.primary }]}
              onPress={goJump}
              testID="browse-jump-go"
            >
              <Text style={[styles.goText, isDark && styles.goTextDark, themed && { color: p.background }]}>
                {t("browse.go")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {fatal ? (
        <View style={styles.centerBox}>
          <Ionicons name="folder-open-outline" size={48} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
          <Text style={[styles.message, isDark && styles.textDark, themed && { color: p.text }]}>{fatal}</Text>
          <Text style={[styles.hint, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {t("browse.noStartDirHint")}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, isDark && styles.retryButtonDark, themed && { backgroundColor: p.primary }]}
            onPress={() => setResolveNonce((n) => n + 1)}
            testID="browse-retry"
          >
            <Text style={[styles.retryText, isDark && styles.retryTextDark, themed && { color: p.background }]}>
              {t("common.retry")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : filePath ? (
        <View style={styles.fileView} testID="browse-file-view">
          <View style={styles.fileHeader}>
            <TouchableOpacity
              onPress={() => {
                fileToken.current++
                setFilePath(null)
                setFile(null)
                setFileError(null)
              }}
              hitSlop={12}
              testID="browse-file-back"
            >
              <Ionicons name="arrow-back" size={22} color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
            </TouchableOpacity>
            <Text
              style={[styles.fileName, isDark && styles.textDark, themed && { color: p.text }]}
              numberOfLines={1}
            >
              {filePath}
            </Text>
          </View>
          {fileLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
            </View>
          ) : fileError ? (
            <View style={styles.centerBox}>
              <Text style={styles.errorText} testID="browse-file-error">
                {fileError}
              </Text>
              <TouchableOpacity
                style={[styles.retryButton, isDark && styles.retryButtonDark, themed && { backgroundColor: p.primary }]}
                onPress={() => filePath && openFile({ name: nameOf(filePath), path: filePath, absolute: filePath, type: "file", ignored: false })}
                testID="browse-file-retry"
              >
                <Text style={[styles.retryText, isDark && styles.retryTextDark, themed && { color: p.background }]}>
                  {t("common.retry")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : file?.binary ? (
            <View style={styles.centerBox}>
              <Ionicons name="document-outline" size={48} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
              <Text style={[styles.message, isDark && styles.textDark, themed && { color: p.text }]}>
                {t("browse.binaryNotice")}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.fileScroll} testID="browse-file-text">
              {file && file.truncated && (
                <Text style={[styles.notice, isDark && styles.metaDark, themed && { color: p.accent }]}>
                  {t("browse.truncatedNotice", { shown: file.text.length, total: file.chars })}
                </Text>
              )}
              <Text selectable style={[styles.mono, isDark && styles.textDark, themed && { color: p.text }]}>
                {file?.text ?? ""}
              </Text>
            </ScrollView>
          )}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.absolute}
          renderItem={renderRow}
          testID="browse-list"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => dir && load(dir, true)}
              tintColor={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"}
            />
          }
          ListHeaderComponent={
            loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
              </View>
            ) : error ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText} testID="browse-error">
                  {error}
                </Text>
                <TouchableOpacity
                  style={[styles.retryButton, isDark && styles.retryButtonDark, themed && { backgroundColor: p.primary }]}
                  onPress={() => dir && load(dir)}
                  testID="browse-retry"
                >
                  <Text style={[styles.retryText, isDark && styles.retryTextDark, themed && { color: p.background }]}>
                    {t("common.retry")}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading && !error ? (
              <View style={styles.centerBox} testID="browse-empty">
                <Ionicons name="folder-open-outline" size={48} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
                <Text style={[styles.message, isDark && styles.metaDark, themed && { color: p.muted }]}>
                  {t("browse.emptyDir")}
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.list}
        />
      )}

      {/* New-session-here composer */}
      <Modal visible={composerOpen} animationType="slide" transparent testID="browse-composer">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setComposerOpen(false)} />
          <View style={[styles.modalCard, isDark && styles.modalCardDark, themed && { backgroundColor: p.panel }]}>
            <Text style={[styles.modalTitle, isDark && styles.textDark, themed && { color: p.text }]}>
              {t("browse.composerTitle", { dir: dir ? nameOf(dir) : "" })}
            </Text>
            <Text style={[styles.modalDir, isDark && styles.metaDark, themed && { color: p.muted }]} numberOfLines={2}>
              {dir}
            </Text>
            <TextInput
              style={[styles.composerInput, isDark && styles.composerInputDark, themed && { backgroundColor: p.element, color: p.text }]}
              placeholder={t("browse.promptPlaceholder")}
              placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              autoFocus
              testID="browse-composer-input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setComposerOpen(false)}
                testID="browse-composer-cancel"
              >
                <Text style={styles.cancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  isDark && styles.sendButtonDark,
                  themed && { backgroundColor: p.primary },
                  (!prompt.trim() || sending) && styles.sendDisabled,
                ]}
                onPress={submitComposer}
                disabled={!prompt.trim() || sending}
                testID="browse-composer-send"
              >
                {sending ? (
                  <ActivityIndicator size="small" color={themed ? p.background : isDark ? "#0a0a0a" : "#ffffff"} />
                ) : (
                  <Text style={[styles.sendText, isDark && styles.sendTextDark, themed && { color: p.background }]}>
                    {t("browse.createAndSend")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setComposerOpen(false)} />
        </KeyboardAvoidingView>
      </Modal>
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
  textDark: {
    color: "#ffffff",
  },
  metaDark: {
    color: "#888888",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  headerDark: {
    borderBottomColor: "#1a1a1a",
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  crumbBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  crumbScroll: {
    flex: 1,
  },
  crumbGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  crumbSep: {
    fontSize: 13,
    color: "#999999",
    marginHorizontal: 4,
  },
  crumb: {
    fontSize: 13,
    color: "#666666",
  },
  crumbCurrent: {
    fontWeight: "600",
    color: "#0a0a0a",
  },
  jumpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  jumpInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f5f5f5",
    color: "#0a0a0a",
    fontSize: 14,
  },
  jumpInputDark: {
    backgroundColor: "#1a1a1a",
    color: "#ffffff",
  },
  goButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
  },
  goButtonDark: {
    backgroundColor: "#ffffff",
  },
  goText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  goTextDark: {
    color: "#0a0a0a",
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#f5f5f5",
    marginBottom: 6,
  },
  rowDark: {
    backgroundColor: "#2a2a2a",
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#0a0a0a",
  },
  centerBox: {
    paddingVertical: 32,
    alignItems: "center",
    gap: 12,
  },
  message: {
    fontSize: 15,
    color: "#0a0a0a",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  hint: {
    fontSize: 13,
    color: "#666666",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 14,
    color: "#ef4444",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#0a0a0a",
  },
  retryButtonDark: {
    backgroundColor: "#ffffff",
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  retryTextDark: {
    color: "#0a0a0a",
  },
  fileView: {
    flex: 1,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  fileName: {
    flex: 1,
    fontSize: 12,
    color: "#666666",
  },
  fileScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  notice: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6d28d9",
    marginBottom: 8,
  },
  mono: {
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 19,
    color: "#0a0a0a",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalDismiss: {
    flex: 1,
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  modalCardDark: {
    backgroundColor: "#1a1a1a",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  modalDir: {
    fontSize: 12,
    color: "#666666",
  },
  composerInput: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: "#0a0a0a",
    minHeight: 100,
    textAlignVertical: "top",
  },
  composerInputDark: {
    backgroundColor: "#2a2a2a",
    color: "#ffffff",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#888888",
  },
  sendButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#0a0a0a",
    minWidth: 140,
    alignItems: "center",
  },
  sendButtonDark: {
    backgroundColor: "#ffffff",
  },
  sendDisabled: {
    opacity: 0.5,
  },
  sendText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  sendTextDark: {
    color: "#0a0a0a",
  },
})
