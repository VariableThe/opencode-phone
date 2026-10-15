import { useMemo, useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme, Platform } from "react-native"
import * as Clipboard from "expo-clipboard"
import { wideTextSelection } from "../../lib/scroll-config"
import { defaultPalette, syntaxColors, type AppPalette } from "../../lib/opencode-theme"
import { highlightLine, type HighlightKind } from "../../lib/syntax-highlight"
import { monoFont } from "../chat/tui"

interface Props {
  code: string
  language?: string
  palette?: AppPalette
}

export function CodeBlock({ code, language, palette }: Props) {
  const scheme = useColorScheme()
  const isDark = scheme === "dark"
  const [copied, setCopied] = useState(false)
  const sel = wideTextSelection(Platform.OS)
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")
  const mono = monoFont(Platform.OS)

  // Cosmetic wrapping: one Text per logical line, so indentation survives and a
  // long line folds inside the block instead of needing sideways scrolling.
  // The clipboard gets `code` — the raw string from the server — so what you
  // paste is byte-identical to what was sent, line breaks and all. Wrapping only
  // exists in the rendering. See ../../lib/scroll-config for why these blocks no
  // longer scroll horizontally.
  const lines = code.split("\n")

  // TUI-style highlighting: the theme's syntax* tokens color strings,
  // comments, numbers, and keywords per line. Single-line tokenizer only —
  // anything it doesn't model stays in the base code color, never dropped.
  const colors = syntaxColors(c)
  const colorFor = (kind: HighlightKind): string => {
    if (kind === "comment") return colors.comment
    if (kind === "keyword") return colors.keyword
    if (kind === "string") return colors.string
    if (kind === "number") return colors.number
    return colors.base
  }
  const highlighted = useMemo(() => lines.map((line) => highlightLine(line)), [code])

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <View style={[styles.container, { backgroundColor: c.panel, borderColor: c.borderSubtle }]}>
      <View style={[styles.header, { borderBottomColor: c.borderSubtle }]}>
        <Text style={[styles.language, { fontFamily: mono, color: c.muted }]}>{language || "code"}</Text>
        <TouchableOpacity onPress={copy} hitSlop={8}>
          <Text style={[styles.copyBtn, { fontFamily: mono, color: c.primary }]}>{copied ? "Copied!" : "Copy"}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.codeBody} testID="code-block-body">
        {lines.map((line, idx) => (
          // An empty Text collapses to zero height, which would eat blank lines
          // and make pasted-vs-displayed line counts disagree.
          <Text key={idx} style={[styles.code, { fontFamily: mono, color: colors.base }]} selectable={sel.selectable}>
            {line.length > 0 ? highlighted[idx].map((seg, j) => (
              <Text key={j} style={{ color: colorFor(seg.kind) }}>
                {seg.text}
              </Text>
            )) : " "}
          </Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    borderWidth: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  language: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  copyBtn: {
    fontSize: 11,
    fontWeight: "600",
  },
  codeBody: {
    padding: 12,
  },
  code: {
    fontSize: 13,
    lineHeight: 20,
  },
})
