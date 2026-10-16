// Typed client + pure shapes for the opencode v2 server's native PTY API
// (GET/POST /api/pty, GET/DELETE /api/pty/{id}). No sibling runtime imports
// and no expo/* — unit-testable with plain `node --test`, same pattern as
// bridge.ts / headers.ts (only `import type` is erased, so even that is
// avoided here and every helper is self-contained).
//
// Verified against a live opencode 2.0.29 server:
//   GET  /api/pty     -> {location, data: [{id, title, command, args, cwd, status, pid}]}
//   POST /api/pty     -> {location, data: {...}} and creates a real shell
//   GET  /api/pty/{id} -> the record; DELETE /api/pty/{id} -> 204 (no body)
// There is NO connect-token route on 2.0.29 — the interactive socket is
// GET /api/pty/{id}/connect upgraded to WebSocket, which is deliberately NOT
// implemented here (follow-up renderer task's job).
//
// Error shapes deliberately mirror api-error.ts / sdk.ts: PtyAuthError plays
// the ApiAuthError role (401/403 = bad credentials, don't retry blindly) and
// PtyError the ApiError role (carries `status`). They are separate classes
// only because a runtime import of "./api-error" (extensionless, as Metro
// requires) cannot resolve under plain node --test.

export const PTY_REQUEST_TIMEOUT_MS = 30_000

export type PtyStatus = "running" | "exited" | string

export interface PtyRecord {
  id: string
  title?: string
  command?: string
  args?: string[]
  cwd?: string
  status?: PtyStatus
  pid?: number
  exitCode?: number
}

export interface PtyCreateInput {
  title?: string
  command?: string
  args?: string[]
  cwd?: string
}

export interface PtySize {
  rows: number
  cols: number
}

// Mirrors the server's UpdateInput (PUT /api/pty/{id}): title and/or viewport
// size. Size MUST nest under `size` — flat {cols, rows} answers 200 but is
// silently ignored (verified live: stty size never moves).
export interface PtyUpdateInput {
  title?: string
  size?: PtySize
}

export interface PtyConfig {
  baseUrl: string
  headers?: Record<string, string>
}

/**
 * Thrown on any non-2xx PTY response. Mirrors sdk.ts's ApiError: carries
 * the HTTP status so callers can distinguish 404 (no such PTY) from 5xx
 * without parsing the message string.
 */
export class PtyError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`PTY error: ${status} - ${body}`)
    this.name = "PtyError"
    this.status = status
  }
}

/**
 * Thrown on 401/403 — the server credentials are wrong. Mirrors
 * ApiAuthError: a credential problem, not a transient failure, so callers
 * must not retry it in a loop.
 */
export class PtyAuthError extends PtyError {
  constructor(status: number, body: string) {
    super(status, body)
    this.name = "PtyAuthError"
  }
}

/** True for statuses that mean "your server credentials are wrong". */
export function isPtyAuthStatus(status: number): boolean {
  return status === 401 || status === 403
}

/** Build the right error type for a failed PTY response. */
export function ptyErrorFor(status: number, body: string): PtyError {
  return isPtyAuthStatus(status) ? new PtyAuthError(status, body) : new PtyError(status, body)
}

/** Type guard for call sites that need to branch on bad credentials. */
export function isPtyAuthError(error: unknown): error is PtyAuthError {
  return error instanceof PtyAuthError
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Validate one raw PTY entry. Only `id` is required — every other field is
 * read defensively (optional), so a server that adds, renames, or drops a
 * field never blanks the whole list. Returns null for malformed entries
 * (caller drops them) instead of throwing.
 */
export function normalizePtyRecord(raw: unknown): PtyRecord | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== "string" || raw.id.length === 0) return null
  const record: PtyRecord = { id: raw.id }
  if (typeof raw.title === "string") record.title = raw.title
  if (typeof raw.command === "string") record.command = raw.command
  if (Array.isArray(raw.args) && raw.args.every((a): a is string => typeof a === "string")) record.args = raw.args
  if (typeof raw.cwd === "string") record.cwd = raw.cwd
  if (typeof raw.status === "string") record.status = raw.status
  if (typeof raw.pid === "number" && Number.isFinite(raw.pid)) record.pid = raw.pid
  if (typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode)) record.exitCode = raw.exitCode
  return record
}

