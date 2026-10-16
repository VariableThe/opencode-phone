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
// listed in KNOWN_TOKENS and ALL of them are mapped (see TOKEN_TO_PALETTE):
// the chat surface renders TUI-style diffs, markdown, and highlighted code,
// so every diff*/markdown*/syntax* token has a consumer.
//
// Unthemed built-in defaults are derived from the opencode default theme
// (tokyonight): dark mode resolves the tokyonight dark variants, light mode
// the light variants. The TUI look is the default design for everyone; the
// server theme only repaints it when the toggle is on.

export type ThemeMode = "dark" | "light"

/**
 * The full opencode token set, mapped onto app surfaces. Legacy short names
 * (panel, element, text, muted, border) are kept so existing call sites keep
 * compiling; every other token maps to a same-name key.
 */
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
  borderActive: string
  borderSubtle: string
  secondary: string
  diffContext: string
  diffHunkHeader: string
  diffHighlightAdded: string
  diffHighlightRemoved: string
  diffAddedBg: string
  diffRemovedBg: string
  diffContextBg: string
  diffLineNumber: string
  diffAddedLineNumberBg: string
  diffRemovedLineNumberBg: string
  markdownText: string
  markdownHeading: string
  markdownLink: string
  markdownLinkText: string
  markdownCode: string
  markdownBlockQuote: string
  markdownEmph: string
  markdownStrong: string
  markdownHorizontalRule: string
  markdownListItem: string
  markdownListEnumeration: string
  markdownImage: string
  markdownImageText: string
  markdownCodeBlock: string
  syntaxComment: string
  syntaxKeyword: string
  syntaxFunction: string
  syntaxVariable: string
  syntaxString: string
  syntaxNumber: string
  syntaxType: string
  syntaxOperator: string
  syntaxPunctuation: string
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
  "borderActive",
  "borderSubtle",
  "secondary",
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

// Every token present in the real tokyonight asset.
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

// Full 1:1 token coverage. The six legacy renames map the TUI token name to
// the app's historic key; everything else keeps its token name.
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
  borderActive: "borderActive",
  borderSubtle: "borderSubtle",
  secondary: "secondary",
  diffContext: "diffContext",
  diffHunkHeader: "diffHunkHeader",
  diffHighlightAdded: "diffHighlightAdded",
  diffHighlightRemoved: "diffHighlightRemoved",
  diffAddedBg: "diffAddedBg",
  diffRemovedBg: "diffRemovedBg",
  diffContextBg: "diffContextBg",
  diffLineNumber: "diffLineNumber",
  diffAddedLineNumberBg: "diffAddedLineNumberBg",
  diffRemovedLineNumberBg: "diffRemovedLineNumberBg",
  markdownText: "markdownText",
  markdownHeading: "markdownHeading",
  markdownLink: "markdownLink",
  markdownLinkText: "markdownLinkText",
  markdownCode: "markdownCode",
  markdownBlockQuote: "markdownBlockQuote",
  markdownEmph: "markdownEmph",
  markdownStrong: "markdownStrong",
  markdownHorizontalRule: "markdownHorizontalRule",
  markdownListItem: "markdownListItem",
  markdownListEnumeration: "markdownListEnumeration",
  markdownImage: "markdownImage",
  markdownImageText: "markdownImageText",
  markdownCodeBlock: "markdownCodeBlock",
  syntaxComment: "syntaxComment",
  syntaxKeyword: "syntaxKeyword",
  syntaxFunction: "syntaxFunction",
  syntaxVariable: "syntaxVariable",
  syntaxString: "syntaxString",
  syntaxNumber: "syntaxNumber",
  syntaxType: "syntaxType",
  syntaxOperator: "syntaxOperator",
  syntaxPunctuation: "syntaxPunctuation",
}

