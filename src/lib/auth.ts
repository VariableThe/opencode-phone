// Pure Basic-auth credential construction for opencode connections.
// Extracted from stores/connections.ts so the username-defaulting rule is unit-testable
// without pulling in zustand/expo (which have no resolver outside Metro).

export interface BasicAuth {
  username: string
  password: string
}

// The opencode server's default Basic-auth username is "opencode"
// (OPENCODE_SERVER_USERNAME ?? "opencode"). Quick Connect collects only a password
// (it has no username field), so when a password is set but no username, default the
// username to "opencode". Without this, an empty username made auth undefined entirely —
// no Authorization header was sent — and a password-protected server returned 401,
// i.e. the common "I set a password and now it won't connect" failure.
export function buildAuth(
  username: string | null | undefined,
  password: string | null | undefined,
): BasicAuth | undefined {
  if (!password) return undefined
  return { username: username?.trim() || "opencode", password }
}
