// Pure settings helpers extracted from stores/settings.ts so the clamp + the
// forward-compatible merge (the upgrade path: stored data from an older app
// version that predates a newer notification category) are unit-testable without
// pulling in zustand / expo-secure-store.

export function clampPageSize(size: number): number {
  return Math.max(10, Math.min(200, size))
}

/**
 * Merge stored settings over defaults. Stored values win, but any top-level field
 * or notification category missing from storage falls back to its default — so a
 * user upgrading to a build with a new setting gets that setting's default rather
 * than `undefined`. Defaults are passed in to keep this module dependency-free.
 */
export function mergeStoredSettings<T extends { notifications: Record<string, boolean> }>(
  defaults: T,
  parsed: Partial<T>,
): T {
  return {
    ...defaults,
    ...parsed,
    notifications: { ...defaults.notifications, ...parsed.notifications },
  }
}
