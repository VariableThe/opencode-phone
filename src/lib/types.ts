import type { ServerApi } from "./api-detect"

// Connection types for multiple server support
export type ConnectionType = "local" | "tunnel" | "cloud"

export interface ServerConnection {
  id: string
  name: string
  type: ConnectionType
  url: string
  // For auth
  username?: string
  // Password stored separately in SecureStore
  // Directory to use for this connection
  directory?: string
  // oc-phone-bridge sidecar (tmux sessions + pane preview) for this host.
  // All optional and additive: connections saved before these fields
  // existed parse with them as undefined and keep working untouched.
  // bridgeUrl/bridgeToken point at the sidecar's HTTP API (Bearer token,
  // >= 32 chars); defaultProjectDir pre-fills the new-tmux-session form.
  // NOTE: the whole connections list (including bridgeToken) is stored in
  // SecureStore under CONNECTIONS_KEY — the same mechanism as the opencode
  // passwords (per-connection opencode_password_<id> keys) — so no extra
  // storage key was needed.
  bridgeUrl?: string
  bridgeToken?: string
  defaultProjectDir?: string
  // When last successfully connected
  lastConnected?: number
  // Is this the active connection?
  active?: boolean
  // Which server API the last probe found. "v1" means the server predates the
  // /api/ rewrite (opencode <= 1.18.x) and gets the legacy transport from
  // sdk-v1.ts. Absent means "not probed yet", which behaves as v2.
  api?: ServerApi
  // Server version reported by that probe, shown in the connection UI.
  serverVersion?: string
}

export interface AppSettings {
  // Require biometric auth to open app
  requireBiometric: boolean
  // Require biometric to send messages
  requireBiometricForMessages: boolean
  // Theme preference
  theme: "light" | "dark" | "system"
  // Show notifications for task completion
  notifications: boolean
}

// Re-export SDK types we'll use frequently
export type { Session, Message, Part, Project, Event, HealthResponse, FileContent, FileEntry } from "./sdk"
