// Server-driven settlement classification for session notifications.
//
// Pure leaf: NO imports (not even ./notify-format) so it stays runnable under
// plain `node --test`, where node type-stripping cannot resolve extensionless
// cross-imports (same constraint as lib/ntfy.ts). Mirrors the reference
// design (alvarolorentedev/opencode-mobile settlement states — see
// THIRD_PARTY_NOTICES) without copying its code: every watched session is
// classified into exactly one state, and only the terminal/waiting states
// warrant a local notification.
//
// Classification rules (first match wins):
//   aborted  — the run was cancelled by the user, or the session no longer
//              exists server-side (deleted). Dropped silently: a cancelled or
//              vanished run is not a completion and must never alert.
//   blocked  — a permission request or input form is outstanding. Needs-input
//              wins over busy/retry: the agent cannot proceed without the
//              user, so alerting now is the point (separate needs-input
//              channel, keyed per prompt id so a second prompt re-alerts).
//   running  — server reports busy. In progress: suppress.
//   retrying — server reports retry. In progress: suppress.
//   failed   — the run ended and an error was observed (session.error event,
//              or a terminal assistant message carrying an error). Notify.
//   finished — the run ended cleanly (busy -> idle with no error, or a
//              terminal assistant message with time.completed). Notify.
//   unknown  — not enough signal (no status, session missing from the list
//              but not confirmed deleted). Never notify; keep watching.

export type SettlementState = "running" | "retrying" | "blocked" | "failed" | "aborted" | "finished" | "unknown"

export type ServerStatus = "idle" | "busy" | "retry"

export interface SettlementInput {
  /** Last known server status for the session. Absent when never observed. */
  status?: ServerStatus
  /** True when a permission request or input form is outstanding. */
  pendingInput: boolean
  /** True when the current run emitted an error. */
  errored: boolean
  /** True when the user cancelled the current run. */
  aborted: boolean
  /** False when the session no longer exists server-side (deleted). */
  exists: boolean
}

export function classifySettlement(input: SettlementInput): SettlementState {
  if (!input.exists || input.aborted) return "aborted"
  if (input.pendingInput) return "blocked"
  if (input.status === "busy") return "running"
  if (input.status === "retry") return "retrying"
  if (input.status === "idle") return input.errored ? "failed" : "finished"
  return "unknown"
}

// Only terminal outcomes and needs-input warrant an alert. Running, retrying,
// aborted and unknown are suppressed — unknown explicitly, so a session we
// have no signal for can never spam; it stays watched until signal arrives.
export function shouldNotify(state: SettlementState): boolean {
  return state === "finished" || state === "failed" || state === "blocked"
}

// Dedupe key shared by the SSE path (stores/events.ts) and the periodic
// watcher (stores/session-watch.ts), persisted so a restart cannot re-fire.
// One key per session+state: a second completion of the same session after a
// new run still alerts (the watcher clears the key when a new run starts),
// while repeats of an already-announced state are dropped. Blocked alerts
// additionally key on the prompt id, so a second outstanding prompt re-alerts
// but polls of the same prompt stay silent.
export function alertKey(connectionScope: string, sessionId: string, state: SettlementState, promptId?: string): string {
  const tail = state === "blocked" && promptId ? `blocked:${promptId}` : state
  return `watch:${connectionScope}:${sessionId}:${tail}`
}

// In-memory single-flight dedupe for one evaluate pass: the same session can
// surface as both "blocked" (pending prompt) and via status — the caller
// collects keys first, then notifies only unseen ones.
export class AlertDedupe {
  private seen = new Set<string>()

  has(key: string): boolean {
    return this.seen.has(key)
  }

  // Returns true when the key is new (caller should notify), false when it
  // was already announced in this process lifetime.
  claim(key: string): boolean {
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }

  // A new run starting invalidates the previous terminal announcement, so
  // the next completion alerts again. Blocked keys carry prompt ids and
  // expire with the prompt — leave them alone.
  resetTerminal(connectionScope: string, sessionId: string): void {
    const prefix = `watch:${connectionScope}:${sessionId}:`
    for (const key of [...this.seen]) {
      if (key.startsWith(prefix) && (key.endsWith(":finished") || key.endsWith(":failed"))) this.seen.delete(key)
    }
  }

  preload(keys: readonly string[]): void {
    for (const key of keys) this.seen.add(key)
  }

  snapshot(): string[] {
    return [...this.seen]
  }
}
