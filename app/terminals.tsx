import { useCallback, useState } from "react"
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
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
import { useTranslation } from "react-i18next"
import { useConnections } from "../src/stores/connections"
import { useAppPalette } from "../src/components/useAppPalette"
import { createBridgeClient, isBridgeAuthError, type BridgeSession } from "../src/lib/bridge"
import { buildTmuxAttachBody } from "../src/lib/tmux-pty"
import { isPtyAuthError, type PtyRecord } from "../src/lib/pty"

// tmux session manager for the oc-phone-bridge sidecar (top tab) plus the
// opencode v2 server's native PTYs (bottom tab). Tapping "Open terminal" on a
// tmux session creates a server PTY running
// `tmux attach-session -t <name>` (see src/lib/tmux-pty.ts — no native PTY
// stack in the app) and opens the interactive terminal renderer against it;
// the read-only tail preview stays as the lightweight Preview action.
// Tmux copy intentionally uses literal English strings instead of i18n keys:
// adding keys would require touching en.json + zh-Hans.json in lockstep
// (catalog-parity test), and bridge copy has no translation yet. All NEW
// server-PTY copy uses the `terminals.pty` / `terminals.tmux` / `terminal`
// catalog keys (kept in parity across en + zh-Hans).

function formatCreated(created: number | null): string | null {
  if (created === null) return null
  return new Date(created * 1000).toLocaleString()
}