// Built-in defaults = the opencode default theme (tokyonight) resolved per
// mode, so the unthemed app already looks TUI-native instead of device-scheme.
const DEFAULT_DARK: AppPalette = {
  background: "#1a1b26",
  panel: "#1e2030",
  element: "#222436",
  text: "#c8d3f5",
  muted: "#828bb8",
  border: "#737aa2",
  primary: "#82aaff",
  accent: "#ff966c",
  error: "#ff757f",
  warning: "#ff966c",
  success: "#c3e88d",
  info: "#82aaff",
  diffAdded: "#4fd6be",
  diffRemoved: "#c53b53",
  borderActive: "#9099b2",
  borderSubtle: "#545c7e",
  secondary: "#c099ff",
  diffContext: "#828bb8",
  diffHunkHeader: "#828bb8",
  diffHighlightAdded: "#b8db87",
  diffHighlightRemoved: "#e26a75",
  diffAddedBg: "#20303b",
  diffRemovedBg: "#37222c",
  diffContextBg: "#1e2030",
  diffLineNumber: "#8f909a",
  diffAddedLineNumberBg: "#1b2b34",
  diffRemovedLineNumberBg: "#2d1f26",
  markdownText: "#c8d3f5",
  markdownHeading: "#c099ff",
  markdownLink: "#82aaff",
  markdownLinkText: "#86e1fc",
  markdownCode: "#c3e88d",
  markdownBlockQuote: "#ffc777",
  markdownEmph: "#ffc777",
  markdownStrong: "#ff966c",
  markdownHorizontalRule: "#828bb8",
  markdownListItem: "#82aaff",
  markdownListEnumeration: "#86e1fc",
  markdownImage: "#82aaff",
  markdownImageText: "#86e1fc",
  markdownCodeBlock: "#c8d3f5",
  syntaxComment: "#828bb8",
  syntaxKeyword: "#c099ff",
  syntaxFunction: "#82aaff",
  syntaxVariable: "#ff757f",
  syntaxString: "#c3e88d",
  syntaxNumber: "#ff966c",
  syntaxType: "#ffc777",
  syntaxOperator: "#86e1fc",
  syntaxPunctuation: "#c8d3f5",
}

