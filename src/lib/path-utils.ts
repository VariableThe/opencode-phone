// Pure absolute-path helpers for the server-filesystem browser.
// No React Native imports — unit-testable with node --test.
//
// Server working directories can be POSIX (/a/b) or Windows (C:\a\b, D:/a/b)
// since the mobile app can point at either kind of opencode server, so both
// separators are handled.

/** Remove trailing slashes/backslashes, keeping the input if that would empty it. */
export function stripTrailingSlash(dir: string): string {
  return dir.replace(/[\\/]+$/, "") || dir
}

function isRoot(trimmed: string): boolean {
  // POSIX root ("/", "//"), a bare backslash, or a Windows drive root ("C:").
  return /^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:$/.test(trimmed)
}

/**
 * Parent directory of an absolute path, or null when already at a
 * filesystem root (POSIX "/" or a Windows drive root like "C:\").
 */
export function parentOf(dir: string): string | null {
  const trimmed = stripTrailingSlash(dir)
  if (isRoot(trimmed)) return null
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  if (lastSlash < 0) return null
  const head = trimmed.slice(0, lastSlash)
  if (!head) return trimmed[0] === "\\" ? "\\" : "/" // reached posix root
  if (/^[a-zA-Z]:$/.test(head)) return `${head}\\` // reached a windows drive root
  return head
}

/** Last path segment, e.g. "/a/b/" -> "b", "C:\\proj" -> "proj". */
export function nameOf(dir: string): string {
  const trimmed = stripTrailingSlash(dir)
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) || trimmed : trimmed
}

/**
 * True for absolute paths the server can resolve: POSIX `/a/b` or Windows
 * `C:/a`, `C:\\a` (a lone `\\` UNC prefix normalizes to `/`, so it counts).
 * Relative paths, `.`/`..`, and empty input are not absolute.
 */
export function isAbsolutePath(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (!trimmed || trimmed === "." || trimmed === "..") return false
  if (trimmed.startsWith("/")) return true
  const drive = trimmed.match(/^[a-zA-Z]:([/\\]|$)/)
  return drive !== null && trimmed.length > 2
}

/**
 * Lexically normalize a path: unify `\` to `/`, resolve `.`/`..`, drop
 * duplicate and trailing slashes. `..` past the root clamps at the root
 * (never produces an empty climb). No filesystem access. Never throws.
 */
export function normalizeAbsolute(dir: string): string {
  const forward = dir.trim().replace(/\\/g, "/")
  const drive = forward.match(/^[a-zA-Z]:/)?.[0] ?? ""
  const rest = drive ? forward.slice(2) : forward
  const rooted = rest.startsWith("/")
  const out: string[] = []
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(part)
  }
  const joined = `${drive}${rooted ? "/" : ""}${out.join("/")}`
  return joined || (rooted ? "/" : drive || ".")
}

export type RootCheck = { ok: true; path: string } | { ok: false; reason: "outside-root" | "not-absolute" }

/**
 * Client-side traversal guard for the file browser: resolves `candidate`
 * against the configured browse `root` (the connection's defaultProjectDir).
 * Rejects non-absolute input and anything escaping the root, so a crafted
 * jump path or a `..` walk past the root shows a clear error instead of
 * browsing outside the configured tree. Null root means "no jail" — any
 * absolute path is accepted (used when the connection sets no default dir).
 * The server itself does NOT jail `..` (live-verified: listing /tmp from a
 * /home/... location returns `../../../tmp/...` entries), so this lexical
 * check is the only boundary — note it cannot see through symlinks.
 */
export function resolveWithinRoot(root: string | null, candidate: string): RootCheck {
  if (!isAbsolutePath(candidate)) return { ok: false, reason: "not-absolute" }
  const path = normalizeAbsolute(candidate)
  if (!root) return { ok: true, path }
  const base = normalizeAbsolute(root)
  if (path === base) return { ok: true, path }
  if (path.startsWith(base === "/" ? "/" : `${base}/`)) return { ok: true, path }
  return { ok: false, reason: "outside-root" }
}

export interface Breadcrumb {
  label: string
  path: string
}

/**
 * Tappable breadcrumb chain for an absolute path: `/a/b` ->
 * [{"/", "/"}, {"a", "/a"}, {"b", "/a/b"}]. Drive roots label as `C:/`.
 */
export function breadcrumbSegments(dir: string): Breadcrumb[] {
  const normalized = normalizeAbsolute(dir)
  const drive = normalized.match(/^[a-zA-Z]:/)?.[0] ?? ""
  const rest = drive ? normalized.slice(2) : normalized
  const rootPath = drive ? `${drive}/` : "/"
  const crumbs: Breadcrumb[] = [{ label: rootPath, path: rootPath }]
  let acc = drive ? `${drive}` : ""
  for (const part of rest.split("/").filter(Boolean)) {
    acc += `/${part}`
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}
