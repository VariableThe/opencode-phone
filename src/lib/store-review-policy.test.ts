import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldRequestReview, DEFAULT_REVIEW_THRESHOLD } from "./store-review-policy.ts"

test("below the default threshold -> false", () => {
  assert.equal(shouldRequestReview(0), false)
  assert.equal(shouldRequestReview(DEFAULT_REVIEW_THRESHOLD - 1), false)
})

test("at or above the default threshold -> true", () => {
  assert.equal(shouldRequestReview(DEFAULT_REVIEW_THRESHOLD), true)
  assert.equal(shouldRequestReview(DEFAULT_REVIEW_THRESHOLD + 5), true)
})

test("custom threshold is respected", () => {
  assert.equal(shouldRequestReview(2, 5), false)
  assert.equal(shouldRequestReview(5, 5), true)
})
