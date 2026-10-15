import { memo } from "react"
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform } from "react-native"
import { useTranslation } from "react-i18next"
import { Markdown } from "../markdown"
import { ToolCallCard } from "./ToolCallCard"
import { ReasoningBlock } from "./ReasoningBlock"
import type { Message, Part } from "../../lib/sdk"
import { hasSelectableContent } from "../../lib/message-text"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { GUTTER_ASSISTANT, GUTTER_USER, monoFont } from "./tui"

const SCREEN_WIDTH = Dimensions.get("window").width
const mono = monoFont(Platform.OS)

function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith("image/")
}

interface Props {
  message: Message
  parts: Part[]
  isDark: boolean
  palette?: AppPalette
  // Message actions arrive as buttons in the header row (see the header
  // comment in the render). There is deliberately no bubble-wide press or
  // long-press: it competed with horizontal scrolling in code blocks and with
  // text selection, and holding a message no longer pops anything. Handlers are
  // identified by messageID (not a closure over parts) so they stay correct even
  // if the memo below bails on a stale render.
  onSelectText?: (messageID: string) => void
  onEdit?: (messageID: string) => void
  // Queued (not yet delivered) user message: renders a pending affordance
  // with Cancel/Edit actions instead of the normal Edit flow (a queued item
  // is not a committed message — editing it is cancel-and-resend).
  queued?: boolean
  onCancelQueued?: (messageID: string) => void
}

