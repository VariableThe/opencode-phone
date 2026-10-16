import { test } from "node:test"
import assert from "node:assert/strict"
import { highlightLine } from "./syntax-highlight.ts"
import { GUTTER_USER, GUTTER_ASSISTANT, monoFont, toolArgsSummary } from "../components/chat/tui.ts"

// The highlighter is a best-effort single-line tokenizer: it must never
// throw, never lose characters (segments rejoin to the input), and degrade
// to plain for constructs it doesn't model (block comments, nesting).

test("highlightLine: segments rejoin to the input exactly", () => {
  const lines = [
    "const x = fetch('/api?q=1') // load #data",
    "# python comment with 'quotes' and 42",
    "  ",
    "a#b",
    "`tmpl ${x}` + 0x1F + 3.14",
  ]
  for (const line of lines) {
    const joined = highlightLine(line).map((s) => s.text).join("")
    assert.equal(joined, line, line)
  }
})

test("highlightLine: strings, comments, numbers, keywords classified", () => {
  const kinds = new Map(highlightLine("const n = 42 // done").map((s) => [s.text, s.kind]))
  assert.equal(kinds.get("const"), "keyword")
  assert.equal(kinds.get("42"), "number")
  assert.equal(kinds.get("// done"), "comment")
  const str = highlightLine('say "hi"').find((s) => s.kind === "string")
  assert.equal(str?.text, '"hi"')
})

test("highlightLine: # is a comment only in comment position", () => {
  const py = highlightLine("# comment")
  assert.equal(py[0].kind, "comment")
  const frag = highlightLine("url#a")
  assert.ok(frag.every((s) => s.kind !== "comment"), "URL fragment stays plain")
})

test("highlightLine: empty and comment-only lines stay safe", () => {
  assert.deepEqual(highlightLine(""), [{ text: "", kind: "plain" }])
  assert.ok(highlightLine("/* block */").length >= 1)
})

test("tui markers: gutter constants and mono families", () => {
  assert.equal(GUTTER_USER, ">")
  assert.equal(GUTTER_ASSISTANT, "●")
  assert.equal(monoFont("ios"), "Menlo")
  assert.equal(monoFont("android"), "monospace")
})

test("toolArgsSummary: prefers human scalars, truncates, never throws", () => {
  assert.equal(toolArgsSummary(undefined), "")
  assert.equal(toolArgsSummary({ command: "ls -la", extra: 1 }), "ls -la")
  assert.equal(toolArgsSummary({ filePath: "/a/b.ts" }), "/a/b.ts")
  const long = toolArgsSummary({ command: "x".repeat(200) })
  assert.ok(long.length <= 121 && long.endsWith("…"))
  assert.equal(toolArgsSummary("raw"), "raw")
})
