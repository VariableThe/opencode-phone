// Pure file-content helpers for the server file browser (app/browse.tsx).
// No React Native imports — unit-testable with plain `node --test`, same as
// path-utils.ts / file-roots.ts. Only `import type` (erased at runtime) is
// allowed here, because node type-stripping cannot resolve extensionless
// cross-imports.
import type { FileEntry } from "./sdk"

// v2 `GET /api/fs/read/*` answers `application/octet-stream` with no length
// prefix, so the client cannot know a file's size before downloading it. Cap
// the decoded bytes (download still completes — a 50 MB log stays a 50 MB
// download — but the UI never tries to render more than this) and cap the
// rendered characters separately so the ScrollView stays responsive.
export const FILE_READ_MAX_BYTES = 1_000_000
export const FILE_PREVIEW_MAX_CHARS = 100_000

// Builds the request suffix for v2 `GET /api/fs/read/<path>`. The path is
// part of the URL — `?path=` on this route 404s (live-verified on 2.0.29).
// Each segment is percent-encoded but `/` separators are kept literal: an
// absolute path `/a/b` becomes `/api/fs/read//a/b` (double slash), which is
// the form the server resolves correctly. A relative path resolves against
// the request's location scope, same as `fs/list`.
export function fsReadSuffix(path: string): string {
  const trimmed = path.trim()
  const encoded = trimmed
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `/api/fs/read/${encoded}`
}

// True when the leading bytes contain a NUL — the cheapest reliable binary
// signal (UTF-8 text never contains 0x00). Only the first `scan` bytes are
// inspected so a huge download isn't walked twice.
export function hasBinaryByte(bytes: Uint8Array, scan = 8_000): boolean {
  const end = Math.min(bytes.length, scan)
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

export interface Preview {
  text: string
  truncated: boolean
  totalChars: number
}

// Slices decoded text down to what the content view renders. Never throws,
// never returns more than FILE_PREVIEW_MAX_CHARS characters.
export function toPreview(full: string): Preview {
  if (full.length <= FILE_PREVIEW_MAX_CHARS) return { text: full, truncated: false, totalChars: full.length }
  return { text: full.slice(0, FILE_PREVIEW_MAX_CHARS), truncated: true, totalChars: full.length }
}

// Directories first, then case-insensitive alphabetical by name. Pure sort
// for the browser list — the server returns no ordering guarantee.
export function sortFileEntries<T extends Pick<FileEntry, "type" | "name">>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    const left = a.name.toLowerCase()
    const right = b.name.toLowerCase()
    if (left !== right) return left < right ? -1 : 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

// Defensive parse of a v1 `GET /file/content?path=` body. Upstream shape at
// v1.18.32 (packages/opencode/.../httpapi/groups/file.ts, `file.read`): the
// `LegacyContent` struct `{type: "text" | "binary", content, encoding?,
// mimeType?}`. Tolerates a bare-string body (some proxies unwrap it) and
// returns null for anything else so the caller can raise a truthful error
// instead of rendering garbage. Never verified against a live v1 server —
// only v2 `fs/read` is live-verified (see docs/v2-api-map.md).
export function parseV1FileContent(body: unknown): { text: string; binary: boolean } | null {
  if (typeof body === "string") return { text: body, binary: false }
  if (typeof body !== "object" || body === null) return null
  const o = body as Record<string, unknown>
  if (typeof o.content !== "string") return null
  if (o.type === "binary") return { text: "", binary: true }
  if (o.encoding === "base64") {
    try {
      const raw = atob(o.content)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), binary: false }
    } catch {
      return null
    }
  }
  return { text: o.content, binary: false }
}
