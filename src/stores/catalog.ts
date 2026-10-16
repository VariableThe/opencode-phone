import { create } from "zustand"
import { useConnections } from "./connections"
import { useSessions } from "./sessions"
import type { Agent, Client, Command } from "../lib/sdk"
import { chooseModelSelection } from "../lib/model-selection"

export interface ProviderModel {
  id: string
  name: string
  reasoning: boolean
  attachment: boolean
  limit?: { context: number; output: number }
  variants?: Record<string, { reasoningEffort?: string }>
}

export interface Provider {
  id: string
  name: string
  connected: boolean
  models: ProviderModel[]
}

interface ModelSelection {
  providerID: string
  modelID: string
}

function sameModel(left: ModelSelection | null, right: ModelSelection | null) {
  return left?.providerID === right?.providerID && left?.modelID === right?.modelID
}

export interface SwitchResult {
  ok: boolean
  // True only when the server re-read confirms the stored value. False on
  // v1 (agent/model ride per-prompt there — the local choice still applies
  // to the next message) or when validation/confirmation fails.
  persisted: boolean
  error?: string
}

interface CatalogState {
  agents: Agent[]
  commands: Command[]
  providers: Provider[]
  defaults: Record<string, string>
  // Current selections
  agent: string // agent name, e.g. "build"
  model: ModelSelection | null
  variant: string | null // model variant for reasoning effort (e.g. "low", "medium", "high")
  loaded: boolean

  // Actions
  load: () => Promise<void>
  setAgent: (name: string) => void
  setModel: (selection: ModelSelection | null) => void
  setVariant: (variant: string | null) => void
  cycleAgent: (direction?: 1 | -1) => void
  // Persistent v2 switches: validate against the server-provided lists
  // first (the server 204s even bogus values and fails only at run time),
  // POST session state, then confirm via re-read before touching local
  // state. Local state changes ONLY on confirmation — never optimistically.
  switchAgent: (sessionID: string, name: string, client?: Client | null) => Promise<SwitchResult>
  switchModel: (
    sessionID: string,
    selection: ModelSelection | null,
    client?: Client | null,
    variant?: string | null,
  ) => Promise<SwitchResult>
}

export const useCatalog = create<CatalogState>((set, get) => ({
  agents: [],
  commands: [],
  providers: [],
  defaults: {},
  agent: "",
  model: null,
  variant: null,
  loaded: false,

  load: async () => {
    const client = useConnections.getState().client
    if (!client) return

    const [agentResult, commandResult, providerResult] = await Promise.all([
      client.agent.list().catch(() => [] as Agent[]),
      client.command.list().catch(() => [] as Command[]),
      client.provider.list().catch(() => null),
    ])

    const agents = Array.isArray(agentResult) ? agentResult : []
    const commands = Array.isArray(commandResult) ? commandResult : []

    // Parse provider response: { all: [...], default: {...}, connected: [...] }
    const raw = providerResult
    const connected = new Set(Array.isArray(raw?.connected) ? raw.connected : [])
    const defaults = raw?.default || {}
    const providers: Provider[] = Array.isArray(raw?.all)
      ? raw.all
          .filter((p) => connected.has(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name || p.id,
            connected: connected.has(p.id),
            models: Object.values(p.models || {})
              .filter((m) => m.status !== "deprecated")
              .map((m) => ({
                id: m.id,
                name: m.name || m.id,
                reasoning: m.reasoning ?? false,
                attachment: m.attachment ?? false,
                limit: m.limit,
                variants: m.variants,
              })),
          }))
          .filter((p) => p.models.length > 0)
      : []

    // Filter out hidden agents
    const visible = agents.filter((a) => !a.hidden)

    // Default agent
    const current = get().agent
    const agent = current && visible.some((a) => a.name === current) ? current : visible[0]?.name || "build"

    // Default model: keep valid existing selection; otherwise prefer connected
    // provider defaults, then first connected model; agent model is last fallback.
    const existing = get().model
    const defaultAgent = visible[0]
    const model = chooseModelSelection({
      providers,
      defaults,
      existing,
      agentModel: defaultAgent?.model || null,
    })

    set((state) => ({
      agents: visible,
      commands,
      providers,
      defaults,
      agent,
      model,
      variant: sameModel(state.model, model) ? state.variant : null,
      loaded: true,
    }))
  },

  setAgent: (name) => {
    const match = get().agents.find((a) => a.name === name)
    if (!match) return
    const model = match.model || get().model
    set((state) => ({
      agent: name,
      model,
      variant: sameModel(state.model, model) ? state.variant : null,
    }))
  },

  setModel: (selection) =>
    set((state) => ({
      model: selection,
      variant: sameModel(state.model, selection) ? state.variant : null,
    })),

  setVariant: (variant) => set({ variant }),

  cycleAgent: (direction = 1) => {
    const { agents, agent } = get()
    const primary = agents.filter((a) => a.mode === "primary" || a.mode === "all")
    if (primary.length < 2) return
    const idx = primary.findIndex((a) => a.name === agent)
    const next = (idx + direction + primary.length) % primary.length
    get().setAgent(primary[next].name)
  },

  switchAgent: async (sessionID, name, client) => {
    const known = get().agents.find((a) => a.name === name)
    if (!known) return { ok: false, persisted: false, error: `Unknown agent: ${name}` }
    const conn = useConnections.getState()
    if (conn.activeConnection?.api === "v1") {
      get().setAgent(name)
      return { ok: true, persisted: false }
    }
    const target = client ?? conn.client
    if (!target) return { ok: false, persisted: false, error: "No active connection" }
    const updated = await target.session.setAgent(sessionID, name).catch((err: unknown) => null)
    if (!updated || updated.agent !== name) return { ok: false, persisted: false, error: "Server did not store the agent" }
    get().setAgent(name)
    useSessions.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionID ? updated : s)),
      currentSession: state.currentSession?.id === sessionID ? updated : state.currentSession,
    }))
    return { ok: true, persisted: true }
  },

  switchModel: async (sessionID, selection, client, variant) => {
    if (!selection) return { ok: false, persisted: false, error: "No model selected" }
    const provider = get().providers.find((p) => p.id === selection.providerID)
    const known = provider?.models.some((m) => m.id === selection.modelID)
    if (!known) {
      return { ok: false, persisted: false, error: `Unknown model: ${selection.providerID}/${selection.modelID}` }
    }
    const conn = useConnections.getState()
    if (conn.activeConnection?.api === "v1") {
      get().setModel(selection)
      return { ok: true, persisted: false }
    }
    const target = client ?? conn.client
    if (!target) return { ok: false, persisted: false, error: "No active connection" }
    const updated = await target.session
      .setModel(sessionID, selection, variant ?? get().variant ?? undefined)
      .catch((err: unknown) => null)
    const stored = updated?.model
    if (!stored || stored.providerID !== selection.providerID || stored.modelID !== selection.modelID) {
      return { ok: false, persisted: false, error: "Server did not store the model" }
    }
    get().setModel(selection)
    useSessions.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionID ? updated : s)),
      currentSession: state.currentSession?.id === sessionID ? updated : state.currentSession,
    }))
    return { ok: true, persisted: true }
  },
}))
