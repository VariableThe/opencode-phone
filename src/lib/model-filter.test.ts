// Run with plain `node --test` — no RN/expo imports (see model-filter.ts).
import { test } from "node:test"
import assert from "node:assert/strict"
import { filterModels, matchesModelQuery } from "./model-filter.ts"

const providers = [
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      { id: "pareto-26.9", name: "Pareto 26.9" },
      { id: "other-model", name: "Other Thing" },
    ],
  },
  { id: "anthropic", name: "Anthropic", models: [{ id: "claude-fable-5", name: "Claude Fable 5" }] },
]

test("empty query returns every model", () => {
  assert.equal(filterModels(providers, "").length, 3)
})

test("matches model id case-insensitively", () => {
  const hits = filterModels(providers, "PARETO")
  assert.deepEqual(
    hits.map((h) => h.modelID),
    ["pareto-26.9"],
  )
})

test("matches display name and provider name", () => {
  assert.equal(filterModels(providers, "fable")[0].modelID, "claude-fable-5")
  assert.equal(filterModels(providers, "anthropic")[0].providerID, "anthropic")
})

test("trims surrounding whitespace before matching", () => {
  assert.equal(filterModels(providers, "  pareto  ").length, 1)
})

test("whitespace-only query returns everything", () => {
  assert.equal(filterModels(providers, "   ").length, 3)
})

test("matches provider id as well as display name", () => {
  assert.ok(matchesModelQuery("openrouter", "OpenRouter", "x", "X", "openrouter"))
})

test("non-matching query returns nothing", () => {
  assert.deepEqual(filterModels(providers, "zzz-no-such-model"), [])
})

test("tolerates a non-array catalog", () => {
  assert.deepEqual(filterModels(null as unknown as [], "pareto"), [])
})
