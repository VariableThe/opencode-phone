/**
 * Telemetry consent + initialisation gate.
 *
 * Wraps sentry.ts AND analytics.ts so that initSentry()/initAnalytics() are
 * only called when the user has explicitly opted in. Both crash reporting
 * and activation-funnel analytics share this single consent flag — there is
 * no separate toggle for analytics. Consent state is persisted in
 * expo-secure-store so it survives app restarts.
 *
 * Usage:
 *   import { loadTelemetryConsent, setTelemetryConsent, hasTelemetryConsent } from './telemetry'
 *
 *   // On app start — call BEFORE trying to initialise Sentry/analytics.
 *   const state = await loadTelemetryConsent()   // 'granted' | 'denied' | 'unknown'
 *   if (state === 'granted') { initSentry(); initAnalytics() }
 *
 *   // After the user taps "Allow" in the consent modal:
 *   await setTelemetryConsent(true)   // persists + calls initSentry()/initAnalytics() if not already done
 *
 *   // Check in Settings screen:
 *   const current = hasTelemetryConsent()   // boolean | null (null = not yet decided)
 */

import * as SecureStore from "expo-secure-store"
import { disableSentry, initSentry, sentryEnabled } from "./sentry"
import { initAnalytics, shutdownAnalytics, analyticsEnabled, trackAppOpened } from "./analytics"

const CONSENT_KEY = "opencode_telemetry_consent"

export type ConsentState = "granted" | "denied" | "unknown"

let _resolved: boolean | null = null // null = unknown, true = granted, false = denied
let transition = Promise.resolve()

/**
 * Load persisted consent from SecureStore.
 * Returns 'unknown' if the user has never been asked.
 */
export async function loadTelemetryConsent(): Promise<ConsentState> {
  try {
    const stored = await SecureStore.getItemAsync(CONSENT_KEY)
    if (stored === "granted") {
      _resolved = true
      return "granted"
    }
    if (stored === "denied") {
      _resolved = false
      return "denied"
    }
    // No stored value — first launch
    _resolved = null
    return "unknown"
  } catch {
    _resolved = false
    return "denied"
  }
}

/**
 * Returns the in-memory resolved state (set by loadTelemetryConsent or setTelemetryConsent).
 * null = consent decision not yet loaded.
 * true = granted.
 * false = denied.
 */
export function hasTelemetryConsent(): boolean | null {
  return _resolved
}

/**
 * Persist the user's consent decision and, if granted and Sentry is not yet
 * running, initialise it immediately.
 */
export function setTelemetryConsent(granted: boolean): Promise<void> {
  const next = transition.then(() => applyTelemetryConsent(granted))
  transition = next.catch(() => undefined)
  return next
}

async function applyTelemetryConsent(granted: boolean): Promise<void> {
  if (granted) {
    await SecureStore.setItemAsync(CONSENT_KEY, "granted")
    _resolved = true
    if (!sentryEnabled()) initSentry()
    if (!analyticsEnabled()) initAnalytics()
    // First-ever session reaches here via the consent modal's "Allow" (app
    // start skipped init because consent was still unknown), so app_opened
    // must also fire on the grant transition — otherwise the true first
    // session emits nothing and session 2 gets mislabeled is_first_open.
    // trackAppOpened() is internally once-per-session, so a mid-session
    // revoke -> re-grant cannot double-count.
    void trackAppOpened()
    return
  }

  _resolved = false
  await disableSentry()
  await shutdownAnalytics()
  try {
    await SecureStore.setItemAsync(CONSENT_KEY, "denied")
  } catch (error) {
    await SecureStore.deleteItemAsync(CONSENT_KEY)
    throw error
  }
}
