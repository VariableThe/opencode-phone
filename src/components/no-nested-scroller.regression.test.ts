import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// The transcript in app/session/[id].tsx is an *inverted* FlatList. A nested
// vertical scroll container inside any of its rows used to steal the gesture
// and chain the leftover into the inverted parent, whose flipped transform
// then moved content opposite the finger (scroll-down at the bottom scrolled
// the view upward with a subagent/tool dropdown expanded — ToolCallCard's
// expanded detail was the nested ScrollView, maxHeight 300). The fix is one
// scroll container only: row content lays out fully in place, bounded by the
// per-detail numberOfLines caps, and the parent list owns the gesture.
//
// What has to stay true:
//   (a) no vertical ScrollView / FlatList inside transcript row components
//       (horizontal image strips are fine — they never chain vertically)
//   (b) no maxHeight-bounded box that could become a scroll region again
//   (c) SubagentBlock keeps its TAIL_LINES live-tail cap (full content, capped)
//
// This repo's runtime is React Native, so these components can't be rendered
// with node:test (no RN renderer — package.json's "test" script only globs
// plain .test.ts files). Like wide-content-wrap.regression.test.ts, this test
// reads the actual .tsx source and asserts on the markers that would prove a
// regression.

const here = path.dirname(fileURLToPath(import.meta.url))
const readComponent = (rel: string) => readFileSync(path.join(here, rel), "utf8")

// Components rendered as rows (directly or transitively) of the inverted
// transcript list. Sheets/modals (BottomSheetFlatList hosts) are intentionally
// excluded — they render outside the list.
const ROW_COMPONENTS = [
  "chat/ToolCallCard.tsx",
  "chat/SubagentBlock.tsx",
  "chat/ReasoningBlock.tsx",
  "chat/DiffView.tsx",
  "chat/MessageBubble.tsx",
  "markdown/CodeBlock.tsx",
  "markdown/Markdown.tsx",
]

// The rationale lives in comments, so comments must not be mistaken for code.
function codeOnly(src: string) {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
}

test("no vertical nested scroll container inside inverted-list rows", () => {
  for (const rel of ROW_COMPONENTS) {
    const code = codeOnly(readComponent(rel))
    // Every <ScrollView ...> tag must carry the horizontal prop (the image
    // strips); a bare <ScrollView> scrolls vertically and would chain into
    // the inverted parent with a flipped direction.
    for (const match of code.matchAll(/<ScrollView\b[^>]*>/g)) {
      assert.ok(
        match[0].includes("horizontal"),
        `${rel} must not contain a vertical ScrollView inside the inverted list (found: ${match[0]})`,
      )
    }
    // No nested virtualized list either (Markdown.tsx documents why the
    // react-native-marked FlatList default was already replaced).
    assert.doesNotMatch(code, /<(FlatList|VirtualizedList|SectionList)\b/, `${rel} must not nest a list in the inverted list`)
    assert.doesNotMatch(code, /BottomSheetFlatList/, `${rel} must not nest a list in the inverted list`)
  }
})

test("expanded tool detail lays out in place instead of a maxHeight scroll box", () => {
  const code = codeOnly(readComponent("chat/ToolCallCard.tsx"))
  assert.doesNotMatch(code, /ScrollView/, "ToolCallCard must not contain any ScrollView")
  assert.doesNotMatch(code, /maxHeight/, "ToolCallCard must not clip detail behind a maxHeight box")
  assert.doesNotMatch(code, /nestedScrollEnabled/, "ToolCallCard must not chain gestures into the parent list")
})

test("subagent tail stays a capped live tail, not a scroll region", () => {
  const src = readComponent("chat/SubagentBlock.tsx")
  assert.ok(src.includes("TAIL_LINES"), "SubagentBlock must keep its live-tail line cap")
  const code = codeOnly(src)
  assert.doesNotMatch(code, /ScrollView/, "SubagentBlock must not contain a scroll container")
  assert.doesNotMatch(code, /maxHeight/, "SubagentBlock must not clip behind a maxHeight box")
})
