import { create } from "zustand"
import type { Client, Event, Message, Part, Session } from "../lib/sdk"
import { mergeIncomingMessage } from "../lib/message-merge"

// Live + historical activity of child (subagent) sessions, keyed by child id.
// A child session is any session whose parentID points at a session the user
// is viewing. Children are discovered via the session list (which carries
// parentID — verified live on v2.0.29) and via session.created events; their
// messages arrive through the same global SSE stream, scoped by the child's
// sessionID, which the transcript stores otherwise drop.
//
// Isolation: this store intentionally imports no other store (events.ts pushes
// into it; the session screen pulls discovery through it), so there are no
// import cycles. The SDK client is passed in by callers — this module never
// imports sdk.ts at runtime (type-only), keeping node --test viability for
// consumers that only need the pure helpers.
export interface ChildActivity {
  info: Session
  messages: Message[]
  parts: Record<string, Part[]>
  // Last live status seen on the SSE stream. "unknown" until the first
  // session.status event or a discovery refresh — the UI falls back to the
  // parent tool part's own state in that case.
  status: "busy" | "idle" | "unknown"
  // Newest child event/message time observed. Drives the stale guard (a
  // delegation that never returns must stop spinning eventually).
  lastActivityAt: number
  error: string | null
}

// Recent child transcript kept per session for the nested activity view. Full
// history stays on the server; this window covers the live tail.
const CHILD_MESSAGE_LIMIT = 50

// Re-discovery cadence while a parent is tracked (child appears in the list
// shortly after the tool call starts). One timer per tracked parent, cleared
// on untrack — never global, never after unmount.
const REDISCOVER_MS = 15_000

interface SubagentsState {
  children: Record<string, ChildActivity>
  trackedParents: string[]
  trackParent: (parentID: string, client: Client) => Promise<void>
  untrackParent: (parentID: string) => void
  refreshParent: (parentID: string, client: Client) => Promise<void>
  handleEvent: (event: Event) => void
}

const clients: Record<string, Client> = {}
const timers: Record<string, ReturnType<typeof setInterval>> = {}

function toPartsMap(messages: Array<{ info: Message; parts: Part[] }>): Record<string, Part[]> {
  const parts: Record<string, Part[]> = {}
  for (const item of messages) parts[item.info.id] = item.parts || []
  return parts
}

async function fetchChild(client: Client, childID: string): Promise<Array<{ info: Message; parts: Part[] }> | null> {
  const response = await client.session.messages(childID, { limit: CHILD_MESSAGE_LIMIT }).catch(() => null)
  return response
}

