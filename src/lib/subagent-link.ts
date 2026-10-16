// Pure subagent-linking helpers: which child session belongs to a parent's
// `subagent` (v2) / `task` (v1) tool call, and what state the delegation is
// in. Pure (no store/RN imports) so the rules stay unit-testable under plain
// `node --test`.
//
// Mechanism (live-verified on v2.0.29):
// - The parent transcript carries a `tool` part named `subagent` whose input
//   is {agent, description, prompt}. While running, metadata is EMPTY — the
//   child session id is not yet attached anywhere in the parent.
// - The child session exists independently with parentID == parent id and
//   title == the tool input's description. It is fetchable via
//   GET /api/session/{childID}/message and its events arrive on the same
//   global /api/event stream scoped by the child's sessionID.
// - Only on completion does the tool part gain
//   metadata = {sessionID, status, truncated} and a text output of the form
//   `<subagent sessionID="..." state="...">report…`.
import type { Session } from "./sdk"

//`tool` parts named `subagent` (v2.0.29) or `task` (v1) spawn child sessions.
export function isSubagentTool(name: string | undefined): boolean {
  return name === "subagent" || name === "task"
}

// No output from a running child for this long: stop showing a spinner as if
// activity were imminent and say so instead, so the parent is never stuck on
// a forever-spinner when a subagent never returns.
export const SUBAGENT_STALE_MS = 5 * 60_000

export interface SubagentInput {
  agent?: string
  description?: string
}

export function subagentInputOf(input: unknown): SubagentInput {
  if (typeof input !== "object" || input === null) return {}
  const record = input as Record<string, unknown>
  return {
    agent: typeof record.agent === "string" ? record.agent : undefined,
    description: typeof record.description === "string" ? record.description : undefined,
  }
}

export function subagentSessionOf(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined
  const id = (metadata as Record<string, unknown>).sessionID
  return typeof id === "string" && id.length > 0 ? id : undefined
}

// Resolve the tool call to one of the parent's known children. The completed
// metadata.sessionID is authoritative; while running, match on
// title == input.description (the server creates the child titled with the
// description — verified live). Latest-created wins when several match, so
// concurrent same-description delegations attach to the freshest run.
export function linkSubagentChild(
  children: Array<Pick<Session, "id" | "parentID" | "title" | "time">>,
  parentID: string,
  input: unknown,
  metadata: unknown,
): string | undefined {
  const authoritative = subagentSessionOf(metadata)
  if (authoritative && children.some((c) => c.id === authoritative)) return authoritative
  if (authoritative) return authoritative
  const { description } = subagentInputOf(input)
  if (!description) return undefined
  const matches = children.filter((c) => c.parentID === parentID && c.title === description)
  if (matches.length === 0) return undefined
  matches.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
  return matches[0].id
}

export type SubagentPhase = "working" | "stale" | "done" | "failed" | "starting"

// Phase for the nested block. `toolStatus` is the parent tool part's state;
// `lastActivityAt` the newest child event/message time seen (0 when the child
// is not yet discovered); `now` should come from a ticking clock (useNow) so
// a hung delegation visibly transitions working -> stale.
export function subagentPhase(
  toolStatus: string,
  childLinked: boolean,
  lastActivityAt: number,
  now: number = Date.now(),
): SubagentPhase {
  if (toolStatus === "error") return "failed"
  if (toolStatus === "completed") return "done"
  if (!childLinked) return "starting"
  if (lastActivityAt <= 0) return "working"
  if (now - lastActivityAt > SUBAGENT_STALE_MS) return "stale"
  return "working"
}
