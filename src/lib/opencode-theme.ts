// Pure parser/mapper: opencode theme JSON -> normalized tokens -> app palette.
//
// Zero runtime imports (not even `import type`) so this stays runnable under
// plain `node --test`, same constraint as bridge.ts / pty.ts (Metro needs
// extensionless sibling imports, which node cannot resolve).
//
// Theme source: oc-phone-bridge GET /theme returns {name, json} where json is
// the file ~/.config/opencode/themes/<name>.json. Verified schema against the
// real tokyonight asset (anomalyco/opencode, packages/tui/src/theme/assets)
// and https://opencode.ai/docs/themes/:
//   { "$schema": ..., "defs": { darkStep1: "#1a1b26", ... },
//     "theme": { primary: { dark: "darkStep9", light: "lightStep9" }, ... } }
// Token values are either a {dark, light} variant, a hex literal, a `defs`
// key reference, "none"/"transparent", or an ANSI index (0-255, unmappable to
// hex without a table — treated as missing). All 50 real token names are
// listed in KNOWN_TOKENS; only the ones the app can use are mapped (see
// TOKEN_TO_PALETTE), the rest are deliberately ignored.

export type ThemeMode = "dark" | "light"

/** The subset of opencode tokens the app maps onto its own surfaces. */
export interface AppPalette {
  background: string
  panel: string
  element: string
  text: string
  muted: string
  border: string
  primary: string
  accent: string
  error: string
  warning: string
  success: string
  info: string
  diffAdded: string
  diffRemoved: string
}

export const PALETTE_KEYS: ReadonlyArray<keyof AppPalette> = [
  "background",
  "panel",
  "element",
  "text",
  "muted",
  "border",
  "primary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "diffAdded",
  "diffRemoved",
]

// Every token present in the real tokyonight asset. Kept for documentation
// and so a future token can be wired up by adding one row to
// TOKEN_TO_PALETTE instead of guessing names.
export const KNOWN_TOKENS: ReadonlyArray<string> = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "text",
  "textMuted",
  "background",
  "backgroundPanel",
  "backgroundElement",
  "border",
  "borderActive",
  "borderSubtle",
  "diffAdded",
  "diffRemoved",
  "diffContext",
  "diffHunkHeader",
  "diffHighlightAdded",
  "diffHighlightRemoved",
  "diffAddedBg",
  "diffRemovedBg",
  "diffContextBg",
  "diffLineNumber",
  "diffAddedLineNumberBg",
  "diffRemovedLineNumberBg",
  "markdownText",
  "markdownHeading",
  "markdownLink",
  "markdownLinkText",
  "markdownCode",
  "markdownBlockQuote",
  "markdownEmph",
  "markdownStrong",
  "markdownHorizontalRule",
  "markdownListItem",
  "markdownListEnumeration",
  "markdownImage",
  "markdownImageText",
  "markdownCodeBlock",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
]

// Ignored deliberately: borderActive/borderSubtle (one border is enough for
// the app's hairlines), secondary (no second accent surface), all diff*
// except diffAdded/diffRemoved (no diff UI), all markdown* (message bodies
// follow text/muted), all syntax* (no code-highlight UI outside xterm).
const TOKEN_TO_PALETTE: Readonly<Record<string, keyof AppPalette>> = {
  background: "background",
  backgroundPanel: "panel",
  backgroundElement: "element",
  text: "text",
  textMuted: "muted",
  border: "border",
  primary: "primary",
  accent: "accent",
  error: "error",
  warning: "warning",
  success: "success",
  info: "info",
  diffAdded: "diffAdded",
  diffRemoved: "diffRemoved",
}

// App's current hardcoded colors, per mode. When no server theme applies the
// palette equals these, so palette overrides at call sites are no-ops and
// nothing regresses.
const DEFAULT_DARK: AppPalette = {
  background: "#0a0a0a",
  panel: "#1a1a1a",
  element: "#2a2a2a",
  text: "#ffffff",
  muted: "#888888",
  border: "#2a2a2a",
  primary: "#ffffff",
  accent: "#8b5cf6",
  error: "#ef4444",
  warning: "#f59e0b",
  success: "#22c55e",
  info: "#7dd3fc",
  diffAdded: "#22c55e",
  diffRemoved: "#ef4444",
}

