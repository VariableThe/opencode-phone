// Pure helpers for the opencode v2 PTY WebSocket (GET /api/pty/{id}/connect).
// Reverse-engineered live against 2.0.29 and confirmed against its source
// (packages/core/src/pty/protocol.ts, packages/server/src/handlers/pty.ts):
//   - server -> client: raw UTF-8 terminal bytes, except ONE control frame —
//     a 0x00 byte followed by JSON `{"cursor":N}` — sent after replay on
//     attach so clients can resume with ?cursor=N later.
//   - client -> server: raw UTF-8 text written straight to the pty master.
//     Lines must end with CR (\r); a bare \n never executes.
//   - resize is NOT a socket frame: PUT /api/pty/{id} {size:{rows,cols}}.
//   - on shell exit the server sends WS close 1000 (empty reason); attaching
//     to an exited PTY closes with 4404 "session exited".
// No expo/* imports — unit-testable with plain `node --test`.

export const PTY_DEFAULT_COLS = 80
export const PTY_DEFAULT_ROWS = 24

export interface PtySize {
  cols: number
  rows: number
}

/** ws(s) URL for the connect socket. Throws on a non-http(s) base URL. */
export function ptyConnectUrl(baseUrl: string, id: string, cursor?: number): string {
  const normalized = baseUrl.replace(/\/+$/, "")
  const url = normalized.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    throw new Error(`PTY error: unsupported base URL "${baseUrl}"`)
  }
  const params = cursor !== undefined && cursor >= 0 ? `?cursor=${cursor}` : ""
  return `${url}/api/pty/${encodeURIComponent(id)}/connect${params}`
}

export type PtyFrame = { kind: "meta"; cursor: number } | { kind: "data"; text: string }

/**
 * Split one inbound socket message. A leading NUL byte marks the cursor
 * control frame (`\0{"cursor":N}`); everything else is terminal output.
 * Malformed control frames degrade to data (never dropped silently into a
 * broken terminal — xterm renders the bytes and the cursor stays put).
 */
export function parsePtyFrame(message: string): PtyFrame {
  if (message.charCodeAt(0) !== 0) return { kind: "data", text: message }
  try {
    const parsed: unknown = JSON.parse(message.slice(1))
    if (typeof parsed === "object" && parsed !== null && "cursor" in parsed) {
      const cursor = (parsed as { cursor: unknown }).cursor
      if (typeof cursor === "number" && Number.isSafeInteger(cursor) && cursor >= 0) {
        return { kind: "meta", cursor }
      }
    }
  } catch {
    // fall through to data
  }
  return { kind: "data", text: message }
}

/** REST body for the resize endpoint (PUT /api/pty/{id}). */
export function ptyResizeBody(size: PtySize): { size: PtySize } {
  return { size: { rows: size.rows, cols: size.cols } }
}

/** Close 4404 carries the server's reason: "session exited" vs "session not found". */
export function ptyGoneReason(reason: string): "exited" | "not-found" | null {
  if (reason === "session exited") return "exited"
  if (reason === "session not found") return "not-found"
  return null
}
