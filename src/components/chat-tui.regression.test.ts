import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// The TUI restyle: flat full-width left-aligned blocks, monospace transcript,
// gutter role markers, TUI-style tool rows, real diff/markdown/syntax theme
// tokens. Same approach as the other regression tests here: node:test with no
// RN renderer, so assert on the real component source.

// src/components/chat/*.tsx, src/components/markdown/*.tsx, app/**/*.tsx
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8")

test("transcript blocks are flat: no bubbles, no rounded cards", () => {
  const bubble = read("chat/MessageBubble.tsx")
  assert.doesNotMatch(bubble, /borderRadius/, "no rounded corners on transcript blocks")
  assert.ok(bubble.includes("borderBottomColor"), "blocks separated by a 1px rule")
  assert.ok(bubble.includes("GUTTER_USER") && bubble.includes("GUTTER_ASSISTANT"), "gutter role markers")
  const tool = read("chat/ToolCallCard.tsx")
  assert.doesNotMatch(tool, /borderRadius/, "tool rows are not cards")
  assert.ok(tool.includes("toolArgsSummary"), "header is toolName(dimmed args)")
})

test("transcript is monospace end to end", () => {
  for (const rel of ["chat/MessageBubble.tsx", "chat/ToolCallCard.tsx", "chat/DiffView.tsx", "markdown/CodeBlock.tsx", "markdown/Markdown.tsx", "chat/ReasoningBlock.tsx", "chat/PermissionPrompt.tsx", "chat/QuestionPrompt.tsx", "chat/StatusIndicator.tsx"]) {
    assert.ok(read(rel).includes("mono"), `${rel} paints in the shared monospace family`)
  }
  const session = readFileSync(path.join(here, "..", "..", "app", "session", "[id].tsx"), "utf8")
  assert.ok(session.includes("GUTTER_USER"), "composer carries the `>` prompt marker")
})

test("diffs use the real diff token set, not generic green/red", () => {
  const diff = read("chat/DiffView.tsx")
  for (const token of ["diffAddedBg", "diffRemovedBg", "diffContextBg", "diffAdded", "diffRemoved", "diffContext", "diffLineNumber"]) {
    assert.ok(diff.includes(token), `DiffView uses ${token}`)
  }
  assert.doesNotMatch(diff, /#16a34a|#dc2626|#22c55e|#ef4444/, "no hardcoded generic diff colors")
})

test("markdown and code use the theme's markdown/syntax tokens", () => {
  const md = read("markdown/Markdown.tsx")
  for (const token of ["markdownText", "markdownHeading", "markdownLink", "markdownCode", "markdownBlockQuote", "markdownHorizontalRule"]) {
    assert.ok(md.includes(token), `Markdown uses ${token}`)
  }
  // react-native-marked stays the renderer — only its style input changed.
  assert.ok(md.includes("react-native-marked"), "still wraps react-native-marked")
  assert.ok(md.includes("useMarkdown"), "still renders parsed blocks directly (issue #104)")
  const code = read("markdown/CodeBlock.tsx")
  for (const token of ["syntaxComment", "syntaxKeyword", "syntaxString", "syntaxNumber"]) {
    assert.ok(code.includes(token) || read("../lib/opencode-theme.ts").includes(token), `syntax ${token} wired`)
  }
  assert.ok(code.includes("highlightLine"), "CodeBlock highlights via the syntax tokenizer")
})

test("prompts and status match the transcript, not the device scheme", () => {
  for (const rel of ["chat/PermissionPrompt.tsx", "chat/QuestionPrompt.tsx", "chat/StatusIndicator.tsx", "chat/ReasoningBlock.tsx"]) {
    const src = read(rel)
    assert.ok(src.includes("palette"), `${rel} paints from the theme palette`)
    assert.doesNotMatch(src, /borderRadius/, `${rel} has no rounded chrome`)
  }
  const permission = read("chat/PermissionPrompt.tsx")
  assert.ok(permission.includes('minHeight: 44'), "tap targets stay adequate")
})

test("role meaning is not color-only", () => {
  const bubble = read("chat/MessageBubble.tsx")
  assert.ok(bubble.includes("GUTTER_USER") && bubble.includes("GUTTER_ASSISTANT"), "text markers carry role")
  const question = read("chat/QuestionPrompt.tsx")
  assert.ok(question.includes("[x]") && question.includes("[ ]"), "selection has a text marker")
})