function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// TUI transcript block: flat, full-width, left-aligned — no bubble, no card,
// no rounded corners. A 1px rule (borderSubtle) separates blocks; a fixed
// left gutter carries the role marker (`>` primary for the user, `⏺` accent
// for the assistant — the marker is text, so role never depends on color
// alone). Body, metadata, and the composer all share one monospace family.
export const MessageBubble = memo(
  function MessageBubble({ message, parts, isDark, palette, onSelectText, onEdit, queued, onCancelQueued }: Props) {
    const isUser = message.role === "user"
    const c = palette ?? defaultPalette(isDark ? "dark" : "light")
    const { t } = useTranslation()

    const textParts = parts.filter((p) => p.type === "text")
    const reasoningParts = parts.filter((p) => p.type === "reasoning")
    const toolParts = parts.filter((p) => p.type === "tool")
    const fileParts = parts.filter((p) => p.type === "file" && isImageMime(p.mime))
    const text = textParts.map((p) => p.text).join("\n") || ""
    const reasoning = reasoningParts.map((p) => p.text).join("\n") || ""
    const modelLabel = message.model?.modelID || message.modelID

    return (
      <View
        style={[
          s.bubble,
          { backgroundColor: c.background, borderBottomColor: c.borderSubtle },
        ]}
        testID={`chat-bubble-${message.role}`}
      >
        <View style={s.row}>
          {/* Role marker gutter */}
          <Text style={[s.gutter, { color: isUser ? c.primary : c.accent }]}>
            {isUser ? GUTTER_USER : GUTTER_ASSISTANT}
          </Text>
          <View style={s.body}>
            {/* Role line: role · model, dim and compact, actions right-aligned */}
            <View style={s.header}>
              <Text style={[s.role, { color: c.muted }]}>
                {isUser ? "You" : "Assistant"}
                {modelLabel ? <Text style={[s.modelTag, { color: c.muted }]}> · {modelLabel}</Text> : null}
                {queued && isUser ? <Text style={[s.modelTag, { color: c.muted }]}> · {t("session.queue.pending")}</Text> : null}
              </Text>
              {/* Message actions are taps in a right-aligned group at the end of the
                  header row — "Select text" sits immediately left of "Edit". Nothing
                  here is a bubble-wide gesture: a long-press on the bubble competed
                  with horizontal scrolling in code blocks and with text selection.
                  Labels are explicitly non-selectable so a tap can't be swallowed. */}
              {(onSelectText || onEdit || (queued && onCancelQueued)) && (
                <View style={s.actions}>
                  {queued && isUser && onCancelQueued && !message.id.startsWith("temp-") && (
                    <TouchableOpacity
                      style={[s.selectChip, { borderColor: c.borderSubtle }]}
                      hitSlop={8}
                      onPress={() => onCancelQueued(message.id)}
                      testID={`message-cancel-queued-${message.id}`}
                    >
                      <Text selectable={false} style={[s.selectChipText, { color: c.muted }]}>
                        {t("session.queue.cancel")}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {onSelectText && hasSelectableContent(parts) && (
                    <TouchableOpacity
                      style={[s.selectChip, { borderColor: c.borderSubtle }]}
                      hitSlop={8}
                      onPress={() => onSelectText(message.id)}
                      testID={`message-select-text-${message.id}`}
                    >
                      <Text selectable={false} style={[s.selectChipText, { color: c.muted }]}>
                        Select text
                      </Text>
                    </TouchableOpacity>
                  )}
                  {isUser && onEdit && (
                    <TouchableOpacity
                      style={[s.selectChip, { borderColor: c.borderSubtle }]}
                      hitSlop={8}
                      onPress={() => onEdit(message.id)}
                      testID={`message-edit-${message.id}`}
                    >
                      <Text selectable={false} style={[s.selectChipText, { color: c.muted }]}>
                        {queued ? t("session.queue.editResend") : "Edit"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Image attachments */}
            {fileParts.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.imageRow}
                style={s.imageScroll}
              >
                {fileParts.map((fp) => (
                  <View key={fp.id} style={s.imageWrap}>
                    <Image source={{ uri: fp.url }} style={s.attachedImage} resizeMode="cover" />
                    {fp.filename && (
                      <Text style={[s.imageLabel, { color: c.muted }]} numberOfLines={1}>
                        {fp.filename}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Reasoning (collapsible) */}
            {reasoning.length > 0 && <ReasoningBlock text={reasoning} isDark={isDark} palette={c} />}

            {/* Message text */}
            {text.length > 0 &&
              (isUser ? (
                // Android: inline selection in a list row is unreliable (RN#46999)
                // and competes with the bubble's long-press, so user text selects
                // through the "Select text" sheet. iOS has no such conflict.
                <Text style={[s.messageText, { fontFamily: mono, color: c.text }]} selectable={Platform.OS === "ios"}>
                  {text}
                </Text>
              ) : (
                <View style={s.markdownWrap}>
                  <Markdown palette={c}>{text}</Markdown>
                </View>
              ))}

            {/* Tool calls */}
            {toolParts.map((tool) => (
              <ToolCallCard key={tool.id} tool={tool} isDark={isDark} palette={c} sessionID={message.sessionID} />
            ))}

            {/* Run-level failure (assistant message carries `error` when the agent
                errored out — provider failure, aborted stream, etc.). Without this
                an errored run looked identical to a successful one when reading
                history; the live case is covered by the session error banner. */}
            {message.error?.message && (
              <View style={[s.errorBlock, { borderLeftColor: c.error }]}>
                <Text
                  style={[s.errorBlockText, { fontFamily: mono, color: c.error }]}
                  selectable={Platform.OS === "ios"}
                >
                  {message.error.message}
                </Text>
              </View>
            )}

            {/* Tokens/cost for assistant messages: one dim compact line, TUI-style */}
            {!isUser && message.tokens && (
              <Text style={[s.tokens, { fontFamily: mono, color: c.muted }]}>
                {compactCount(message.tokens.input + message.tokens.output)} tokens
                {message.cost ? ` · $${message.cost.toFixed(4)}` : ""}
              </Text>
            )}
          </View>
        </View>
      </View>
    )
  },
  (prev, next) => {
    // Only re-render if message content actually changed
    // This prevents completed messages from re-rendering during streaming.
    // The store replaces changed parts/messages with NEW object references,
    // so a reference-equality sweep over every part catches every real change
    // (including tool parts, which have no `.text`) while still skipping
    // unchanged (completed) messages during other messages' streaming.
    if (prev.message !== next.message) return false
    if (prev.isDark !== next.isDark) return false
    if (prev.palette !== next.palette) return false
    if (prev.onSelectText !== next.onSelectText) return false
    if (prev.onEdit !== next.onEdit) return false
    if (prev.queued !== next.queued) return false
    if (prev.onCancelQueued !== next.onCancelQueued) return false
    if (prev.parts.length !== next.parts.length) return false
    for (let i = 0; i < prev.parts.length; i++) {
      if (prev.parts[i] !== next.parts[i]) return false
    }
    return true
  },
)

const s = StyleSheet.create({
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    maxWidth: "100%",
  },
  row: { flexDirection: "row", gap: 8 },
  gutter: {
    width: 20,
    fontSize: 14,
    fontFamily: mono,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
  },
  body: { flex: 1, minWidth: 0 },

  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  role: { fontSize: 12, fontFamily: mono, fontWeight: "600" },
  modelTag: { fontSize: 11, fontFamily: mono, fontWeight: "400" },

  actions: {
    // Pushes the group to the right edge of the header row; the chips inside it
    // stay adjacent in source order (Select text, then Edit).
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  selectChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    flexShrink: 0,
  },
  selectChipDark: { borderColor: "#404040" },
  selectChipText: { fontSize: 11, fontFamily: mono },
  selectChipTextDark: { color: "#d4d4d4" },

  messageText: { fontSize: 14, lineHeight: 21 },
  markdownWrap: { marginHorizontal: -4 },

  tokens: { fontSize: 11, marginTop: 8 },

  // Run-level error block: flat, carried by a left rule + error text
  errorBlock: {
    marginTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
  },
  errorBlockText: { fontSize: 13, lineHeight: 20 },

  // Images
  imageScroll: { marginBottom: 8 },
  imageRow: { gap: 8 },
  imageWrap: { alignItems: "center" },
  attachedImage: {
    width: Math.min(200, SCREEN_WIDTH * 0.5),
    height: Math.min(200, SCREEN_WIDTH * 0.5),
    backgroundColor: "#e5e5e5",
  },
  imageLabel: { fontSize: 10, fontFamily: mono, marginTop: 2, maxWidth: 200 },
})