export const useSubagents = create<SubagentsState>((set, get) => ({
  children: {},
  trackedParents: [],

  trackParent: async (parentID, client) => {
    clients[parentID] = client
    if (!get().trackedParents.includes(parentID)) {
      set((state) => ({ trackedParents: [...state.trackedParents, parentID] }))
    }
    await get().refreshParent(parentID, client)
    if (!timers[parentID]) {
      timers[parentID] = setInterval(() => {
        const live = clients[parentID]
        if (live) void get().refreshParent(parentID, live)
      }, REDISCOVER_MS)
    }
  },

  untrackParent: (parentID) => {
    if (timers[parentID]) {
      clearInterval(timers[parentID])
      delete timers[parentID]
    }
    delete clients[parentID]
    set((state) => {
      const children = { ...state.children }
      for (const [id, child] of Object.entries(children)) {
        if (child.info.parentID === parentID) delete children[id]
      }
      return { children, trackedParents: state.trackedParents.filter((p) => p !== parentID) }
    })
  },

  refreshParent: async (parentID, client) => {
    // No roots filter: children carry parentID and must be kept (the main
    // session list passes roots:true, which drops them).
    const all = await client.session.list().catch(() => null)
    if (!all) return
    const kids = all.filter((s) => s.parentID === parentID)
    const known = get().children
    // Drop children that vanished server-side (deleted), keep the rest.
    const liveIDs = new Set(kids.map((k) => k.id))
    let pruned: Record<string, ChildActivity> | null = null
    for (const [id, child] of Object.entries(known)) {
      if (child.info.parentID === parentID && !liveIDs.has(id)) {
        pruned = pruned || { ...known }
        delete pruned[id]
      }
    }
    if (pruned) set({ children: pruned })
    await Promise.all(
      kids.map(async (info) => {
        const current = get().children[info.id]
        // Info (title/status/time) always refreshes; the transcript refetches
        // only when the server reports newer content.
        if (current && (current.info.time?.updated ?? 0) >= (info.time?.updated ?? 0) && current.messages.length > 0) {
          if (current.info !== info) {
            set((state) => ({
              children: { ...state.children, [info.id]: { ...state.children[info.id], info } },
            }))
          }
          return
        }
        const response = await fetchChild(client, info.id)
        if (get().trackedParents.includes(parentID) === false) return
        if (!response) {
          // Messages unreachable (transient) — still register the child so the
          // parent shows its identity/status instead of nothing.
          set((state) => ({
            children: {
              ...state.children,
              [info.id]: state.children[info.id] || {
                info,
                messages: [],
                parts: {},
                status: "unknown",
                lastActivityAt: info.time?.updated ?? 0,
                error: null,
              },
            },
          }))
          return
        }
        const messages = response.map((m) => m.info)
        const activity: ChildActivity = {
          info,
          messages,
          parts: toPartsMap(response),
          status: get().children[info.id]?.status ?? "unknown",
          lastActivityAt: messages.reduce((max, m) => Math.max(max, m.time?.created ?? 0), info.time?.updated ?? 0),
          error: get().children[info.id]?.error ?? null,
        }
        set((state) => ({ children: { ...state.children, [info.id]: activity } }))
      }),
    )
  },

  handleEvent: (event) => {
    const props = event.properties as Record<string, unknown>
    switch (event.type) {
      case "message.updated": {
        const message = (props.info || props.message) as Message | undefined
        if (!message?.id || !message.sessionID) return
        if (!get().children[message.sessionID]) return
        set((state) => {
          const child = state.children[message.sessionID]
          if (!child) return {}
          return {
            children: {
              ...state.children,
              [message.sessionID]: {
                ...child,
                messages: mergeIncomingMessage(child.messages, message),
                lastActivityAt: Math.max(child.lastActivityAt, message.time?.created ?? 0),
              },
            },
          }
        })
        return
      }
      case "message.part.updated": {
        const part = props.part as Part | undefined
        if (!part?.messageID) return
        const sessionID = part.sessionID
        if (!sessionID || !get().children[sessionID]) return
        set((state) => {
          const child = state.children[sessionID]
          if (!child) return {}
          const current = child.parts[part.messageID] || []
          const exists = current.some((p) => p.id === part.id)
          return {
            children: {
              ...state.children,
              [sessionID]: {
                ...child,
                parts: {
                  ...child.parts,
                  [part.messageID]: exists ? current.map((p) => (p.id === part.id ? part : p)) : [...current, part],
                },
                lastActivityAt: Date.now(),
              },
            },
          }
        })
        return
      }
      case "session.status": {
        const sessionID = props.sessionID as string | undefined
        const status = props.status as { type: string } | undefined
        if (!sessionID || !status) return
        if (!get().children[sessionID]) return
        const next = status.type === "busy" || status.type === "idle" ? status.type : null
        if (!next) return
        set((state) => {
          const child = state.children[sessionID]
          if (!child || child.status === next) return {}
          return {
            children: { ...state.children, [sessionID]: { ...child, status: next, lastActivityAt: Date.now() } },
          }
        })
        return
      }
      case "session.created":
      case "session.updated": {
        const info = (props.info || props) as Session | undefined
        if (!info?.id) return
        if (info.id && get().children[info.id]) {
          set((state) => ({
            children: { ...state.children, [info.id]: { ...state.children[info.id], info } },
          }))
          return
        }
        // A brand-new child of a tracked parent — pull its transcript.
        if (info.parentID && get().trackedParents.includes(info.parentID)) {
          const client = clients[info.parentID]
          set((state) => ({
            children: {
              ...state.children,
              [info.id]: state.children[info.id] || {
                info,
                messages: [],
                parts: {},
                status: "unknown",
                lastActivityAt: info.time?.updated ?? 0,
                error: null,
              },
            },
          }))
          if (client) {
            void fetchChild(client, info.id).then((response) => {
              if (!response) return
              set((state) => {
                const child = state.children[info.id]
                if (!child) return {}
                const messages = response.map((m) => m.info)
                return {
                  children: {
                    ...state.children,
                    [info.id]: {
                      ...child,
                      info: state.children[info.id]?.info ?? info,
                      messages,
                      parts: toPartsMap(response),
                      lastActivityAt: messages.reduce(
                        (max, m) => Math.max(max, m.time?.created ?? 0),
                        child.lastActivityAt,
                      ),
                    },
                  },
                }
              })
            })
          }
        }
        return
      }
      case "session.error": {
        const sessionID = props.sessionID as string | undefined
        if (!sessionID || !get().children[sessionID]) return
        const error = props.error as { message?: string } | undefined
        set((state) => ({
          children: {
            ...state.children,
            [sessionID]: { ...state.children[sessionID], error: error?.message || "Session error occurred" },
          },
        }))
        return
      }
    }
  },
}))
