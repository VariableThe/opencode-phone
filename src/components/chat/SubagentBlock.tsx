import { useMemo, useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Message, Part } from "../../lib/sdk"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { GUTTER_ASSISTANT, monoFont, toolArgsSummary } from "./tui"
import { useSubagents } from "../../stores/subagents"
import { linkSubagentChild, subagentInputOf, subagentPhase, type SubagentPhase } from "../../lib/subagent-link"
import { statusFromPart } from "../../lib/status-labels"
import { useNow } from "../../lib/use-now"

const mono = monoFont(Platform.OS)

// How many of the child's recent transcript lines the expanded block shows.
// The block is a live tail, not a full transcript — the full history stays on
// the server and the child session keeps it after reload via trackParent.
const TAIL_LINES = 6

function phaseColor(phase: SubagentPhase, c: AppPalette): string {
  if (phase === "done") return c.success
  if (phase === "failed") return c.error
  if (phase === "stale") return c.muted
  return c.warning
}

function phaseKey(phase: SubagentPhase): string {
  if (phase === "done") return "done"
  if (phase === "failed") return "failed"
  if (phase === "stale") return "stale"
  if (phase === "starting") return "starting"
  return "working"
}

// One compact transcript line from a child message: latest tool call wins,
// else the text head. Reasoning-only messages collapse to nothing (the live
// status line already says "Thinking...").
function messageLine(message: Message, parts: Part[]): string | null {
  const tools = parts.filter((p) => p.type === "tool")
  const last = tools[tools.length - 1]
  if (last) {
    const args = toolArgsSummary(last.state?.input)
    const mark = last.state?.status === "error" ? "!" : "●"
    return `${mark} ${last.state?.title || last.tool || "tool"}${args ? `(${args})` : ""}`.slice(0, 140)
  }
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (text) return text.slice(0, 140)
  return null
}

interface Props {
  tool: Part
  parentSessionID: string
  isDark: boolean
  palette?: AppPalette
}

// Nested live view of a `subagent` (v2) / `task` (v1) delegation, rendered
// under its tool call: the subagent's identity (agent name + description),
// its live status, and a tail of what it is doing right now. TUI style —
// indented block under the tool row, left rule, gutter marker, mono, dim
// metadata. Expandable; expanded by default so running work is visible.
export function SubagentBlock({ tool, parentSessionID, isDark, palette }: Props) {
  const { t } = useTranslation()
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const [expanded, setExpanded] = useState(true)
  // Ticking clock so a hung delegation visibly transitions working -> stale.
  const now = useNow()

  const children = useSubagents((s) => s.children)
  const linked = useMemo(() => {
    const infos = Object.values(children).map((child) => child.info)
    const id = linkSubagentChild(infos, parentSessionID, tool.state?.input, {
      sessionID: tool.state?.subagentSessionID,
    })
    return id ? children[id] : null
  }, [children, parentSessionID, tool])

  const input = subagentInputOf(tool.state?.input)
  const toolStatus = tool.state?.status || "pending"
  const phase = subagentPhase(toolStatus, !!linked, linked?.lastActivityAt ?? 0, now)
  const color = phaseColor(phase, c)
  const agent = linked?.info.agent || input.agent

  const lines = useMemo(() => {
    if (!linked) return []
    const out: string[] = []
    const messages = linked.messages.slice().reverse()
    for (const message of messages) {
      if (out.length >= TAIL_LINES) break
      if (message.role !== "assistant") continue
      const line = messageLine(message, linked.parts[message.id] || [])
      if (line) out.push(line)
    }
    return out.reverse()
  }, [linked])

  // Live status: the child's latest part when working, the terminal state
  // otherwise. Falls back to the delegation description while starting.
  const liveText = useMemo(() => {
    if (phase === "done") return t("chat.subagent.done")
    if (phase === "failed") return linked?.error || t("chat.subagent.failed")
    if (phase === "stale") return t("chat.subagent.stale")
    if (!linked) return input.description || t("chat.subagent.starting")
    const messages = linked.messages
    const last = messages[messages.length - 1]
    const parts = last ? linked.parts[last.id] || [] : []
    const part = parts[parts.length - 1]
    if (part) return statusFromPart(part)
    return t("chat.subagent.working")
  }, [phase, linked, input.description, t])

  return (
    <View style={[s.block, { borderLeftColor: c.borderSubtle }]} testID={`subagent-block-${tool.callID || tool.id}`}>
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7} accessibilityRole="button">
        <View style={s.header}>
          <Text style={[s.marker, { color }]}>{GUTTER_ASSISTANT}</Text>
          <Text style={[s.identity, { color: c.muted }]} numberOfLines={1}>
            {t("chat.subagent.label")}
            {agent ? ` · ${agent}` : ""}
          </Text>
          {phase === "working" && <ActivityIndicator size="small" color={color} />}
          <Text style={[s.status, { color: phase === "failed" ? c.error : c.muted }]} numberOfLines={1}>
            {liveText}
          </Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={c.muted} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={s.tail}>
          {input.description && (
            <Text style={[s.desc, { color: c.muted }]} numberOfLines={2}>
              {input.description}
            </Text>
          )}
          {lines.map((line, i) => (
            <Text key={`${linked?.info.id}-${i}`} style={[s.line, { color: c.muted }]} numberOfLines={2}>
              {line}
            </Text>
          ))}
          {linked && lines.length === 0 && phase !== "failed" && (
            <Text style={[s.line, { color: c.muted }]}>{t("chat.subagent.working")}…</Text>
          )}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  // Indented under the tool row (matches ToolCallCard's 26px detail indent),
  // carried by a left rule — no card, no rounded corners.
  block: {
    marginTop: 4,
    marginLeft: 26,
    paddingLeft: 8,
    borderLeftWidth: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  marker: {
    fontSize: 12,
    fontFamily: mono,
    fontWeight: "700",
    textAlign: "center",
  },
  identity: {
    fontSize: 12,
    fontFamily: mono,
  },
  status: {
    fontSize: 12,
    fontFamily: mono,
    flex: 1,
  },
  tail: {
    marginTop: 4,
    gap: 2,
  },
  desc: {
    fontSize: 12,
    fontFamily: mono,
    lineHeight: 17,
  },
  line: {
    fontSize: 12,
    fontFamily: mono,
    lineHeight: 17,
  },
})