/** Non-array payloads (including null) normalize to an empty list. */
export function normalizePtyList(raw: unknown): PtyRecord[] {
  if (!Array.isArray(raw)) return []
  const out: PtyRecord[] = []
  for (const item of raw) {
    const record = normalizePtyRecord(item)
    if (record) out.push(record)
  }
  return out
}

/**
 * Unwrap the `{location, data}` envelope every PTY route answers with.
 * Throws (never returns a partial shape) when `data` is missing or the
 * wrong type, so callers fail loudly instead of rendering stale state.
 */
export function unwrapPtyData(raw: unknown, what: string): unknown {
  if (!isRecord(raw)) throw new Error(`PTY error: malformed ${what} response`)
  if (!("data" in raw)) throw new Error(`PTY error: malformed ${what} response (missing data)`)
  return raw.data
}

export type PtyFetch = (url: string, init?: RequestInit) => Promise<Response>

async function fetchWithTimeout(
  fetchFn: PtyFetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = PTY_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new Error(`Request timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function throwForStatus(response: Response): Promise<never> {
  const body = await response.text().catch(() => "")
  throw ptyErrorFor(response.status, body)
}

export function createPtyClient(config: PtyConfig, fetchFn: PtyFetch = fetch, timeoutMs?: number) {
  const base = config.baseUrl.replace(/\/+$/, "")
  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  })

  return {
    list: async (): Promise<PtyRecord[]> => {
      const response = await fetchWithTimeout(fetchFn, `${base}/api/pty`, { headers: headers() }, timeoutMs)
      if (!response.ok) await throwForStatus(response)
      const raw: unknown = await response.json()
      return normalizePtyList(unwrapPtyData(raw, "GET /api/pty"))
    },

    get: async (id: string): Promise<PtyRecord> => {
      const response = await fetchWithTimeout(
        fetchFn,
        `${base}/api/pty/${encodeURIComponent(id)}`,
        { headers: headers() },
        timeoutMs,
      )
      if (!response.ok) await throwForStatus(response)
      const raw: unknown = await response.json()
      const record = normalizePtyRecord(unwrapPtyData(raw, `GET /api/pty/${id}`))
      if (!record) throw new Error(`PTY error: malformed GET /api/pty/${id} response`)
      return record
    },

    create: async (input: PtyCreateInput = {}): Promise<PtyRecord> => {
      const body: Record<string, unknown> = {}
      if (input.title) body.title = input.title
      if (input.command) body.command = input.command
      if (input.args) body.args = input.args
      if (input.cwd) body.cwd = input.cwd
      const response = await fetchWithTimeout(
        fetchFn,
        `${base}/api/pty`,
        { method: "POST", headers: headers(), body: JSON.stringify(body) },
        timeoutMs,
      )
      if (!response.ok) await throwForStatus(response)
      const raw: unknown = await response.json()
      const record = normalizePtyRecord(unwrapPtyData(raw, "POST /api/pty"))
      if (!record) throw new Error("PTY error: malformed POST /api/pty response")
      return record
    },

    // DELETE answers 204 with no body — resolve on any 2xx without parsing.
    remove: async (id: string): Promise<void> => {
      const response = await fetchWithTimeout(
        fetchFn,
        `${base}/api/pty/${encodeURIComponent(id)}`,
        { method: "DELETE", headers: headers() },
        timeoutMs,
      )
      if (!response.ok) await throwForStatus(response)
    },

    // PUT answers the {location, data} envelope with the updated record.
    update: async (id: string, input: PtyUpdateInput): Promise<PtyRecord> => {
      const body: Record<string, unknown> = {}
      if (input.title !== undefined) body.title = input.title
      if (input.size) body.size = { rows: input.size.rows, cols: input.size.cols }
      const response = await fetchWithTimeout(
        fetchFn,
        `${base}/api/pty/${encodeURIComponent(id)}`,
        { method: "PUT", headers: headers(), body: JSON.stringify(body) },
        timeoutMs,
      )
      if (!response.ok) await throwForStatus(response)
      const raw: unknown = await response.json()
      const record = normalizePtyRecord(unwrapPtyData(raw, `PUT /api/pty/${id}`))
      if (!record) throw new Error(`PTY error: malformed PUT /api/pty/${id} response`)
      return record
    },
  }
}

export type PtyClient = ReturnType<typeof createPtyClient>