const DEFAULT_LIGHT: AppPalette = {
  background: "#ffffff",
  panel: "#f5f5f5",
  element: "#e5e5e5",
  text: "#0a0a0a",
  muted: "#666666",
  border: "#e5e5e5",
  primary: "#0a0a0a",
  accent: "#6d28d9",
  error: "#ef4444",
  warning: "#d97706",
  success: "#16a34a",
  info: "#0369a1",
  diffAdded: "#16a34a",
  diffRemoved: "#dc2626",
}

export function defaultPalette(mode: ThemeMode): AppPalette {
  return { ...(mode === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value)
}

// "none" (terminal default, per docs) and "transparent" carry no opaque color
// for the app to paint with — callers fall back to the default instead.
function isTransparent(value: unknown): boolean {
  return value === "none" || value === "transparent"
}

/** Parse raw theme file text. Returns null for malformed JSON (never throws). */
export function parseThemeJson(text: string): unknown {
  if (typeof text !== "string") return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface ThemeTokens {
  defs: Record<string, unknown>
  tokens: Record<string, unknown>
}

/**
 * Split a parsed theme document into reusable defs + token map. Accepts both
 * the documented shape ({theme: {...}, defs: {...}}) and a bare token map
 * ({primary: ..., background: ...}). Returns null for empty/unusable input.
 */
export function extractThemeTokens(raw: unknown): ThemeTokens | null {
  if (!isRecord(raw)) return null
  const defs = isRecord(raw.defs) ? (raw.defs as Record<string, unknown>) : {}
  const wrapped = raw.theme
  const tokens = isRecord(wrapped) ? (wrapped as Record<string, unknown>) : raw
  const names = Object.keys(tokens).filter((k) => k !== "$schema" && k !== "defs")
  if (names.length === 0) return null
  return { defs, tokens }
}

// Resolve one raw token value to a hex string for the given mode. Follows
// {dark,light} variants and defs references (cycle-guarded); ANSI indices,
// "none"/"transparent", and anything else resolve to null (caller falls back
// per-token to the app default).
export function resolveThemeColor(
  value: unknown,
  defs: Record<string, unknown>,
  mode: ThemeMode,
  depth = 0,
): string | null {
  if (depth > 10) return null
  if (isHexColor(value)) return value
  if (typeof value === "number" || isTransparent(value)) return null
  if (typeof value === "string") {
    const ref = defs[value]
    if (ref === undefined) return null
    return resolveThemeColor(ref, defs, mode, depth + 1)
  }
  if (isRecord(value)) {
    const variant = value[mode]
    if (variant === undefined) return null
    return resolveThemeColor(variant, defs, mode, depth + 1)
  }
  return null
}

/** Map a parsed theme document to the app palette; missing tokens fall back per-token. */
export function mapToPalette(raw: unknown, mode: ThemeMode): AppPalette {
  const palette = defaultPalette(mode)
  const extracted = extractThemeTokens(raw)
  if (!extracted) return palette
  for (const [token, key] of Object.entries(TOKEN_TO_PALETTE)) {
    const resolved = resolveThemeColor(extracted.tokens[token], extracted.defs, mode)
    if (resolved) palette[key] = resolved
  }
  return palette
}

export interface ResolvedAppTheme {
  palette: AppPalette
  /** True when a server theme actually contributed at least one token. */
  active: boolean
}

/**
 * Decide which palette the app paints with. A disabled toggle, an absent
 * theme, or a theme that resolves to zero tokens all yield the app defaults
 * (active: false) — the UI never blocks or throws on theme input.
 */
export function resolveAppPalette(options: {
  matchEnabled: boolean
  mode: ThemeMode
  themeRaw: unknown
}): ResolvedAppTheme {
  const fallback = defaultPalette(options.mode)
  if (!options.matchEnabled) return { palette: fallback, active: false }
  const extracted = extractThemeTokens(options.themeRaw)
  if (!extracted) return { palette: fallback, active: false }
  const palette = defaultPalette(options.mode)
  let hits = 0
  for (const [token, key] of Object.entries(TOKEN_TO_PALETTE)) {
    const resolved = resolveThemeColor(extracted.tokens[token], extracted.defs, options.mode)
    if (resolved) {
      palette[key] = resolved
      hits += 1
    }
  }
  if (hits === 0) return { palette: fallback, active: false }
  return { palette, active: true }
}
