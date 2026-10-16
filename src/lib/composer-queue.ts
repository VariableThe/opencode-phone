// Pure composer helpers for slash commands and the queued-message inbox.
// No React Native imports — runnable under plain `node --test`.
//
// Precedence rule (documented for the composer): local builtin commands
// (new/model/agent) shadow server commands of the same name. A server command
// whose name collides with a builtin is suppressed from the autocomplete list
// and a sent `/name` resolves to the builtin action, never the server one.

export interface CommandEntry {
  trigger: string
  title: string
  description?: string
  type: "builtin" | "custom"
}

export type SlashResolution =
  | { kind: "bare" }
  | { kind: "builtin"; name: string; args: string }
  | { kind: "server"; name: string; args: string }
  | { kind: "unknown"; name: string; args: string }

const SLASH_RE = /^\/([A-Za-z0-9_-]*)([\s\S]*)$/

// Split `/name args...` into its parts. Returns null when the text is not a
// slash invocation at all.
export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null
  const match = SLASH_RE.exec(text)
  if (!match) return null
  return { name: match[1], args: match[2].trim() }
}

// Classify a composer line against the builtin triggers and the server's
// command names. Builtins win exact-name ties (see the precedence rule above).
export function resolveSlash(text: string, builtins: string[], serverNames: string[]): SlashResolution {
  const parsed = parseSlashInput(text)
  if (!parsed) return { kind: "unknown", name: "", args: "" }
  if (!parsed.name) return { kind: "bare" }
  if (builtins.includes(parsed.name)) return { kind: "builtin", name: parsed.name, args: parsed.args }
  if (serverNames.includes(parsed.name)) return { kind: "server", name: parsed.name, args: parsed.args }
  return { kind: "unknown", name: parsed.name, args: parsed.args }
}

// Merge builtins (first) with server commands, dropping server entries whose
// name collides with a builtin trigger so the two never shadow confusingly.
export function mergeCommandList<T extends { trigger: string }>(builtins: T[], server: T[]): T[] {
  const taken = new Set(builtins.map((b) => b.trigger))
  return [...builtins, ...server.filter((c) => !taken.has(c.trigger))]
}

// Autocomplete filtering: trigger prefix match or title substring, same rule
// the popover has always used — kept here so it is unit-testable.
export function filterCommands(list: CommandEntry[], query: string): CommandEntry[] {
  const q = query.toLowerCase()
  if (!q) return list
  return list.filter((c) => c.trigger.toLowerCase().startsWith(q) || c.title.toLowerCase().includes(q))
}

// --- queued-message inbox id sets (per session) ---

export function upsertQueued(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids
  return [...ids, id]
}

export function removeQueued(ids: string[], id: string): string[] {
  if (!ids.includes(id)) return ids
  return ids.filter((x) => x !== id)
}
