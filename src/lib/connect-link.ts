// Decode + validate the frozen v1 `ocphone://connect` QR payload produced by
// `oc-phone-qr` (contract source of truth: oc-phone-tools/README.md).
//
// Pure (no RN/expo deps, no Buffer/atob/TextDecoder globals) so it is
// unit-testable with plain `node --test` — same pattern as server-host.ts /
// bridge.ts. Base64url + UTF-8 are implemented by hand so the decoder behaves
// identically under node and Hermes.
//
// URI shape: ocphone://connect?v=1&d=<base64url(JSON, UTF-8, no padding)>
// JSON shape: {v:1, name, url, username, password?, bridgeUrl, bridgeToken?,
//   defaultProjectDir} — password/bridgeToken keys may be ABSENT entirely
//   (the `--no-secrets` variant); the caller then prompts the user for them.

export interface ConnectPayload {
  v: 1
  name: string
  url: string
  username: string
  password?: string
  bridgeUrl: string
  bridgeToken?: string
  defaultProjectDir: string
}

export type ConnectLinkErrorCode =
  | "empty"
  | "malformed-uri"
  | "scheme"
  | "host"
  | "version"
  | "missing-d"
  | "bad-encoding"
  | "bad-json"
  | "payload-version"
  | "missing-field"
  | "bad-field"
  | "bad-url"

export interface ConnectLinkError {
  code: ConnectLinkErrorCode
  // Which payload field failed, for missing-field / bad-field / bad-url.
  field?: string
  message: string
}

export type ConnectLinkResult = { ok: true; payload: ConnectPayload } | { ok: false; error: ConnectLinkError }

const B64URL_RE = /^[A-Za-z0-9_-]+$/
const REQUIRED_FIELDS = ["name", "url", "username", "bridgeUrl", "defaultProjectDir"] as const
const OPTIONAL_SECRET_FIELDS = ["password", "bridgeToken"] as const

