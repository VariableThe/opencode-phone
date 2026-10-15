import { test } from "node:test"
import assert from "node:assert/strict"
import {
  defaultPalette,
  extractThemeTokens,
  isHexColor,
  mapToPalette,
  parseThemeJson,
  resolveAppPalette,
  resolveThemeColor,
} from "./opencode-theme.ts"

// The mapper turns an opencode theme document (bridge GET /theme {name,
// json}) into the app palette. A wrong mapping either crashes on hostile
// input (malformed JSON, cycles in defs) or silently mispaints — so parsing,
// defs indirection, per-token fallback, and the active/inactive signal are
// all pinned.

const VALID_DARK = {
  $schema: "https://opencode.ai/theme.json",
  defs: { ink: "#1a1b26", paper: "#c8d3f5", brand: "#82aaff" },
  theme: {
    background: { dark: "ink", light: "#ffffff" },
    text: { dark: "paper", light: "#111111" },
    primary: { dark: "#82aaff", light: "#2e7de9" },
  },
}

test("parseThemeJson: parses an object document", () => {
  assert.deepEqual(parseThemeJson(JSON.stringify(VALID_DARK)), VALID_DARK)
})

test("parseThemeJson: null for malformed JSON, arrays, scalars", () => {
  assert.equal(parseThemeJson("{nope"), null)
  assert.equal(parseThemeJson(""), null)
  assert.equal(parseThemeJson("[1,2]"), null)
  assert.equal(parseThemeJson("42"), null)
  assert.equal(parseThemeJson("null"), null)
})

test("extractThemeTokens: unwraps the documented {theme, defs} shape", () => {
  const out = extractThemeTokens(VALID_DARK)
  assert.ok(out)
  assert.deepEqual(out.defs, VALID_DARK.defs)
  assert.deepEqual(Object.keys(out.tokens).sort(), ["background", "primary", "text"])
})

test("extractThemeTokens: accepts a bare token map", () => {
  const out = extractThemeTokens({ primary: "#ff0000" })
  assert.ok(out)
  assert.deepEqual(out.defs, {})
})

test("extractThemeTokens: null for empty object and non-objects", () => {
  assert.equal(extractThemeTokens({}), null)
  assert.equal(extractThemeTokens({ $schema: "x" }), null)
  assert.equal(extractThemeTokens(null), null)
  assert.equal(extractThemeTokens("tokyonight"), null)
  assert.equal(extractThemeTokens(42), null)
})

test("isHexColor: accepts 3/4/6/8-digit hex, rejects the rest", () => {
  assert.equal(isHexColor("#fff"), true)
  assert.equal(isHexColor("#1a1b26"), true)
  assert.equal(isHexColor("#ffffffff"), true)
  assert.equal(isHexColor("ink"), false)
  assert.equal(isHexColor("#gggggg"), false)
  assert.equal(isHexColor("none"), false)
  assert.equal(isHexColor(3), false)
  assert.equal(isHexColor(null), false)
})

test("resolveThemeColor: follows {dark,light} variants per mode", () => {
  assert.equal(resolveThemeColor({ dark: "#111111", light: "#eeeeee" }, {}, "dark"), "#111111")
  assert.equal(resolveThemeColor({ dark: "#111111", light: "#eeeeee" }, {}, "light"), "#eeeeee")
})

test("resolveThemeColor: resolves defs indirection (incl. chained)", () => {
  const defs = { a: "b", b: "#123456" }
  assert.equal(resolveThemeColor("a", defs, "dark"), "#123456")
  assert.equal(resolveThemeColor({ dark: "a", light: "#fff" }, defs, "dark"), "#123456")
})

test("resolveThemeColor: null for missing refs, cycles, none, ANSI, variants without the mode", () => {
  assert.equal(resolveThemeColor("missing", {}, "dark"), null)
  assert.equal(resolveThemeColor("a", { a: "a" }, "dark"), null)
  assert.equal(resolveThemeColor("none", {}, "dark"), null)
  assert.equal(resolveThemeColor("transparent", {}, "dark"), null)
  assert.equal(resolveThemeColor(3, {}, "dark"), null)
  assert.equal(resolveThemeColor({ light: "#fff" }, {}, "dark"), null)
  assert.equal(resolveThemeColor(null, {}, "dark"), null)
})

test("mapToPalette: valid theme overrides its tokens, keeps defaults for the rest", () => {
  const palette = mapToPalette(VALID_DARK, "dark")
  assert.equal(palette.background, "#1a1b26")
  assert.equal(palette.text, "#c8d3f5")
  assert.equal(palette.primary, "#82aaff")
  assert.equal(palette.border, defaultPalette("dark").border)
  const light = mapToPalette(VALID_DARK, "light")
  assert.equal(light.background, "#ffffff")
  assert.equal(light.text, "#111111")
})

test("mapToPalette: missing tokens fall back per-token, empty/malformed input yields defaults", () => {
  assert.deepEqual(mapToPalette({ theme: {} }, "dark"), defaultPalette("dark"))
  assert.deepEqual(mapToPalette({}, "dark"), defaultPalette("dark"))
  assert.deepEqual(mapToPalette(null, "dark"), defaultPalette("dark"))
  assert.deepEqual(mapToPalette({ theme: { background: "none", text: 3 } }, "dark"), defaultPalette("dark"))
})

test("resolveAppPalette: inactive when toggle off, theme absent, or zero tokens resolve", () => {
  const off = resolveAppPalette({ matchEnabled: false, mode: "dark", themeRaw: VALID_DARK })
  assert.equal(off.active, false)
  assert.deepEqual(off.palette, defaultPalette("dark"))
  const absent = resolveAppPalette({ matchEnabled: true, mode: "dark", themeRaw: null })
  assert.equal(absent.active, false)
  const zero = resolveAppPalette({ matchEnabled: true, mode: "dark", themeRaw: { theme: { border: "none" } } })
  assert.equal(zero.active, false)
  assert.deepEqual(zero.palette, defaultPalette("dark"))
})

test("resolveAppPalette: active with mapped tokens when toggle on and theme resolves", () => {
  const out = resolveAppPalette({ matchEnabled: true, mode: "dark", themeRaw: VALID_DARK })
  assert.equal(out.active, true)
  assert.equal(out.palette.background, "#1a1b26")
  assert.equal(out.palette.border, defaultPalette("dark").border)
})
