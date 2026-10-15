import { View, Text, StyleSheet, Platform } from "react-native"
import { wideTextSelection } from "../../lib/scroll-config"
import { defaultPalette, type AppPalette } from "../../lib/opencode-theme"
import { monoFont } from "./tui"
import { computeDiff } from "./diff-compute"

const mono = monoFont(Platform.OS)

interface Props {
  before: string
  after: string
  isDark: boolean
  palette?: AppPalette
}

// TUI-style diff: +/-/context-prefixed lines painted with the theme's real
// diff tokens (diffAdded/diffRemoved/diffContext for the glyph + text, the
// *Bg variants for the row fill, diffLineNumber for the gutter) — not a
// generic green/red. No truncation, no sideways scroll (issue #21): long
// lines fold inside their row via flex:1.
export function DiffView({ before, after, isDark, palette }: Props) {
  const lines = computeDiff(before, after)
  const sel = wideTextSelection(Platform.OS)
  const c = palette ?? defaultPalette(isDark ? "dark" : "light")

  if (lines.length === 0) return null

  return (
    <View style={[s.container, { backgroundColor: c.diffContextBg }]} testID="diff-view">
      {lines.map((line, idx) => (
        <View
          key={idx}
          style={[
            s.line,
            line.type === "add" && { backgroundColor: c.diffAddedBg },
            line.type === "remove" && { backgroundColor: c.diffRemovedBg },
          ]}
        >
          <Text
            style={[
              s.prefix,
              {
                color:
                  line.type === "add"
                    ? c.diffAdded
                    : line.type === "remove"
                      ? c.diffRemoved
                      : c.diffLineNumber,
              },
            ]}
          >
            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
          </Text>
          {/* s.text is flex:1 with no numberOfLines, so a long diff line folds
              inside its own row: the +/- gutter stays aligned with the line it
              belongs to, and nothing is truncated (issue #21). Wrapping is
              rendering only — the diff text itself is untouched. */}
          <Text
            style={[
              s.text,
              {
                color:
                  line.type === "add"
                    ? c.diffAdded
                    : line.type === "remove"
                      ? c.diffRemoved
                      : c.diffContext,
              },
            ]}
            selectable={sel.selectable}
          >
            {line.text.length > 0 ? line.text : " "}
          </Text>
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    marginTop: 6,
  },

  line: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 1,
  },

  prefix: {
    width: 16,
    fontSize: 12,
    fontFamily: mono,
    fontWeight: "700",
    lineHeight: 20,
  },

  text: {
    // flex:1 is what makes the fold happen inside the row instead of pushing the
    // row wider than the screen.
    flex: 1,
    fontSize: 12,
    fontFamily: mono,
    lineHeight: 20,
  },
})
