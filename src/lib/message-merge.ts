import type { InboxEntry, Message, Part } from "./sdk"

/**
 * Merge a server `message.updated` event into the current message list.
 *
 * Optimistic sends add placeholder messages with `temp-` ids (see
 * sessions.ts sendMessage). When the real server message arrives we must
 * replace ONLY the oldest still-pending optimistic message of the same role —
 * not every `temp-` message.
 *
 * The bug this guards against: sending a second message while the first is
 * still processing leaves two `temp-` user messages in the list. A naive
 * "drop all temp messages when any real one arrives" would remove BOTH when
 * the first real message lands, so the second (already queued server-side but
 * not yet echoed back) vanishes from the chat until its own event arrives —
 * a "did my message send?" ghosting bug.
 */
export function mergeIncomingMessage(messages: Message[], message: Message): Message[] {
  // Already present (a later update to a message we've seen): replace in place.
  if (messages.some((m) => m.id === message.id)) {
    return messages.map((m) => (m.id === message.id ? message : m))
  }
  // First time we see this real message: resolve the oldest matching temp.
  const tempIdx = messages.findIndex((m) => m.id.startsWith("temp-") && m.role === message.role)
  if (tempIdx !== -1) {
    const next = messages.slice()
    next[tempIdx] = message
    return next
  }
  // No optimistic placeholder to resolve (e.g. an assistant reply): append.
  return [...messages, message]
}

/**
 * Reconcile optimistic `temp-` parts with the real message id from the POST
 * receipt (see sessions.ts sendMessage).
 *
 * The optimistic insert keys its parts `temp-part-text-<ts>` /
 * `temp-part-file-<ts>-<i>`, but the server echo (v2 `session.inbox.enqueued`
 * fan-out, and GET .../message history — both built by `userParts` in
 * v2-shape.ts) keys them `<messageID>-text` / `<messageID>-file-<n>`. The
 * `message.part.updated` handler matches parts by id, so without this rename
 * the echo never matches the optimistic copy and appends a second text/file
 * part — the user's own message renders twice ("hello\nhello").
 *
 * Must run in the same pass that swaps the optimistic message id for the
 * real one, so every later echo replaces in place. The text/file index rule
 * mirrors `userParts` exactly: the single text part (if any) takes
 * `<messageID>-text`, and file `i` takes `<messageID>-file-<i + offset>`
 * where the offset is 1 when a text part precedes the files, else 0. Parts
 * of any other type keep their id (optimistic sends never create them) and
 * are only rekeyed to the real message.
 */
export function reconcileOptimisticParts(parts: Part[], messageID: string): Part[] {
  const hasText = parts.some((p) => p.type === "text")
  let renamedText = false
  let file = 0
  return parts.map((p) => {
    if (p.type === "text" && !renamedText) {
      renamedText = true
      return { ...p, messageID, id: `${messageID}-text` }
    }
    if (p.type === "file") {
      const id = `${messageID}-file-${hasText ? file + 1 : file}`
      file += 1
      return { ...p, messageID, id }
    }
    return { ...p, messageID }
  })
}

/**
 * Merge a server `message.part.updated` part into a message's part list:
 * replace the same-id part in place, append when it is new. Extracted from
 * the sessions store handler so the optimistic-reconciliation sequence is
 * unit-testable (see message-merge.test.ts).
 */
export function mergeIncomingPart(existing: Part[], part: Part): Part[] {
  const idx = existing.findIndex((p) => p.id === part.id)
  if (idx === -1) return [...existing, part]
  return existing.map((p) => (p.id === part.id ? part : p))
}

/**
 * Merge a full server history fetch with the local message list for
 * `loadOlderMessages` (see sessions.ts).
 *
 * The server list wins wholesale, but still-pending local messages are
 * carried over so a just-sent (or cold-start-rebuilt queued) message doesn't
 * vanish while history loads: `temp-` optimistic sends whose receipt hasn't
 * landed yet, plus still-queued inbox entries the seeder rebuilt below. The
 * caller pre-filters which local messages count as pending; anything passed
 * that the server already lists is deduplicated by id, keeping the first
 * (server) occurrence, so a repeated id in the fetch can never seed a
 * duplicate pair.
 *
 * This deliberately cannot resolve a `temp-` entry against its future real
 * id — the link only exists once the POST receipt lands — so the receipt
 * swap (swapOptimisticId below) drops the temp when the real id is already
 * present instead of renaming it into a second same-id entry.
 */
export function mergeHistoryWithPending(server: Message[], existing: Message[]): Message[] {
  const seen = new Set<string>()
  const out: Message[] = []
  for (const m of server) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  for (const m of existing) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
}

/**
 * Swap an optimistic `temp-` message id for the POST receipt's real id (see
 * sessions.ts sendMessage).
 *
 * When a full history fetch landed mid-POST, the real id is already in the
 * list next to the temp entry — renaming the temp would leave two same-id
 * entries until the next full refresh. Drop the temp instead; the server
 * copy stays. Otherwise rename in place, preserving order.
 */
export function swapOptimisticId(messages: Message[], tempID: string, realID: string): Message[] {
  if (tempID === realID) return messages
  if (messages.some((m) => m.id === realID)) {
    return messages.filter((m) => m.id !== tempID)
  }
  return messages.map((m) => (m.id === tempID ? { ...m, id: realID } : m))
}