function SessionRow({
  session,
  isDark,
  preview,
  previewLoading,
  opening,
  onOpen,
  onTogglePreview,
  onRefreshPreview,
  onKill,
}: {
  session: BridgeSession
  isDark: boolean
  preview: string | null
  previewLoading: boolean
  opening: boolean
  onOpen: () => void
  onTogglePreview: () => void
  onRefreshPreview: () => void
  onKill: () => void
}) {
  const { palette: p, themed } = useAppPalette()
  const { t } = useTranslation()
  const created = formatCreated(session.created)
  const open = preview !== null || previewLoading
  return (
    <View style={[styles.sessionItem, isDark && styles.sessionItemDark, themed && { borderBottomColor: p.border }]}>
      <TouchableOpacity onPress={onTogglePreview} activeOpacity={0.7} testID={`terminal-row-${session.name}`}>
        <View style={styles.sessionHeader}>
          <Ionicons name="terminal-outline" size={20} color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
          <Text style={[styles.sessionName, isDark && styles.textDark, themed && { color: p.text }]} numberOfLines={1}>
            {session.name}
          </Text>
          {session.isOpencode === true && (
            <View style={[styles.opencodeBadge, themed && { backgroundColor: p.accent }]}>
              <Text style={styles.opencodeBadgeText}>opencode</Text>
            </View>
          )}
        </View>
        {created && (
          <Text style={[styles.sessionMeta, isDark && styles.metaDark, themed && { color: p.muted }]}>{created}</Text>
        )}
        {session.paneCommand ? (
          <Text style={[styles.sessionMeta, isDark && styles.metaDark, themed && { color: p.muted }]} numberOfLines={1}>
            {session.paneCommand}
          </Text>
        ) : null}
      </TouchableOpacity>
      {open && (
        <View
          style={[styles.previewBox, isDark && styles.previewBoxDark, themed && { backgroundColor: p.background }]}
        >
          <View style={styles.previewHeader}>
            <Text style={[styles.previewTitle, isDark && styles.metaDark, themed && { color: p.muted }]}>
              Recent output
            </Text>
            <TouchableOpacity onPress={onRefreshPreview} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="refresh-outline" size={16} color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
            </TouchableOpacity>
          </View>
          {previewLoading ? (
            <ActivityIndicator size="small" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
          ) : (
            <ScrollView style={styles.previewScroll} nestedScrollEnabled>
              <Text
                style={[styles.previewText, isDark && styles.previewTextDark, themed && { color: p.text }]}
                selectable
              >
                {preview || "(no output)"}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
      <View style={styles.rowActions}>
        <TouchableOpacity
          style={styles.rowAction}
          onPress={onOpen}
          disabled={opening}
          testID={`terminal-open-${session.name}`}
        >
          {opening ? (
            <ActivityIndicator size="small" color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
          ) : (
            <Ionicons
              name="open-outline"
              size={18}
              color={themed ? p.muted : isDark ? "#888888" : "#666666"}
            />
          )}
          <Text style={[styles.rowActionText, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {opening ? t("terminals.tmux.opening") : t("terminals.tmux.openTerminal")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rowAction} onPress={onTogglePreview}>
          <Ionicons
            name={open ? "chevron-up-outline" : "eye-outline"}
            size={18}
            color={themed ? p.muted : isDark ? "#888888" : "#666666"}
          />
          <Text style={[styles.rowActionText, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {open ? "Hide" : "Preview"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rowAction} onPress={onKill}>
          <Ionicons name="trash-outline" size={18} color={themed ? p.error : "#ef4444"} />
          <Text style={[styles.killText, themed && { color: p.error }]}>Kill</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function PtyRow({
  record,
  badge,
  hint,
  isDark,
  onOpen,
  onKill,
}: {
  record: PtyRecord
  badge: string
  hint: string
  isDark: boolean
  onOpen: () => void
  onKill: () => void
}) {
  const { palette: p, themed } = useAppPalette()
  const status = record.status ? `${record.status}${record.pid ? ` · pid ${record.pid}` : ""}` : null
  return (
    <View style={[styles.sessionItem, isDark && styles.sessionItemDark, themed && { borderBottomColor: p.border }]}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.7} testID={`pty-row-${record.id}`}>
        <View style={styles.sessionHeader}>
          <Ionicons name="server-outline" size={20} color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
          <Text style={[styles.sessionName, isDark && styles.textDark, themed && { color: p.text }]} numberOfLines={1}>
            {record.title || record.id}
          </Text>
          <View style={[styles.ptyBadge, themed && { backgroundColor: p.info }]}>
            <Text style={styles.ptyBadgeText}>{badge}</Text>
          </View>
        </View>
        {status && (
          <Text style={[styles.sessionMeta, isDark && styles.metaDark, themed && { color: p.muted }]}>{status}</Text>
        )}
        {record.cwd ? (
          <Text style={[styles.sessionMeta, isDark && styles.metaDark, themed && { color: p.muted }]} numberOfLines={1}>
            {record.cwd}
          </Text>
        ) : null}
        <Text style={[styles.sessionMeta, isDark && styles.metaDark, themed && { color: p.muted }]} numberOfLines={1}>
          {record.id}
        </Text>
      </TouchableOpacity>
      <View style={styles.rowActions}>
        <TouchableOpacity style={styles.rowAction} onPress={onOpen}>
          <Ionicons name="open-outline" size={18} color={themed ? p.muted : isDark ? "#888888" : "#666666"} />
          <Text style={[styles.rowActionText, isDark && styles.metaDark, themed && { color: p.muted }]}>{hint}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rowAction} onPress={onKill}>
          <Ionicons name="trash-outline" size={18} color={themed ? p.error : "#ef4444"} />
          <Text style={[styles.killText, themed && { color: p.error }]}>Kill</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

type Tab = "tmux" | "pty"

export default function TerminalsScreen() {
  const { isDark, palette: p, themed } = useAppPalette()
  const { t } = useTranslation()
  const { activeConnection, client } = useConnections()

  const [tab, setTab] = useState<Tab>("tmux")

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
  const [openingName, setOpeningName] = useState<string | null>(null)

  const [ptys, setPtys] = useState<PtyRecord[]>([])
  const [ptyLoading, setPtyLoading] = useState(true)
  const [ptyRefreshing, setPtyRefreshing] = useState(false)
  const [ptyError, setPtyError] = useState<string | null>(null)
  const [showPtyCreate, setShowPtyCreate] = useState(false)
  const [ptyTitle, setPtyTitle] = useState("")
  const [ptyCwd, setPtyCwd] = useState("")
  const [ptyCmd, setPtyCmd] = useState("")
  const [isCreatingPty, setIsCreatingPty] = useState(false)

  const bridgeUrl = activeConnection?.bridgeUrl?.trim() || null
  const bridgeToken = activeConnection?.bridgeToken?.trim() || null
  const configured = Boolean(bridgeUrl && bridgeToken)

  // v1 servers have no PTY API — the tab degrades to an explainer. An
  // unprobed connection (api absent) behaves as v2, same as everywhere else.
  const isV2 = activeConnection?.api !== "v1"
  const ptyClient = client && "pty" in client && isV2 ? client.pty : null

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

  const loadPtys = useCallback(async () => {
    if (!ptyClient) {
      setPtyLoading(false)
      return
    }
    setPtyError(null)
    try {
      setPtys(await ptyClient.list())
    } catch (err) {
      setPtyError(err instanceof Error ? err.message : String(err))
    } finally {
      setPtyLoading(false)
    }
  }, [ptyClient])

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true)
      void load()
      setPtyLoading(true)
      void loadPtys()
    }, [load, loadPtys]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const onPtyRefresh = useCallback(async () => {
    setPtyRefreshing(true)
    try {
      await loadPtys()
    } finally {
      setPtyRefreshing(false)
    }
  }, [loadPtys])

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

  // Interactive open: create a server PTY running `tmux attach-session`
  // against this session and hand it to the terminal renderer. Failures
  // surface truthfully — v1 servers have no PTY API at all, and a missing
  // tmux session / dead server arrives as the create() error message.
  const handleOpenTmux = useCallback(
    async (session: BridgeSession) => {
      if (!ptyClient) {
        Alert.alert(
          t("terminals.pty.needsV2Title"),
          t("terminals.pty.needsV2Body", { name: activeConnection?.name ?? "" }),
        )
        return
      }
      setOpeningName(session.name)
      try {
        const record = await ptyClient.create(buildTmuxAttachBody(session.name))
        setOpeningName(null)
        router.push({ pathname: "/terminal/[id]", params: { id: record.id, tmux: session.name } })
      } catch (err) {
        setOpeningName(null)
        Alert.alert(t("terminals.tmux.openFailedTitle"), err instanceof Error ? err.message : String(err))
      }
    },
    [ptyClient, activeConnection, t],
  )

  const handleKill = useCallback(    (session: BridgeSession) => {
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

  const handlePtyKill = useCallback(
    (record: PtyRecord) => {
      if (!ptyClient) return
      Alert.alert(t("terminals.pty.killTitle"), t("terminals.pty.killMessage", { title: record.title || record.id }), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await ptyClient.remove(record.id)
              void loadPtys()
            } catch (err) {
              Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err))
            }
          },
        },
      ])
    },
    [ptyClient, loadPtys, t],
  )

  const openPtyCreate = useCallback(() => {
    setPtyTitle("")
    setPtyCwd(activeConnection?.defaultProjectDir || "")
    setPtyCmd("")
    setShowPtyCreate(true)
  }, [activeConnection])

  const handlePtyCreate = useCallback(async () => {
    if (!ptyClient) return
    setIsCreatingPty(true)
    try {
      await ptyClient.create({
        ...(ptyTitle.trim() ? { title: ptyTitle.trim() } : {}),
        ...(ptyCwd.trim() ? { cwd: ptyCwd.trim() } : {}),
        ...(ptyCmd.trim() ? { command: ptyCmd.trim() } : {}),
      })
      setShowPtyCreate(false)
      void loadPtys()
    } catch (err) {
      Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err))
    } finally {
      setIsCreatingPty(false)
    }
  }, [ptyTitle, ptyCwd, ptyCmd, ptyClient, loadPtys, t])

  if (!activeConnection) {
    return (
      <View style={[styles.emptyContainer, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}>
        <Ionicons name="terminal-outline" size={64} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
        <Text style={[styles.emptyTitle, isDark && styles.textDark, themed && { color: p.text }]}>No connection</Text>
        <Text style={[styles.emptySubtitle, isDark && styles.metaDark, themed && { color: p.muted }]}>
          Add a server connection first, then configure its bridge.
        </Text>
        <TouchableOpacity
          style={[styles.addButton, isDark && styles.addButtonDark, themed && { backgroundColor: p.primary }]}
          onPress={() => router.push("/connection/add")}
        >
          <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark, themed && { color: p.background }]}>
            Add connection
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  const renderPtyPane = () => {
    if (!isV2) {
      return (
        <View style={[styles.emptyContainer, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}>
          <Ionicons name="server-outline" size={64} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
          <Text style={[styles.emptyTitle, isDark && styles.textDark, themed && { color: p.text }]}>
            {t("terminals.pty.needsV2Title")}
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {t("terminals.pty.needsV2Body", { name: activeConnection.name })}
          </Text>
        </View>
      )
    }
    if (!ptyClient) {
      return (
        <View style={[styles.emptyContainer, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}>
          <Text style={[styles.emptyListText, isDark && styles.metaDark, themed && { color: p.muted }]}>
            {t("terminals.pty.loadFailed")}
          </Text>
        </View>
      )
    }
    return (
      <View style={{ flex: 1 }}>
        {ptyError && (
          <View style={[styles.errorBar, themed && { backgroundColor: p.panel, borderBottomColor: p.border }]}>
            <Text style={[styles.errorText, themed && { color: p.error }]}>{ptyError}</Text>
            {ptyError.includes("401") && (
              <Text style={[styles.errorHint, themed && { color: p.error }]}>{t("terminals.pty.authHint")}</Text>
            )}
          </View>
        )}
        <FlatList
          data={ptys}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PtyRow
              record={item}
              badge={t("terminals.tabs.serverPty")}
              hint={t("terminals.pty.openHint")}
              isDark={isDark}
              onOpen={() => router.push(`/terminal/${item.id}`)}
              onKill={() => handlePtyKill(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={ptyRefreshing}
              onRefresh={onPtyRefresh}
              tintColor={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"}
            />
          }
          ListEmptyComponent={
            ptyLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
              </View>
            ) : (
              <View style={styles.emptyList}>
                <Text style={[styles.emptyListText, isDark && styles.metaDark, themed && { color: p.muted }]}>
                  {ptyError ? t("terminals.pty.loadFailed") : t("terminals.pty.empty")}
                </Text>
              </View>
            )
          }
          contentContainerStyle={ptys.length === 0 ? styles.emptyContent : undefined}
        />
        <TouchableOpacity
          style={[styles.fab, isDark && styles.fabDark, themed && { backgroundColor: p.primary }]}
          onPress={openPtyCreate}
          testID="new-pty-fab"
        >
          <Ionicons name="add" size={28} color={themed ? p.background : isDark ? "#0a0a0a" : "#ffffff"} />
        </TouchableOpacity>
        <Modal visible={showPtyCreate} animationType="slide" transparent>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setShowPtyCreate(false)} />
            <View style={[styles.modalContent, isDark && styles.modalContentDark, themed && { backgroundColor: p.panel }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, isDark && styles.textDark, themed && { color: p.text }]}>
                  {t("terminals.pty.newPty")}
                </Text>
                <TouchableOpacity onPress={() => setShowPtyCreate(false)}>
                  <Ionicons name="close" size={24} color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.modalLabel, isDark && styles.metaDark, themed && { color: p.muted }]}>
                {t("terminals.pty.titleLabel")}
              </Text>
              <TextInput
                style={[styles.modalInput, isDark && styles.modalInputDark, themed && { backgroundColor: p.element, color: p.text }]}
                placeholder="dev"
                placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
                value={ptyTitle}
                onChangeText={setPtyTitle}
                autoCapitalize="none"
                autoCorrect={false}
                testID="pty-title-input"
              />
              <Text style={[styles.modalLabel, isDark && styles.metaDark, themed && { color: p.muted }]}>
                {t("terminals.pty.cwdLabel")}
              </Text>
              <TextInput
                style={[styles.modalInput, isDark && styles.modalInputDark, themed && { backgroundColor: p.element, color: p.text }]}
                placeholder="/home/user/project"
                placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
                value={ptyCwd}
                onChangeText={setPtyCwd}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.modalLabel, isDark && styles.metaDark, themed && { color: p.muted }]}>
                {t("terminals.pty.commandLabel")}
              </Text>
              <TextInput
                style={[styles.modalInput, isDark && styles.modalInputDark, themed && { backgroundColor: p.element, color: p.text }]}
                placeholder="/bin/bash"
                placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
                value={ptyCmd}
                onChangeText={setPtyCmd}
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
                    themed && { backgroundColor: p.primary },
                  ]}
                  onPress={handlePtyCreate}
                  disabled={isCreatingPty}
                >
                  {isCreatingPty ? (
                    <ActivityIndicator size="small" color={themed ? p.background : isDark ? "#0a0a0a" : "#ffffff"} />
                  ) : (
                    <Text
                      style={[
                        styles.modalButtonTextPrimary,
                        isDark && styles.modalButtonTextPrimaryDark,
                        themed && { color: p.background },
                      ]}
                    >
                      {t("terminals.pty.createButton")}
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

  return (
    <View style={[styles.container, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}>
      <View style={[styles.tabBar, isDark && styles.tabBarDark, themed && { borderBottomColor: p.border }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            tab === "tmux" && (isDark ? styles.tabActiveDark : styles.tabActive),
            themed && tab === "tmux" && { backgroundColor: p.primary },
          ]}
          onPress={() => setTab("tmux")}
          testID="terminals-tab-tmux"
        >
          <Text
            style={[
              styles.tabText,
              isDark && styles.tabTextDark,
              tab === "tmux" && (isDark ? styles.tabTextActiveDark : styles.tabTextActive),
              themed && tab === "tmux" && { color: p.background },
              themed && tab !== "tmux" && { color: p.muted },
            ]}
          >
            {t("terminals.tabs.tmux")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            tab === "pty" && (isDark ? styles.tabActiveDark : styles.tabActive),
            themed && tab === "pty" && { backgroundColor: p.primary },
          ]}
          onPress={() => setTab("pty")}
          testID="terminals-tab-pty"
        >
          <Text
            style={[
              styles.tabText,
              isDark && styles.tabTextDark,
              tab === "pty" && (isDark ? styles.tabTextActiveDark : styles.tabTextActive),
              themed && tab === "pty" && { color: p.background },
              themed && tab !== "pty" && { color: p.muted },
            ]}
          >
            {t("terminals.tabs.serverPty")}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === "pty" ? (
        renderPtyPane()
      ) : !configured ? (
        <View style={[styles.emptyContainer, isDark && styles.containerDark, themed && { backgroundColor: p.background }]}>
          <Ionicons name="terminal-outline" size={64} color={themed ? p.muted : isDark ? "#444444" : "#cccccc"} />
          <Text style={[styles.emptyTitle, isDark && styles.textDark, themed && { color: p.text }]}>
            Bridge not configured
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.metaDark, themed && { color: p.muted }]}>
            Set the bridge URL and token on “{activeConnection.name}” to manage its tmux sessions.
          </Text>
          <TouchableOpacity
            style={[styles.addButton, isDark && styles.addButtonDark, themed && { backgroundColor: p.primary }]}
            onPress={() => router.push(`/connection/${activeConnection.id}`)}
          >
            <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark, themed && { color: p.background }]}>
              Configure bridge
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {error && (
            <View style={[styles.errorBar, themed && { backgroundColor: p.panel, borderBottomColor: p.border }]}>
              <Text style={[styles.errorText, themed && { color: p.error }]}>{error}</Text>
              {error.includes("401") && (
                <Text style={[styles.errorHint, themed && { color: p.error }]}>Check the bridge token on this connection.</Text>
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
                opening={openingName === item.name}
                onOpen={() => handleOpenTmux(item)}
                onTogglePreview={() => togglePreview(item.name)}
                onRefreshPreview={() => loadPreview(item.name)}
                onKill={() => handleKill(item)}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"}
              />
            }
            ListEmptyComponent={
              isLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
                </View>
              ) : (
                <View style={styles.emptyList}>
                  <Text style={[styles.emptyListText, isDark && styles.metaDark, themed && { color: p.muted }]}>
                    {error ? "Could not load sessions." : "No tmux sessions."}
                  </Text>
                </View>
              )
            }
            contentContainerStyle={sessions.length === 0 ? styles.emptyContent : undefined}
          />

          <TouchableOpacity
            style={[styles.fab, isDark && styles.fabDark, themed && { backgroundColor: p.primary }]}
            onPress={openCreate}
            testID="new-terminal-fab"
          >
            <Ionicons name="add" size={28} color={themed ? p.background : isDark ? "#0a0a0a" : "#ffffff"} />
          </TouchableOpacity>

          <Modal visible={showCreate} animationType="slide" transparent>
            <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
              <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setShowCreate(false)} />
              <View style={[styles.modalContent, isDark && styles.modalContentDark, themed && { backgroundColor: p.panel }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, isDark && styles.textDark, themed && { color: p.text }]}>
                    New tmux session
                  </Text>
                  <TouchableOpacity onPress={() => setShowCreate(false)}>
                    <Ionicons name="close" size={24} color={themed ? p.text : isDark ? "#ffffff" : "#0a0a0a"} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.modalLabel, isDark && styles.metaDark, themed && { color: p.muted }]}>
                  Name (required)
                </Text>
                <TextInput
                  style={[styles.modalInput, isDark && styles.modalInputDark, themed && { backgroundColor: p.element, color: p.text }]}
                  placeholder="dev"
                  placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="terminal-name-input"
                />
                <Text style={[styles.modalLabel, isDark && styles.metaDark, themed && { color: p.muted }]}>
                  Directory (optional)
                </Text>
                <TextInput
                  style={[styles.modalInput, isDark && styles.modalInputDark, themed && { backgroundColor: p.element, color: p.text }]}
                  placeholder="/home/user/project"
                  placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
                  value={dir}
                  onChangeText={setDir}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={[styles.modalLabel, isDark && styles.metaDark, themed && { color: p.muted }]}>
                  Command (optional)
                </Text>
                <TextInput
                  style={[styles.modalInput, isDark && styles.modalInputDark, themed && { backgroundColor: p.element, color: p.text }]}
                  placeholder="opencode"
                  placeholderTextColor={themed ? p.muted : isDark ? "#666666" : "#999999"}
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
                      themed && { backgroundColor: p.primary },
                    ]}
                    onPress={handleCreate}
                    disabled={!name.trim() || isCreating}
                  >
                    {isCreating ? (
                      <ActivityIndicator size="small" color={themed ? p.background : isDark ? "#0a0a0a" : "#ffffff"} />
                    ) : (
                      <Text
                        style={[
                          styles.modalButtonTextPrimary,
                          isDark && styles.modalButtonTextPrimaryDark,
                          themed && { color: p.background },
                        ]}
                      >
                        Create session
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </View>
      )}
    </View>
  )
}

// Auth-token failures surface here instead of a bare error bar: the fix is
// in the connection form, not a retry.
export function bridgeErrorHint(error: unknown): string | null {
  if (isBridgeAuthError(error)) return "Bridge token rejected — update it on this connection."
  return null
}

// Server-credential failures on the PTY tab: the fix is in the connection
// form, not a retry.
export function ptyErrorHint(error: unknown): string | null {
  if (isPtyAuthError(error)) return "Server credentials rejected — update them on this connection."
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
  tabBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  tabBarDark: {
    borderBottomColor: "#1a1a1a",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: "#0a0a0a",
  },
  tabActiveDark: {
    backgroundColor: "#ffffff",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666666",
  },
  tabTextDark: {
    color: "#888888",
  },
  tabTextActive: {
    color: "#ffffff",
  },
  tabTextActiveDark: {
    color: "#0a0a0a",
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
  ptyBadge: {
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ptyBadgeText: {
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
