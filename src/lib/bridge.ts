// Typed REST client for the oc-phone-bridge sidecar (tmux sessions, pane
// preview, health). No sibling runtime imports — unit-testable with plain
// `node --test`, same pattern as headers.ts / analytics-classify.ts (only
// `import type` is erased, so even that is avoided here).
//
// The bridge lives in a DIFFERENT repo (oc-phone-bridge) — this file only
// speaks its HTTP contract: Bearer auth on every route, JSON errors shaped
// {error, code}, tail capped at 2000 lines.
//
// Error shapes deliberately mirror api-error.ts / sdk.ts: BridgeAuthError
// plays the ApiAuthError role (401/403 = bad token, don't retry blindly)
// and BridgeError the ApiError role (carries `status`). They are separate
// classes only because a runtime import of "./api-error" (extensionless,
// as Metro requires) cannot resolve under plain node --test.

export interface BridgeConfig {
  baseUrl: string
  token: string
}

export interface BridgeHealth {
  ok: boolean
  version: string
  tmux: string
}

export interface BridgeSession {
  name: string
  created: number | null
  // Added by the bridge in parallel with this client — always read
  // defensively (optional). Absent means "unknown", never "not opencode".
  paneCommand?: string | null
  isOpencode?: boolean
}

export interface BridgeCreateInput {
  name: string
  dir?: string
  cmd?: string
}

export interface BridgeTail {
  name: string
  lines: number
  output: string
}

export const BRIDGE_REQUEST_TIMEOUT_MS = 30_000
export const BRIDGE_MAX_TAIL_LINES = 2000
export const BRIDGE_DEFAULT_TAIL_LINES = 200

/**
 * Thrown on any non-2xx bridge response. Mirrors sdk.ts's ApiError:
 * carries the HTTP status so callers can distinguish 404 (no such
 * session) from 5xx without parsing the message string.
 */
export class BridgeError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`Bridge error: ${status} - ${body}`)
    this.name = "BridgeError"
    this.status = status
  }
}

/**
 * Thrown on 401/403 — the bridge token is wrong. Mirrors ApiAuthError:
 * a credential problem, not a transient failure, so callers must not
 * retry it in a loop.
 */
export class BridgeAuthError extends BridgeError {
  constructor(status: number, body: string) {
    super(status, body)
    this.name = "BridgeAuthError"
  }
}

/** True for statuses that mean "your bridge token is wrong". */
export function isBridgeAuthStatus(status: number): boolean {
  return status === 401 || status === 403
}

/** Build the right error type for a failed bridge response. */
export function bridgeErrorFor(status: number, body: string): BridgeError {
  return isBridgeAuthStatus(status) ? new BridgeAuthError(status, body) : new BridgeError(status, body)
}

/** Type guard for call sites that need to branch on a bad bridge token. */
export function isBridgeAuthError(error: unknown): error is BridgeAuthError {
  return error instanceof BridgeAuthError
}

/** Join a bridge base URL and a path without producing double slashes. */
export function buildBridgeUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "")
  const clean = path.startsWith("/") ? path : `/${path}`
  return `${base}${clean}`
}

/** Every bridge route (including /health) requires Bearer auth. */
export function bridgeAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Validate one raw session entry from GET /tmux. Returns null for malformed
 * entries (caller drops them) instead of throwing, so one bad row never
 * blanks the whole list. `isOpencode`/`paneCommand` are optional: a bridge
 * that predates those fields yields a session without them.
 */
export function normalizeBridgeSession(raw: unknown): BridgeSession | null {
  if (!isRecord(raw)) return null
  if (typeof raw.name !== "string" || raw.name.length === 0) return null
  const session: BridgeSession = {
    name: raw.name,
    created: typeof raw.created === "number" && Number.isFinite(raw.created) ? raw.created : null,
  }
  if (raw.paneCommand === null || typeof raw.paneCommand === "string") session.paneCommand = raw.paneCommand
  if (typeof raw.isOpencode === "boolean") session.isOpencode = raw.isOpencode
  return session
}

