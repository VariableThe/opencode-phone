import { useState, useCallback } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Part } from "../../lib/sdk"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { GUTTER_ASSISTANT, monoFont, toolArgsSummary } from "./tui"
import { isSubagentTool } from "../../lib/subagent-link"
import { SubagentBlock } from "./SubagentBlock"
import { DiffView } from "./DiffView"

const mono = monoFont(Platform.OS)

function statusColor(status: string, c: AppPalette): string {
  if (status === "completed") return c.success
  if (status === "error") return c.error
  if (status === "running") return c.warning
  return c.muted
}

// --- Tool-specific detail renderers ---
// Flat, indented, dimmed output blocks beneath the header row (TUI-style):
// backgroundElement fill, no cards, no title bars. Output caps stay — a
// 10k-line bash dump must not mount 10k rows (perf on long transcripts).

interface DetailProps {
  input: unknown
  output: unknown
  c: AppPalette
}

function BashDetail({ input, output, c }: DetailProps) {
  const cmd = typeof input === "object" && input !== null ? (input as Record<string, unknown>).command : undefined
  const out = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof cmd === "string" && (
        <Text style={[s.codePre, { color: c.text }]} selectable numberOfLines={80}>
          <Text style={{ color: c.primary, fontWeight: "700" }}>$ </Text>
          {cmd}
        </Text>
      )}
      {out !== undefined && out.length > 0 && (
        <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={80}>
          {out}
        </Text>
      )}
    </View>
  )
}

function ReadDetail({ input, c }: { input: unknown; c: AppPalette }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const offset = typeof input === "object" && input !== null ? (input as Record<string, unknown>).offset : undefined
  const limit = typeof input === "object" && input !== null ? (input as Record<string, unknown>).limit : undefined
  const range = offset || limit ? ` (${offset || 0}..${limit || "end"})` : ""
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, { color: c.secondary }]} selectable numberOfLines={2}>
          {file}
          {range}
        </Text>
      )}
    </View>
  )
}

function WriteDetail({ input, c }: { input: unknown; c: AppPalette }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const content = typeof input === "object" && input !== null ? (input as Record<string, unknown>).content : undefined
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, { color: c.secondary }]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {typeof content === "string" && content.length > 0 && (
        <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={40}>
          {content}
        </Text>
      )}
    </View>
  )
}

function EditDetail({ input, output, c, isDark }: DetailProps & { isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const old = typeof input === "object" && input !== null ? (input as Record<string, unknown>).oldString : undefined
  const replacement =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).newString : undefined

  // If we have old/new strings, show as diff
  if (typeof old === "string" && typeof replacement === "string") {
    return (
      <View style={s.detailSection}>
        {typeof file === "string" && (
          <Text style={[s.detailFile, { color: c.secondary }]} selectable numberOfLines={2}>
            {file}
          </Text>
        )}
        <DiffView before={old} after={replacement} isDark={isDark} palette={c} />
      </View>
    )
  }

  // Fallback: show raw output
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2)
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, { color: c.secondary }]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {text && (
        <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={40}>
          {text}
        </Text>
      )}
    </View>
  )
}

function PatchDetail({ input, c }: { input: unknown; c: AppPalette }) {
  const patch = typeof input === "object" && input !== null ? (input as Record<string, unknown>).patch : undefined
  return (
    <View style={s.detailSection}>
      {typeof patch === "string" && patch.length > 0 && (
        <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={60}>
          {patch}
        </Text>
      )}
    </View>
  )
}

function GlobGrepDetail({ input, output, c }: DetailProps) {
  const { t } = useTranslation()
  const pattern = typeof input === "object" && input !== null ? (input as Record<string, unknown>).pattern : undefined
  const path = typeof input === "object" && input !== null ? (input as Record<string, unknown>).path : undefined
  const results = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof pattern === "string" && (
        <Text style={[s.detailMeta, { color: c.muted }]}>
          {typeof path === "string"
            ? t("chat.toolCallCard.patternWithPath", { pattern, path })
            : t("chat.toolCallCard.patternOnly", { pattern })}
        </Text>
      )}
      {results && results.length > 0 && (
        <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={30}>
          {results}
        </Text>
      )}
    </View>
  )
}

