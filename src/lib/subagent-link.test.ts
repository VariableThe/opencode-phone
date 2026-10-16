import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isSubagentTool,
  linkSubagentChild,
  subagentPhase,
  SUBAGENT_STALE_MS,
  subagentInputOf,
  subagentSessionOf,
} from "./subagent-link.ts"
import { toMessageWithParts, V2EventTranslator, type V2Message } from "./v2-shape.ts"

function child(id: string, parentID: string, title: string, created: number) {
  return { id, parentID, title, time: { created, updated: created } }
}

test("isSubagentTool: v2 subagent and v1 task names", () => {
  assert.equal(isSubagentTool("subagent"), true)
  assert.equal(isSubagentTool("task"), true)
  assert.equal(isSubagentTool("bash"), false)
  assert.equal(isSubagentTool(undefined), false)
})

test("linkSubagentChild: completed metadata.sessionID wins", () => {
  const kids = [child("c1", "p", "Alpha", 100), child("c2", "p", "Alpha", 200)]
  const id = linkSubagentChild(kids, "p", { description: "Alpha" }, { sessionID: "c1", status: "completed" })
  assert.equal(id, "c1")
})

test("linkSubagentChild: running tool (empty metadata) matches title == description", () => {
  const kids = [child("c1", "p", "Alpha", 100)]
  const id = linkSubagentChild(kids, "p", { agent: "knight", description: "Alpha" }, {})
  assert.equal(id, "c1")
})

test("linkSubagentChild: latest-created wins for duplicate descriptions", () => {
  const kids = [child("c1", "p", "Alpha", 100), child("c2", "p", "Alpha", 200)]
  assert.equal(linkSubagentChild(kids, "p", { description: "Alpha" }, {}), "c2")
})

test("linkSubagentChild: ignores other parents and misses cleanly", () => {
  const kids = [child("c1", "other", "Alpha", 100)]
  assert.equal(linkSubagentChild(kids, "p", { description: "Alpha" }, {}), undefined)
  assert.equal(linkSubagentChild([], "p", { description: "Alpha" }, {}), undefined)
  assert.equal(linkSubagentChild([], "p", {}, {}), undefined)
})

test("subagent helpers tolerate non-object input/metadata", () => {
  assert.deepEqual(subagentInputOf("raw"), {})
  assert.deepEqual(subagentInputOf(null), {})
  assert.equal(subagentSessionOf(null), undefined)
  assert.equal(subagentSessionOf({}), undefined)
})

test("subagentPhase: error/completed dominate; stale after quiet window", () => {
  const now = 1_000_000_000
  assert.equal(subagentPhase("error", true, now), "failed")
  assert.equal(subagentPhase("completed", true, now), "done")
  assert.equal(subagentPhase("running", false, 0, now), "starting")
  assert.equal(subagentPhase("running", true, now, now), "working")
  assert.equal(subagentPhase("running", true, 0, now), "working")
  assert.equal(subagentPhase("running", true, now - SUBAGENT_STALE_MS - 1, now), "stale")
  assert.equal(subagentPhase("running", true, now - SUBAGENT_STALE_MS + 1_000, now), "working")
})

function subagentMessage(state: Record<string, unknown>): V2Message {
  return {
    id: "msg_sub",
    sessionID: "ses_parent",
    type: "assistant",
    time: { created: 1000 },
    agent: "monarch",
    content: [{ type: "tool", id: "call_1", name: "subagent", state: state as never }],
  }
}

test("v2-shape REST: subagent child id threads through completed metadata only", () => {
  const done = toMessageWithParts([
    subagentMessage({ status: "completed", input: { agent: "knight" }, metadata: { sessionID: "ses_child" } }),
  ])
  const tool = done[0].parts.find((p) => p.type === "tool")
  assert.equal(tool?.state?.subagentSessionID, "ses_child")

  const running = toMessageWithParts([subagentMessage({ status: "running", input: { agent: "knight" }, metadata: {} })])
  const runningTool = running[0].parts.find((p) => p.type === "tool")
  assert.equal(runningTool?.state?.subagentSessionID, undefined)
})

test("v2-shape SSE: subagent child id threads through tool success metadata", () => {
  const t = new V2EventTranslator()
  const raw = (type: string, data: Record<string, unknown>) => ({ type, data })
  const running = t.translate(
    raw("session.tool.called", { sessionID: "ses_parent", assistantMessageID: "msg_a", id: "c1", name: "subagent" }),
  )
  const runningPart = running.find((e) => e.type === "message.part.updated")?.properties.part as { state?: { subagentSessionID?: string } }
  assert.equal(runningPart?.state?.subagentSessionID, undefined)

  const success = t.translate(
    raw("session.tool.success", {
      sessionID: "ses_parent",
      assistantMessageID: "msg_a",
      id: "c1",
      metadata: { sessionID: "ses_child", status: "completed" },
    }),
  )
  const donePart = success.find((e) => e.type === "message.part.updated")?.properties.part as { state?: { subagentSessionID?: string } }
  assert.equal(donePart?.state?.subagentSessionID, "ses_child")
})
