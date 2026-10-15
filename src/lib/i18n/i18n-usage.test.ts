// Every translation key the UI can render must exist in BOTH catalogues.
//
// catalog-parity.test.ts only checks en<->zh key-set equality, so a key the
// code calls but neither catalogue defines passes parity while rendering as
// a raw key path at runtime (settings ntfy/inapp/appearance, browse,
// qrScan, terminal, terminals, session queue/alerts — all shipped silent).
// This test closes that blind spot with a static scan of app/** + src/**:
// any t("literal") first argument, any dotted literal inside a t(...) call
// (ternary branches like t(ok ? "a" : "b")), labelKey/descriptionKey fields,
// *_LABEL_KEY lookup maps, and the template-built qrScan.errors.<code> family
// must resolve to a translated string in both catalogues.
//
// Run with plain `node --test` — node:fs only, no RN/expo imports (same
// constraint as catalog-parity.test.ts). Scanned files exclude *.test.*
// (unit tests name SSE event types like "session.created" that are not i18n
// keys) and *.generated.* (vendored bundles).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import en from "./en.json" with { type: "json" }
import zhHans from "./zh-Hans.json" with { type: "json" }

const HERE = dirname(new URL(import.meta.url).pathname)
const ROOT = join(HERE, "..", "..", "..")
const DIRS = [join(ROOT, "app"), join(ROOT, "src")]

type Catalog = Record<string, unknown>

function leaves(obj: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (typeof obj !== "object" || obj === null) {
    if (prefix) out.add(prefix)
    return out
  }
  for (const [key, value] of Object.entries(obj as Catalog)) {
    leaves(value, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

// Strip // and /* */ comments without touching string contents.
function stripComments(src: string): string {
  let out = ""
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      out += c
      if (c === "\\") {
        out += src[i + 1] ?? ""
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      out += c
      i++
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

const DOTTED = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9_-]+)+$/

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(path, out)
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".generated.")
    ) {
      out.push(path)
    }
  }
  return out
}

// Balanced t(...) spans; yields every dotted quoted literal inside each span
// (first argument + ternary branches + options-embedded keys).
function keysInTCalls(src: string): string[] {
  const found: string[] = []
  const literal = /["']([^"']+)["']/g
  let idx = src.indexOf("t(")
  while (idx !== -1) {
    // Skip identifiers merely ending in t, e.g. Test( / format(.
    const before = idx > 0 ? src[idx - 1] : ""
    if (/[A-Za-z0-9_$]/.test(before)) {
      idx = src.indexOf("t(", idx + 2)
      continue
    }
    let depth = 0
    let i = idx + 1
    let quote: string | null = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (quote) {
        if (c === "\\") {
          i++
          continue
        }
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c
        continue
      }
      if (c === "(") depth++
      else if (c === ")") {
        depth--
        if (depth === 0) break
      }
    }
    const span = src.slice(idx, i + 1)
    literal.lastIndex = 0
    for (const m of span.matchAll(literal)) {
      if (DOTTED.test(m[1])) found.push(m[1])
    }
    idx = src.indexOf("t(", idx + 2)
  }
  return found
}

// labelKey: "..." / descriptionKey: "..." indirection (notifications.ts,
// connection edit/type options) resolved via t(key) at render time.
function keysInKeyFields(src: string): string[] {
  const found: string[] = []
  for (const m of src.matchAll(/(?:labelKey|descriptionKey)\s*:\s*["']([^"']+)["']/g)) {
    if (DOTTED.test(m[1])) found.push(m[1])
  }
  return found
}

// const FOO_LABEL_KEY = { a: "ns.path", ... } indirection resolved via
// t(MAP[status]) at render time (connections list reachability).
function keysInLabelMaps(src: string): string[] {
  const found: string[] = []
  for (const m of src.matchAll(/_LABEL_KEY[^=]*=\s*\{([^}]*)\}/g)) {
    for (const lit of m[1].matchAll(/["']([^"']+)["']/g)) {
      if (DOTTED.test(lit[1])) found.push(lit[1])
    }
  }
  return found
}

// Template-built t(`qrScan.errors.${code}`) in app/connection/scan.tsx, where
// code ranges over the ConnectLinkErrorCode union in src/lib/connect-link.ts.
function errorCodeKeys(): string[] {
  const src = readFileSync(join(ROOT, "src", "lib", "connect-link.ts"), "utf8")
  const union = src.match(/export type ConnectLinkErrorCode\s*=\s*((?:[^;])+);/)
  assert.ok(union, "ConnectLinkErrorCode union not found in connect-link.ts")
  const codes = [...union[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  assert.ok(codes.length > 0, "no error codes parsed from ConnectLinkErrorCode")
  return codes.map((code) => `qrScan.errors.${code}`)
}

test("every statically used translation key exists in both catalogues", () => {
  const enKeys = leaves(en)
  const zhKeys = leaves(zhHans)
  const used = new Map<string, string>()
  const record = (file: string, key: string) => {
    if (!used.has(key)) used.set(key, file)
  }

  for (const dir of DIRS) {
    for (const file of collectFiles(dir)) {
      const raw = readFileSync(file, "utf8")
      const src = stripComments(raw)
      const rel = file.slice(ROOT.length + 1)
      for (const key of keysInTCalls(src)) record(rel, key)
      for (const key of keysInKeyFields(src)) record(rel, key)
      for (const key of keysInLabelMaps(src)) record(rel, key)
    }
  }
  for (const key of errorCodeKeys()) record("src/lib/connect-link.ts (ConnectLinkErrorCode)", key)

  assert.ok(used.size > 400, `scan looks broken: only ${used.size} keys found`)
  const missingFromEn = [...used.keys()].filter((k) => !enKeys.has(k)).sort()
  const missingFromZh = [...used.keys()].filter((k) => !zhKeys.has(k)).sort()
  const where = (k: string) => used.get(k)
  assert.deepEqual(
    missingFromEn,
    [],
    `keys used in code but missing from en.json: ${missingFromEn.map((k) => `${k} (${where(k)})`).join(", ")}`,
  )
  assert.deepEqual(
    missingFromZh,
    [],
    `keys used in code but missing from zh-Hans.json: ${missingFromZh.map((k) => `${k} (${where(k)})`).join(", ")}`,
  )
})
