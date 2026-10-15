/**
 * In-app store review prompt.
 *
 * Nudges the user toward an App Store / Play Store rating after they've hit
 * a few genuinely successful sessions — never from an error path. Persisted
 * state lives in expo-secure-store, mirroring the consent pattern in
 * telemetry.ts:
 *   - a running count of successful sessions
 *   - a one-time "already asked" flag so we prompt at most once, ever
 *
 * expo-store-review is safe to call unconditionally: requestReview() is only
 * invoked after isAvailableAsync() returns true, and isAvailableAsync()
 * resolves to false wherever the native review API is absent (F-Droid builds
 * with no Play Services, older platform versions, etc.) — see
 * https://docs.expo.dev/versions/latest/sdk/storereview/. In that case this
 * module simply never prompts; it does not fall back to opening a store URL.
 *
 * Usage: call recordSuccessfulSession() from a success-only code path (e.g.
 * the SSE busy -> idle "session completed" transition in stores/events.ts).
 */

import * as SecureStore from "expo-secure-store"
import * as StoreReview from "expo-store-review"
import { shouldRequestReview, DEFAULT_REVIEW_THRESHOLD } from "./store-review-policy"

const COUNT_KEY = "opencode_review_success_count"
const ASKED_KEY = "opencode_review_asked"

// Serialize calls so rapid-fire session completions can't race the
// read-increment-write of the persisted counter.
let transition = Promise.resolve()

/**
 * Record a genuinely positive moment (a session finished successfully).
 * Never call this from an error path. At most one review request is ever
 * issued per install.
 */
export function recordSuccessfulSession(): Promise<void> {
  const next = transition.then(recordSuccessfulSessionInternal)
  transition = next.catch(() => undefined)
  return next
}

async function recordSuccessfulSessionInternal(): Promise<void> {
  try {
    const [asked, storedCount] = await Promise.all([
      SecureStore.getItemAsync(ASKED_KEY),
      SecureStore.getItemAsync(COUNT_KEY),
    ])
    if (asked === "true") return

    // Clamp the persisted counter at the threshold — we only need to know
    // "have we reached it", not track an ever-growing lifetime total.
    const count = Math.min(Number(storedCount ?? "0") + 1, DEFAULT_REVIEW_THRESHOLD)
    await SecureStore.setItemAsync(COUNT_KEY, String(count))

    if (!shouldRequestReview(count)) return

    const available = await StoreReview.isAvailableAsync()
    if (!available) return

    // Mark as asked BEFORE requesting: on iOS requestReview() can throw
    // (e.g. MissingCurrentWindowSceneException while backgrounded — likely,
    // since sessions often complete in the background). A failed attempt
    // consumes the one shot; that beats retrying and violating the
    // "at most once, ever" contract.
    await SecureStore.setItemAsync(ASKED_KEY, "true")
    await StoreReview.requestReview()
  } catch {
    // A review-prompt failure must never affect session handling.
  }
}
