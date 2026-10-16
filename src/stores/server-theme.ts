import { create } from "zustand"
import { buildBridgeUrl, bridgeAuthHeaders } from "../lib/bridge"
import type { ServerConnection } from "../lib/types"

// Per-connection opencode theme fetched from the oc-phone-bridge sidecar
// (GET /theme -> {name, json}). The v2 server API was checked first and does
// NOT expose the theme: GET /api/config returns opencode.json (model, agents,
// mcp, providers) plus directory docs with empty info — no tui.json/theme key
// anywhere — so the bridge is the only clean source.
//
// Cached per connection id, refreshed on connect/foreground by app/_layout.
// Degrades silently: success stores, 404 (unconfigured theme) clears, any
// other failure keeps the last good value. Never throws into callers.

const THEME_TIMEOUT_MS = 10_000

export interface ServerThemeEntry {
  name: string
  json: unknown
  fetchedAt: number
}

interface ServerThemeState {
  entries: Record<string, ServerThemeEntry>
  pending: Record<string, boolean>
  refresh: (connection: ServerConnection | null) => Promise<void>
  entryFor: (connectionId: string | null | undefined) => ServerThemeEntry | null
}

function isThemeBody(raw: unknown): raw is { name: string; json: unknown } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false
  const body = raw as Record<string, unknown>
  return typeof body.name === "string" && body.name.length > 0 && "json" in body
}

export const useServerTheme = create<ServerThemeState>((set, get) => ({
  entries: {},
  pending: {},

  entryFor: (connectionId) => {
    if (!connectionId) return null
    return get().entries[connectionId] ?? null
  },

  refresh: async (connection) => {
    if (!connection) return
    const bridgeUrl = connection.bridgeUrl?.trim()
    const bridgeToken = connection.bridgeToken?.trim()
    // No sidecar configured: no theme source, drop any stale entry.
    if (!bridgeUrl || !bridgeToken) {
      if (get().entries[connection.id]) {
        set((state) => {
          const entries = { ...state.entries }
          delete entries[connection.id]
          return { entries }
        })
      }
      return
    }
    if (get().pending[connection.id]) return
    set((state) => ({ pending: { ...state.pending, [connection.id]: true } }))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), THEME_TIMEOUT_MS)
    try {
      const response = await fetch(buildBridgeUrl(bridgeUrl, "/theme"), {
        headers: { ...bridgeAuthHeaders(bridgeToken) },
        signal: controller.signal,
      })
      if (response.status === 404) {
        // Theme unconfigured on that host — clear so the app falls back.
        set((state) => {
          const entries = { ...state.entries }
          delete entries[connection.id]
          return { entries }
        })
        return
      }
      if (!response.ok) return // keep last good value on transient failures
      const raw: unknown = await response.json()
      if (!isThemeBody(raw)) return
      const entry: ServerThemeEntry = { name: raw.name, json: raw.json, fetchedAt: Date.now() }
      set((state) => ({ entries: { ...state.entries, [connection.id]: entry } }))
    } catch {
      // Network down, server asleep, aborted — silent, keep last good value.
    } finally {
      clearTimeout(timeout)
      set((state) => {
        const pending = { ...state.pending }
        delete pending[connection.id]
        return { pending }
      })
    }
  },
}))
