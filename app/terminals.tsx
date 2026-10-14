import { useCallback, useState } from "react"
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useConnections } from "../src/stores/connections"
import { createBridgeClient, isBridgeAuthError, type BridgeSession } from "../src/lib/bridge"

// Read-only tmux session manager for the oc-phone-bridge sidecar.
// Interactive PTY streaming is a later phase — preview here is `tail`
// polling only. Copy intentionally uses literal English strings instead of
// i18n keys: adding keys would require touching en.json + zh-Hans.json in
// lockstep (catalog-parity test), and bridge copy has no translation yet.

function formatCreated(created: number | null): string | null {
  if (created === null) return null
  return new Date(created * 1000).toLocaleString()
}

function SessionRow({
  session,
  isDark,
  preview,
  previewLoading,
  onTogglePreview,
  onRefreshPreview,
  onKill,
}: {
  session: BridgeSession
  isDark: boolean
  preview: string | null
  previewLoading: boolean
  onTogglePreview: () => void
  onRefreshPreview: () => void
  onKill: () => void
}) {
  const created = formatCreated(session.created)
  const open = preview !== null || previewLoading
  return (
    <View style={[styles.sessionItem, isDark && styles.sessionItemDark]}>
      <TouchableOpacity onPress={onTogglePreview} activeOpacity={0.7} testID={`terminal-row-${session.name}`}>
        <View style={styles.sessionHeader}>
          <Ionicons name="terminal-outline" size={20} color={isDark ? "#888888" : "#666666"} />
          <Text style={[styles.sessionName, isDark && styles.textDark]} numberOfLines={1}>
            {session.name}
          </Text>
          {session.isOpencode === true && (
            <View style={styles.opencodeBadge}>
              <Text style={styles.opencodeBadgeText}>opencode</Text>
            </View>
          )}
        </View>
        {created && <Text style={[styles.sessionMeta, isDark && styles.metaDark]}>{created}</Text>}
        {session.paneCommand ? (
          <Text style={[styles.sessionMeta, isDark && styles.metaDark]} numberOfLines={1}>
            {session.paneCommand}
          </Text>
        ) : null}
      </TouchableOpacity>
      {open && (
        <View style={[styles.previewBox, isDark && styles.previewBoxDark]}>
          <View style={styles.previewHeader}>
            <Text style={[styles.previewTitle, isDark && styles.metaDark]}>Recent output</Text>
            <TouchableOpacity onPress={onRefreshPreview} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="refresh-outline" size={16} color={isDark ? "#888888" : "#666666"} />
            </TouchableOpacity>
          </View>
          {previewLoading ? (
            <ActivityIndicator size="small" color={isDark ? "#ffffff" : "#0a0a0a"} />
          ) : (
            <ScrollView style={styles.previewScroll} nestedScrollEnabled>
              <Text style={[styles.previewText, isDark && styles.previewTextDark]} selectable>
                {preview || "(no output)"}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
      <View style={styles.rowActions}>
        <TouchableOpacity style={styles.rowAction} onPress={onTogglePreview}>
          <Ionicons name={open ? "chevron-up-outline" : "eye-outline"} size={18} color={isDark ? "#888888" : "#666666"} />
          <Text style={[styles.rowActionText, isDark && styles.metaDark]}>{open ? "Hide" : "Preview"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rowAction} onPress={onKill}>
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
          <Text style={styles.killText}>Kill</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default function TerminalsScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { activeConnection } = useConnections()

  const [sessions, setSessions] = useState<BridgeSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [dir, setDir] = useState("")
  const [cmd, setCmd] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [previewName, setPreviewName] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const bridgeUrl = activeConnection?.bridgeUrl?.trim() || null
  const bridgeToken = activeConnection?.bridgeToken?.trim() || null
  const configured = Boolean(bridgeUrl && bridgeToken)

  const load = useCallback(async () => {
    if (!bridgeUrl || !bridgeToken) {
      setIsLoading(false)
      return
    }
    setError(null)
    try {
      const client = createBridgeClient({ baseUrl: bridgeUrl, token: bridgeToken })
      setSessions(await client.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [bridgeUrl, bridgeToken])

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true)
      void load()
    }, [load]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const loadPreview = useCallback(
    async (sessionName: string) => {
      if (!bridgeUrl || !bridgeToken) return
      setPreviewLoading(true)
      try {
        const client = createBridgeClient({ baseUrl: bridgeUrl, token: bridgeToken })
        const tail = await client.tail(sessionName)
        setPreviewText(tail.output)
      } catch (err) {
        setPreviewText(err instanceof Error ? `Preview failed: ${err.message}` : String(err))
      } finally {
        setPreviewLoading(false)
      }
    },
    [bridgeUrl, bridgeToken],
  )

  const togglePreview = useCallback(
    (sessionName: string) => {
      if (previewName === sessionName) {
        setPreviewName(null)
        setPreviewText(null)
        return
      }
      setPreviewName(sessionName)
      setPreviewText(null)
      void loadPreview(sessionName)
    },
    [previewName, loadPreview],
  )

  const handleKill = useCallback(
    (session: BridgeSession) => {
      if (!bridgeUrl || !bridgeToken) return
      Alert.alert("Kill session?", `"${session.name}" will be terminated.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kill",
          style: "destructive",
          onPress: async () => {
            try {
              await createBridgeClient({ baseUrl: bridgeUrl, token: bridgeToken }).kill(session.name)
              if (previewName === session.name) {
                setPreviewName(null)
                setPreviewText(null)
              }
              void load()
            } catch (err) {
              Alert.alert("Error", err instanceof Error ? err.message : String(err))
            }
          },
        },
      ])
    },
    [bridgeUrl, bridgeToken, previewName, load],
  )

  const openCreate = useCallback(() => {
    setName("")
    setDir(activeConnection?.defaultProjectDir || "")
    setCmd("")
    setShowCreate(true)
  }, [activeConnection])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || !bridgeUrl || !bridgeToken) return
    setIsCreating(true)
    try {
      await createBridgeClient({ baseUrl: bridgeUrl, token: bridgeToken }).create({
        name: trimmed,
        ...(dir.trim() ? { dir: dir.trim() } : {}),
        ...(cmd.trim() ? { cmd: cmd.trim() } : {}),
      })
      setShowCreate(false)
      void load()
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : String(err))
    } finally {
      setIsCreating(false)
    }
  }, [name, dir, cmd, bridgeUrl, bridgeToken, load])

  if (!activeConnection) {
    return (
      <View style={[styles.emptyContainer, isDark && styles.containerDark]}>
        <Ionicons name="terminal-outline" size={64} color={isDark ? "#444444" : "#cccccc"} />
        <Text style={[styles.emptyTitle, isDark && styles.textDark]}>No connection</Text>
        <Text style={[styles.emptySubtitle, isDark && styles.metaDark]}>
          Add a server connection first, then configure its bridge.
        </Text>
        <TouchableOpacity
          style={[styles.addButton, isDark && styles.addButtonDark]}
          onPress={() => router.push("/connection/add")}
        >
          <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark]}>Add connection</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (!configured) {
    return (
      <View style={[styles.emptyContainer, isDark && styles.containerDark]}>
        <Ionicons name="terminal-outline" size={64} color={isDark ? "#444444" : "#cccccc"} />
        <Text style={[styles.emptyTitle, isDark && styles.textDark]}>Bridge not configured</Text>
        <Text style={[styles.emptySubtitle, isDark && styles.metaDark]}>
          Set the bridge URL and token on “{activeConnection.name}” to manage its tmux sessions.
        </Text>
        <TouchableOpacity
          style={[styles.addButton, isDark && styles.addButtonDark]}
          onPress={() => router.push(`/connection/${activeConnection.id}`)}
        >
          <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark]}>Configure bridge</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
          {error.includes("401") && (
            <Text style={styles.errorHint}>Check the bridge token on this connection.</Text>
          )}
        </View>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <SessionRow
            session={item}
            isDark={isDark}
            preview={previewName === item.name ? previewText : null}
            previewLoading={previewName === item.name && previewLoading}
            onTogglePreview={() => togglePreview(item.name)}
            onRefreshPreview={() => loadPreview(item.name)}
            onKill={() => handleKill(item)}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? "#ffffff" : "#0a0a0a"} />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
            </View>
          ) : (
            <View style={styles.emptyList}>
              <Text style={[styles.emptyListText, isDark && styles.metaDark]}>
                {error ? "Could not load sessions." : "No tmux sessions."}
              </Text>
            </View>
          )
        }
        contentContainerStyle={sessions.length === 0 ? styles.emptyContent : undefined}
      />

      <TouchableOpacity style={[styles.fab, isDark && styles.fabDark]} onPress={openCreate} testID="new-terminal-fab">
        <Ionicons name="add" size={28} color={isDark ? "#0a0a0a" : "#ffffff"} />
      </TouchableOpacity>

      <Modal visible={showCreate} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setShowCreate(false)} />
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isDark && styles.textDark]}>New tmux session</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <Ionicons name="close" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, isDark && styles.metaDark]}>Name (required)</Text>
            <TextInput
              style={[styles.modalInput, isDark && styles.modalInputDark]}
              placeholder="dev"
              placeholderTextColor={isDark ? "#666666" : "#999999"}
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
              autoCorrect={false}
              testID="terminal-name-input"
            />
            <Text style={[styles.modalLabel, isDark && styles.metaDark]}>Directory (optional)</Text>
            <TextInput
              style={[styles.modalInput, isDark && styles.modalInputDark]}
              placeholder="/home/user/project"
              placeholderTextColor={isDark ? "#666666" : "#999999"}
              value={dir}
              onChangeText={setDir}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.modalLabel, isDark && styles.metaDark]}>Command (optional)</Text>
            <TextInput
              style={[styles.modalInput, isDark && styles.modalInputDark]}
              placeholder="opencode"
              placeholderTextColor={isDark ? "#666666" : "#999999"}
              value={cmd}
              onChangeText={setCmd}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonPrimary,
                  isDark && styles.modalButtonPrimaryDark,
                  styles.modalButtonFull,
                ]}
                onPress={handleCreate}
                disabled={!name.trim() || isCreating}
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                ) : (
                  <Text style={[styles.modalButtonTextPrimary, isDark && styles.modalButtonTextPrimaryDark]}>
                    Create session
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

// Auth-token failures surface here instead of a bare error bar: the fix is
// in the connection form, not a retry.
export function bridgeErrorHint(error: unknown): string | null {
  if (isBridgeAuthError(error)) return "Bridge token rejected — update it on this connection."
  return null
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  errorBar: {
    backgroundColor: "#fef2f2",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 14,
  },
  errorHint: {
    color: "#dc2626",
    fontSize: 12,
    marginTop: 4,
  },
  sessionItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  sessionItemDark: {
    borderBottomColor: "#1a1a1a",
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0a0a0a",
    flex: 1,
  },
  textDark: {
    color: "#ffffff",
  },
  opencodeBadge: {
    backgroundColor: "#8b5cf6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  opencodeBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  sessionMeta: {
    fontSize: 13,
    color: "#666666",
    marginTop: 4,
  },
  metaDark: {
    color: "#888888",
  },
  previewBox: {
    backgroundColor: "#0a0a0a",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  previewBoxDark: {
    backgroundColor: "#1a1a1a",
  },
  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666666",
    textTransform: "uppercase",
  },
  previewScroll: {
    maxHeight: 240,
  },
  previewText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#ffffff",
  },
  previewTextDark: {
    color: "#e5e5e5",
  },
  rowActions: {
    flexDirection: "row",
    gap: 20,
    marginTop: 12,
  },
  rowAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowActionText: {
    fontSize: 14,
    color: "#666666",
  },
  killText: {
    fontSize: 14,
    color: "#ef4444",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
    color: "#0a0a0a",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  addButton: {
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  addButtonDark: {
    backgroundColor: "#ffffff",
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  addButtonTextDark: {
    color: "#0a0a0a",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyListText: {
    fontSize: 16,
    color: "#666666",
  },
  emptyContent: {
    flex: 1,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabDark: {
    backgroundColor: "#ffffff",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalDismiss: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalContentDark: {
    backgroundColor: "#1a1a1a",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
    marginBottom: 8,
    marginTop: 12,
    textTransform: "uppercase",
  },
  modalInput: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0a0a0a",
  },
  modalInputDark: {
    backgroundColor: "#2a2a2a",
    color: "#ffffff",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  modalButtonPrimary: {
    backgroundColor: "#0a0a0a",
  },
  modalButtonPrimaryDark: {
    backgroundColor: "#ffffff",
  },
  modalButtonTextPrimary: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  modalButtonTextPrimaryDark: {
    color: "#0a0a0a",
  },
  modalButtonFull: {
    flex: 0,
    width: "100%",
  },
})