/** Non-array payloads (including null) normalize to an empty list. */
export function normalizeBridgeSessionList(raw: unknown): BridgeSession[] {
  if (!Array.isArray(raw)) return []
  const out: BridgeSession[] = []
  for (const item of raw) {
    const session = normalizeBridgeSession(item)
    if (session) out.push(session)
  }
  return out
}

export type BridgeFetch = (url: string, init?: RequestInit) => Promise<Response>

async function fetchWithTimeout(
  fetchFn: BridgeFetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = BRIDGE_REQUEST_TIMEOUT_MS,
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
  throw bridgeErrorFor(response.status, body)
}

export function createBridgeClient(config: BridgeConfig, fetchFn: BridgeFetch = fetch, timeoutMs?: number) {
  const base = config.baseUrl.replace(/\/+$/, "")
  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...bridgeAuthHeaders(config.token),
  })
  const get = async (path: string): Promise<Response> => {
    const response = await fetchWithTimeout(fetchFn, `${base}${path}`, { headers: headers() }, timeoutMs)
    if (!response.ok) await throwForStatus(response)
    return response as Response
  }

  return {
    health: async (): Promise<BridgeHealth> => {
      const response = await get("/health")
      const raw: unknown = await response.json()
      if (!isRecord(raw)) throw new Error("Bridge error: malformed /health response")
      return {
        ok: raw.ok === true,
        version: typeof raw.version === "string" ? raw.version : "unknown",
        tmux: typeof raw.tmux === "string" ? raw.tmux : "unavailable",
      }
    },

    list: async (): Promise<BridgeSession[]> => {
      const response = await get("/tmux")
      const raw: unknown = await response.json()
      if (!isRecord(raw)) throw new Error("Bridge error: malformed /tmux response")
      return normalizeBridgeSessionList(raw.sessions)
    },

    create: async (input: BridgeCreateInput): Promise<string> => {
      const body: Record<string, string> = { name: input.name }
      if (input.dir) body.dir = input.dir
      if (input.cmd) body.cmd = input.cmd
      const response = await fetchWithTimeout(
        fetchFn,
        `${base}/tmux`,
        { method: "POST", headers: headers(), body: JSON.stringify(body) },
        timeoutMs,
      )
      if (!response.ok) await throwForStatus(response)
      const raw: unknown = await response.json()
      if (!isRecord(raw) || typeof raw.name !== "string") throw new Error("Bridge error: malformed POST /tmux response")
      return raw.name
    },

    kill: async (name: string): Promise<string> => {
      const response = await fetchWithTimeout(
        fetchFn,
        `${base}/tmux/${encodeURIComponent(name)}`,
        { method: "DELETE", headers: headers() },
        timeoutMs,
      )
      if (!response.ok) await throwForStatus(response)
      const raw: unknown = await response.json()
      if (!isRecord(raw) || typeof raw.name !== "string")
        throw new Error("Bridge error: malformed DELETE /tmux response")
      return raw.name
    },

    tail: async (name: string, lines: number = BRIDGE_DEFAULT_TAIL_LINES): Promise<BridgeTail> => {
      if (!Number.isInteger(lines) || lines < 1 || lines > BRIDGE_MAX_TAIL_LINES) {
        throw new RangeError(`lines must be an integer 1-${BRIDGE_MAX_TAIL_LINES}, got ${String(lines)}`)
      }
      const response = await get(`/tmux/${encodeURIComponent(name)}/tail?lines=${lines}`)
      // The bridge returns {name, lines, output} JSON; accept a bare-text
      // body too so a future plain-text variant doesn't break preview.
      const text = await response.text()
      try {
        const raw: unknown = JSON.parse(text)
        if (isRecord(raw) && typeof raw.output === "string") {
          return {
            name: typeof raw.name === "string" ? raw.name : name,
            lines: typeof raw.lines === "number" ? raw.lines : lines,
            output: raw.output,
          }
        }
      } catch {
        // Not JSON — fall through to plain-text handling below.
      }
      return { name, lines, output: text }
    },
  }
}

export type BridgeClient = ReturnType<typeof createBridgeClient>
