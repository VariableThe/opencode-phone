// Build/identify server PTYs that attach to a tmux session.
//
// Design: NO native PTY stack in the app. To make a tmux session
// interactively usable we create a server PTY whose command runs
// `tmux attach-session -t <name>` and render it with the existing terminal
// screen (app/terminal/[id].tsx). The args array is passed to the server's
// spawn call directly (no shell), so session names with spaces, dashes, or
// dots need no quoting or escaping — they travel as one argv element.
//
// Verified body shape against opencode 2.0.29 (POST /api/pty):
//   {"title":"tmux: <name>","command":"tmux","args":["attach-session","-t","<name>"]}
//
// No sibling runtime imports — unit-testable with plain `node --test`, same
// pattern as pty.ts / bridge.ts.

export interface TmuxAttachBody {
  title: string
  command: string
  args: string[]
}

/** POST /api/pty body that attaches to the named tmux session. Throws on a blank name. */
export function buildTmuxAttachBody(name: string): TmuxAttachBody {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("tmux session name must not be empty")
  return { title: `tmux: ${trimmed}`, command: "tmux", args: ["attach-session", "-t", trimmed] }
}

interface TmuxRecordShape {
  title?: unknown
  command?: unknown
  args?: unknown
}

/**
 * Recover the tmux session name from a PTY record, so the terminal screen
 * can show the tmux banner even when opened from the Server PTYs tab (no
 * `?tmux=` param). Prefers the argv `-t` value, falls back to the
 * `tmux: <name>` title this client sets at create time. Returns null for
 * plain-shell PTYs.
 */
export function tmuxNameFromRecord(record: TmuxRecordShape): string | null {
  if (record.command === "tmux" && Array.isArray(record.args)) {
    const flag = record.args.indexOf("-t")
    if (flag >= 0 && flag + 1 < record.args.length) {
      const name = record.args[flag + 1]
      if (typeof name === "string" && name.trim()) return name.trim()
    }
  }
  if (typeof record.title === "string" && record.title.startsWith("tmux: ")) {
    const name = record.title.slice("tmux: ".length).trim()
    if (name) return name
  }
  return null
}
