// Pure success-count threshold logic for the in-app store-review prompt.
//
// Kept free of expo imports (SecureStore, expo-store-review) so it's
// unit-testable with plain `node --test`, the same split used for
// buildAuth() in auth.ts: "Extracted ... so the ... rule is unit-testable
// without pulling in zustand/expo (which have no resolver outside Metro)."

export const DEFAULT_REVIEW_THRESHOLD = 3

/**
 * Decide whether a running count of genuinely successful sessions (never
 * incremented on error) has reached the point where we should attempt a
 * store review prompt. The caller is responsible for tracking the
 * "already asked" flag separately and never calling this again once true.
 */
export function shouldRequestReview(successCount: number, threshold: number = DEFAULT_REVIEW_THRESHOLD): boolean {
  return successCount >= threshold
}