function fail(code: ConnectLinkErrorCode, message: string, field?: string): ConnectLinkResult {
  return { ok: false, error: field === undefined ? { code, message } : { code, field, message } }
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function base64UrlDecodeBytes(input: string): number[] | null {
  if (!B64URL_RE.test(input)) return null
  const padded = input.replace(/-/g, "+").replace(/_/g, "/")
  const out: number[] = []
  let bits = 0
  let acc = 0
  for (const char of padded) {
    const val = B64_ALPHABET.indexOf(char)
    if (val < 0) return null
    acc = (acc << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return out
}

// Manual UTF-8 decode (no TextDecoder — unavailable on some Hermes builds).
function utf8Decode(bytes: number[]): string | null {
  const points: number[] = []
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    if (b0 < 0x80) {
      points.push(b0)
      i += 1
    } else if (b0 >= 0xc2 && b0 < 0xe0) {
      const b1 = bytes[i + 1]
      if (b1 === undefined || (b1 & 0xc0) !== 0x80) return null
      points.push(((b0 & 0x1f) << 6) | (b1 & 0x3f))
      i += 2
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i + 1]
      const b2 = bytes[i + 2]
      if (b1 === undefined || b2 === undefined || (b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return null
      points.push(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f))
      i += 3
    } else if (b0 >= 0xf0 && b0 < 0xf5) {
      const b1 = bytes[i + 1]
      const b2 = bytes[i + 2]
      const b3 = bytes[i + 3]
      if (
        b1 === undefined ||
        b2 === undefined ||
        b3 === undefined ||
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80
      )
        return null
      points.push(((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      i += 4
    } else {
      return null
    }
  }
  return String.fromCodePoint(...points)
}

function base64UrlDecodeUtf8(input: string): string | null {
  const bytes = base64UrlDecodeBytes(input)
  if (!bytes) return null
  return utf8Decode(bytes)
}

function utf8Encode(input: string): number[] {
  const bytes: number[] = []
  for (const code of input) {
    const point = code.codePointAt(0) as number
    if (point < 0x80) bytes.push(point)
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f))
    else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
  }
  return bytes
}

// Encoder exists for tests (and only tests) — the workstation tool owns
// production encoding. Key order matches the contract's documented order.
export function encodeConnectLink(payload: ConnectPayload): string {
  const ordered: Record<string, unknown> = {
    v: 1,
    name: payload.name,
    url: payload.url,
    username: payload.username,
  }
  if (payload.password !== undefined) ordered.password = payload.password
  ordered.bridgeUrl = payload.bridgeUrl
  if (payload.bridgeToken !== undefined) ordered.bridgeToken = payload.bridgeToken
  ordered.defaultProjectDir = payload.defaultProjectDir
  const bytes = utf8Encode(JSON.stringify(ordered))
  let bits = ""
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0")
  let raw = ""
  for (let i = 0; i < bits.length; i += 6) {
    const chunk = bits.slice(i, i + 6).padEnd(6, "0")
    raw += B64_ALPHABET[parseInt(chunk, 2)]
  }
  // base64url, no padding: the bit loop never emits "=" and "+"/"/" map over.
  const d = raw.replace(/\+/g, "-").replace(/\//g, "_")
  return `ocphone://connect?v=1&d=${d}`
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://")
}

export function parseConnectLink(input: string): ConnectLinkResult {
  const trimmed = input.trim()
  if (!trimmed) return fail("empty", "Enter an ocphone:// link first.")

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return fail("malformed-uri", "That is not a valid link — scan the QR again or paste the full ocphone:// link.")
  }

  if (parsed.protocol !== "ocphone:") return fail("scheme", `Wrong link type "${parsed.protocol}" — expected ocphone:// from the workstation QR.`)
  if (parsed.hostname !== "connect") return fail("host", `Wrong link target "${parsed.hostname}" — expected ocphone://connect.`)
  if (parsed.searchParams.get("v") !== "1") return fail("version", "Unsupported link version — update this app and regenerate the QR.")

  const d = parsed.searchParams.get("d")
  if (!d) return fail("missing-d", "This link carries no connection data (missing d) — regenerate the QR.")
  if (!B64URL_RE.test(d)) return fail("bad-encoding", "The link data is corrupted (d is not unpadded base64url) — scan again.")

  const json = base64UrlDecodeUtf8(d)
  if (json === null) return fail("bad-encoding", "The link data could not be decoded — scan again.")

  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    return fail("bad-json", "The link data is not valid JSON — regenerate the QR.")
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return fail("bad-json", "The link data is not a connection object — regenerate the QR.")
  }
  const record = obj as Record<string, unknown>
  if (record.v !== 1) return fail("payload-version", "Unsupported connection version — update this app and regenerate the QR.")

  for (const field of REQUIRED_FIELDS) {
    const value = record[field]
    if (value === undefined || value === null || value === "") return fail("missing-field", `The QR is missing "${field}" — regenerate it.`, field)
    if (typeof value !== "string") return fail("bad-field", `The QR field "${field}" must be text — regenerate it.`, field)
  }
  const url = record.url as string
  if (!isHttpUrl(url)) return fail("bad-url", 'The server URL must start with http:// or https:// — regenerate the QR.', "url")
  const bridgeUrl = record.bridgeUrl as string
  if (!isHttpUrl(bridgeUrl)) {
    return fail("bad-url", "The bridge URL must start with http:// or https:// — regenerate the QR.", "bridgeUrl")
  }

  for (const field of OPTIONAL_SECRET_FIELDS) {
    const value = record[field]
    if (value !== undefined && typeof value !== "string") {
      return fail("bad-field", `The QR field "${field}" must be text — regenerate it.`, field)
    }
  }

  const payload: ConnectPayload = {
    v: 1,
    name: record.name as string,
    url,
    username: record.username as string,
    bridgeUrl,
    defaultProjectDir: record.defaultProjectDir as string,
  }
  if (typeof record.password === "string") payload.password = record.password
  if (typeof record.bridgeToken === "string") payload.bridgeToken = record.bridgeToken
  return { ok: true, payload }
}

// Secrets the QR omitted (the `--no-secrets` variant) that the user must type
// before saving. Present-but-empty counts as missing — an empty password or
// token authenticates nothing.
export function missingSecrets(payload: ConnectPayload): Array<"password" | "bridgeToken"> {
  const out: Array<"password" | "bridgeToken"> = []
  if (!payload.password) out.push("password")
  if (!payload.bridgeToken) out.push("bridgeToken")
  return out
}