const DEFAULT_LIGHT: AppPalette = {
  background: "#e1e2e7",
  panel: "#d5d6db",
  element: "#c8c9ce",
  text: "#3760bf",
  muted: "#8990a3",
  border: "#737a8c",
  primary: "#2e7de9",
  accent: "#b15c00",
  error: "#f52a65",
  warning: "#b15c00",
  success: "#587539",
  info: "#2e7de9",
  diffAdded: "#1e725c",
  diffRemoved: "#c53b53",
  borderActive: "#5a607d",
  borderSubtle: "#9699a8",
  secondary: "#9854f1",
  diffContext: "#7086b5",
  diffHunkHeader: "#7086b5",
  diffHighlightAdded: "#4db380",
  diffHighlightRemoved: "#f52a65",
  diffAddedBg: "#d5e5d5",
  diffRemovedBg: "#f7d8db",
  diffContextBg: "#d5d6db",
  diffLineNumber: "#59595b",
  diffAddedLineNumberBg: "#c5d5c5",
  diffRemovedLineNumberBg: "#e7c8cb",
  markdownText: "#3760bf",
  markdownHeading: "#9854f1",
  markdownLink: "#2e7de9",
  markdownLinkText: "#007197",
  markdownCode: "#587539",
  markdownBlockQuote: "#8c6c3e",
  markdownEmph: "#8c6c3e",
  markdownStrong: "#b15c00",
  markdownHorizontalRule: "#8990a3",
  markdownListItem: "#2e7de9",
  markdownListEnumeration: "#007197",
  markdownImage: "#2e7de9",
  markdownImageText: "#007197",
  markdownCodeBlock: "#3760bf",
  syntaxComment: "#8990a3",
  syntaxKeyword: "#9854f1",
  syntaxFunction: "#2e7de9",
  syntaxVariable: "#f52a65",
  syntaxString: "#587539",
  syntaxNumber: "#b15c00",
  syntaxType: "#8c6c3e",
  syntaxOperator: "#007197",
  syntaxPunctuation: "#3760bf",
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

// --- Contrast guard ---------------------------------------------------------

function channelToLinear(value: number): number {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const clean = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7)
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

/** WCAG 2.1 relative-luminance contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  if (!isHexColor(a) || !isHexColor(b)) return 1
  const l1 = luminance(a)
  const l2 = luminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function mixHex(from: string, to: string, amount: number): string {
  const clean = (h: string) =>
    (h.length === 4 ? h.slice(1).split("").map((c) => c + c).join("") : h.slice(1, 7)).toLowerCase()
  const f = clean(from)
  const t = clean(to)
  const parts: string[] = []
  for (let i = 0; i < 3; i++) {
    const fv = parseInt(f.slice(i * 2, i * 2 + 2), 16)
    const tv = parseInt(t.slice(i * 2, i * 2 + 2), 16)
    parts.push(Math.round(fv + (tv - fv) * amount).toString(16).padStart(2, "0"))
  }
  return `#${parts.join("")}`
}

/**
 * Contrast rule: body-text roles must reach WCAG 2.1 AA (4.5:1) against the
 * surface they paint on. When a theme ships a failing pair, the foreground is
 * nudged toward whichever of black/white raises contrast (8% steps, max 25)
 * rather than shipping unreadable text. Returns the (possibly adjusted) fg.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (!isHexColor(fg) || !isHexColor(bg)) return fg
  if (contrastRatio(fg, bg) >= min) return fg
  const towardWhite = contrastRatio("#ffffff", bg)
  const towardBlack = contrastRatio("#000000", bg)
  const target = towardWhite >= towardBlack ? "#ffffff" : "#000000"
  let out = fg
  for (let i = 0; i < 25; i++) {
    out = mixHex(out, target, 0.08)
    if (contrastRatio(out, bg) >= min) return out
  }
  return out
}

// Text roles guarded per surface: body text on background + panel, muted on
// background. Decorative roles (borders, diff fills, syntax accents) are left
// alone — meaning there is never carried by their color (prefixes/markers do).
const CONTRAST_RULES: ReadonlyArray<{ fg: keyof AppPalette; bg: keyof AppPalette }> = [
  { fg: "text", bg: "background" },
  { fg: "muted", bg: "background" },
  { fg: "text", bg: "panel" },
  { fg: "markdownText", bg: "background" },
  { fg: "markdownCodeBlock", bg: "panel" },
]

function applyContrastGuard(palette: AppPalette): void {
  for (const rule of CONTRAST_RULES) {
    palette[rule.fg] = ensureContrast(palette[rule.fg], palette[rule.bg])
  }
}

/** Map a parsed theme document to the app palette; missing tokens fall back per-token. */
export function mapToPalette(raw: unknown, mode: ThemeMode): AppPalette {
  const palette = defaultPalette(mode)
  const extracted = extractThemeTokens(raw)
  if (!extracted) {
    applyContrastGuard(palette)
    return palette
  }
  for (const [token, key] of Object.entries(TOKEN_TO_PALETTE)) {
    const resolved = resolveThemeColor(extracted.tokens[token], extracted.defs, mode)
    if (resolved) palette[key] = resolved
  }
  applyContrastGuard(palette)
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
  applyContrastGuard(fallback)
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
  applyContrastGuard(palette)
  return { palette, active: true }
}

// --- Syntax colors for code highlighting -------------------------------------

/** Subset of syntax tokens CodeBlock highlights with. */
export interface SyntaxColors {
  comment: string
  keyword: string
  string: string
  number: string
  base: string
}

/** Syntax token colors in the order the highlighter applies them. */
export function syntaxColors(palette: AppPalette): SyntaxColors {
  return {
    comment: palette.syntaxComment,
    keyword: palette.syntaxKeyword,
    string: palette.syntaxString,
    number: palette.syntaxNumber,
    base: palette.markdownCodeBlock,
  }
}