function WebfetchDetail({ input, c }: { input: unknown; c: AppPalette }) {
  const url = typeof input === "object" && input !== null ? (input as Record<string, unknown>).url : undefined
  return (
    <View style={s.detailSection}>
      {typeof url === "string" && (
        <Text style={[s.detailFile, { color: c.primary }]} selectable numberOfLines={3}>
          {url}
        </Text>
      )}
    </View>
  )
}

function TaskDetail({ input, c }: { input: unknown; c: AppPalette }) {
  const description =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).description : undefined
  const prompt = typeof input === "object" && input !== null ? (input as Record<string, unknown>).prompt : undefined
  return (
    <View style={s.detailSection}>
      {typeof description === "string" && <Text style={[s.detailMeta, { color: c.muted }]}>{description}</Text>}
      {typeof prompt === "string" && prompt.length > 0 && (
        <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={20}>
          {prompt}
        </Text>
      )}
    </View>
  )
}

function TodoDetail({ input, c }: { input: unknown; c: AppPalette }) {
  const todos = typeof input === "object" && input !== null ? (input as Record<string, unknown>).todos : undefined
  if (!Array.isArray(todos)) return null
  return (
    <View style={s.detailSection}>
      {todos.map((t, i) => {
        const item = t as Record<string, unknown>
        const done = item.status === "completed"
        return (
          <View key={String(item.id || i)} style={s.todoRow}>
            <Text style={[s.todoBox, { color: done ? c.success : c.muted }]}>{done ? "✓" : "○"}</Text>
            <Text style={[s.todoText, { color: done ? c.muted : c.text }, done && s.todoDone]} numberOfLines={2}>
              {String(item.content || item.title || "")}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function GenericDetail({ input, output, c }: DetailProps) {
  const text =
    typeof output === "string"
      ? output
      : output !== undefined && output !== null
        ? JSON.stringify(output, null, 2)
        : typeof input === "object" && input !== null
          ? JSON.stringify(input, null, 2)
          : undefined
  if (!text || text.length === 0) return null
  return (
    <View style={s.detailSection}>
      <Text style={[s.codePre, { color: c.muted }]} selectable numberOfLines={30}>
        {text}
      </Text>
    </View>
  )
}

function ToolDetail({ tool, c, isDark }: { tool: Part; c: AppPalette; isDark: boolean }) {
  const name = tool.tool || ""
  const input = tool.state?.input
  const output = tool.state?.output

  switch (name) {
    case "bash":
      return <BashDetail input={input} output={output} c={c} />
    case "read":
      return <ReadDetail input={input} c={c} />
    case "write":
      return <WriteDetail input={input} c={c} />
    case "edit":
      return <EditDetail input={input} output={output} c={c} isDark={isDark} />
    case "apply_patch":
      return <PatchDetail input={input} c={c} />
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
      return <GlobGrepDetail input={input} output={output} c={c} />
    case "webfetch":
    case "websearch":
      return <WebfetchDetail input={input} c={c} />
    case "task":
    case "subagent":
      return <TaskDetail input={input} c={c} />
    case "todowrite":
      return <TodoDetail input={input} c={c} />
    default:
      return <GenericDetail input={input} output={output} c={c} />
  }
}

// --- Error display ---
function ErrorBanner({ message, c }: { message: string; c: AppPalette }) {
  return (
    <View style={s.errorBanner}>
      <Text style={[s.errorText, { color: c.error }]} numberOfLines={3} selectable>
        {message}
      </Text>
    </View>
  )
}

// --- Duration display ---
function duration(start?: number, end?: number): string | null {
  if (!start || !end) return null
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// --- Main component ---
// TUI-style tool row: `⏺ toolName(dimmed args)` in the gutter, result as an
// indented dimmed block beneath — no card, no title bar (mirrors
// InlineToolRow in the TUI's message-parts.tsx: fixed icon gutter + label,
// dimmed while running, expanded detail below). Collapse/expand, error
// display, and duration all preserved; status is never color-only (running
// spinner, explicit error text).
interface Props {
  tool: Part
  isDark: boolean
  palette?: AppPalette
  // Parent session id — lets subagent/task delegations resolve and render
  // their live child activity nested under the tool call (SubagentBlock).
  sessionID?: string
}

export function ToolCallCard({ tool, isDark, palette, sessionID }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const status = tool.state?.status || "pending"
  const color = statusColor(status, c)
  const error = tool.state?.error?.message
  const elapsed = duration(tool.state?.time?.start, tool.state?.time?.end)
  const hasDetail = tool.state?.input !== undefined || tool.state?.output !== undefined || error
  const args = toolArgsSummary(tool.state?.input)

  const toggle = useCallback(() => {
    if (hasDetail) setExpanded((v) => !v)
  }, [hasDetail])

  return (
    <View style={s.row}>
      <TouchableOpacity onPress={toggle} activeOpacity={hasDetail ? 0.7 : 1} accessibilityRole="button">
        <View style={s.header}>
          <Text style={[s.marker, { color }]}>{GUTTER_ASSISTANT}</Text>
          <Text style={[s.name, { color: status === "error" ? c.error : c.text }]} numberOfLines={1}>
            {tool.state?.title || tool.tool || t("chat.toolCallCard.fallbackTitle")}
            {args.length > 0 && <Text style={{ color: c.muted }}>({args})</Text>}
          </Text>
          {status === "running" && <ActivityIndicator size="small" color={color} />}
          {elapsed && <Text style={[s.elapsed, { color: c.muted }]}>{elapsed}</Text>}
          {hasDetail && (
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={c.muted} />
          )}
        </View>
      </TouchableOpacity>

      {/* Error text is always visible (not color-only, not hidden collapsed) */}
      {error && !expanded && <ErrorBanner message={error} c={c} />}

      {/* Subagent delegation: nested live child activity (identity, status,
          tail), updating live — not just a collapsed summary on completion. */}
      {isSubagentTool(tool.tool) && sessionID && (
        <SubagentBlock tool={tool} parentSessionID={sessionID} isDark={isDark} palette={c} />
      )}

      {/* Expanded detail: indented dimmed block, laid out in the parent
          list — never a nested scroll container. A vertical ScrollView here
          used to chain leftover gestures into the inverted transcript list,
          whose flipped transform then moved content opposite the finger
          (scroll-down at the bottom scrolled the view upward). The per-detail
          numberOfLines caps above stay as the bound on very long output. */}
      {expanded && (
        <View style={s.detail}>
          {error && <ErrorBanner message={error} c={c} />}
          <ToolDetail tool={tool} c={c} isDark={isDark} />
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  row: {
    marginTop: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  marker: {
    width: 20,
    fontSize: 13,
    fontFamily: mono,
    fontWeight: "700",
    textAlign: "center",
  },
  name: {
    fontSize: 13,
    fontFamily: mono,
    flex: 1,
  },
  elapsed: { fontSize: 11, fontFamily: mono },

  // Error
  errorBanner: {
    marginTop: 4,
    paddingLeft: 26,
  },
  errorText: { fontSize: 12, fontFamily: mono, lineHeight: 18 },

  // Detail: indented dimmed block under the header row. Deliberately a
  // plain View with no maxHeight: the parent transcript list owns the only
  // vertical scroll gesture, so this content must lay out fully in place.
  detail: { marginTop: 4, paddingLeft: 26 },
  detailSection: { gap: 4 },
  detailFile: {
    fontSize: 12,
    fontFamily: mono,
    lineHeight: 18,
  },
  detailMeta: { fontSize: 12, fontFamily: mono, lineHeight: 18 },

  codePre: {
    fontSize: 12,
    fontFamily: mono,
    lineHeight: 18,
  },

  // Todo
  todoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  todoBox: { fontSize: 13, fontFamily: mono, lineHeight: 20 },
  todoText: { fontSize: 13, fontFamily: mono, flex: 1, lineHeight: 20 },
  todoDone: { textDecorationLine: "line-through" },
})
