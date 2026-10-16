// Shared TUI-transcript conventions for the chat surface. Pure (no React
// Native imports) so it stays runnable under plain `node --test`.
//
// Provenance (anomalyco/opencode, branch dev, packages/tui/src):
// - routes/session/message-parts.tsx: tool rows render as a fixed-width icon
//   gutter (INLINE_TOOL_ICON_WIDTH = 2) + label, args dimmed; reasoning gets
//   a left border in a decreased-background color with dimmed text.
// - routes/session/group-view.tsx: exploration/reasoning groups collapse to
//   one-line icon rows ("→"/"✱" running, "−"/"+" disclosure, "◈"
//   instructions) in text.muted, expanding to the full content beneath.
// - docs (opencode.ai/docs/themes): the 50-token theme schema this styling
//   consumes; docs/tui confirms the flat terminal-native transcript.

/** Left-gutter marker for user blocks (the TUI prompt marker). */
export const GUTTER_USER = ">"

/**
 * Left-gutter marker for assistant activity. U+25CF is in every device font
 * (Menlo, Roboto, San Francisco); the TUI's ⏺ (U+23FA) is not — it falls
 * back to tofu on Android — so the filled circle carries the same meaning
 * with guaranteed rendering.
 */
export const GUTTER_ASSISTANT = "●"

/** Monospace stack: OS-guaranteed families, no bundled font needed — iOS
 *  always ships Menlo, Android always resolves `monospace`. */
export const MONO_IOS = "Menlo"
export const MONO_ANDROID = "monospace"

export function monoFont(os: string): string {
  return os === "ios" ? MONO_IOS : MONO_ANDROID
}

/**
 * One-line dimmed arg summary for a tool header, TUI-style
 * (`toolName(<args>)`). Prefers human scalars (path/command/pattern/url/
 * description); falls back to compact JSON. Truncated — the full input stays
 * in the expandable detail.
 */
export function toolArgsSummary(input: unknown, max = 120): string {
  if (input === undefined || input === null) return ""
  if (typeof input === "string") return input.length > max ? `${input.slice(0, max)}…` : input
  if (typeof input !== "object") return String(input)
  const record = input as Record<string, unknown>
  const picks: string[] = []
  for (const key of ["command", "filePath", "pattern", "url", "description", "prompt"]) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) picks.push(value)
    if (picks.join(" ").length >= max) break
  }
  const text = picks.length > 0 ? picks.join(" ") : JSON.stringify(input)
  const flat = text.replace(/\s+/g, " ")
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
