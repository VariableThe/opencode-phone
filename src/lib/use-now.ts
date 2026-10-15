import { useCallback, useEffect, useState } from "react"
import { AppState } from "react-native"
import { useFocusEffect } from "expo-router"

// Ticking clock for relative-time labels ("5m ago" must become "6m ago"
// without a reload). Returns the current epoch ms, re-rendering the caller on
// a low-frequency interval AND immediately when the screen regains focus
// (useFocusEffect), when the app returns to the foreground (Android freezes
// JS timers while backgrounded, so the interval alone would resume stale —
// this covers the "refresh after 10 minutes" case from the bug report), and
// whenever the caller passes a changed refreshKey (wire pull-to-refresh's
// `refreshing` flag through so a manual refresh recomputes labels even when
// the fetched data is identical and the store emits no update).
//
// Defaults to 30s: minute-granularity labels need no finer cadence, and a
// single hook instance per screen (pass the value down to rows) keeps timer
// count at one, not one per list row.
export function useNow(refreshKey?: unknown, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())

  // Screen focus (including first mount and back-navigation) recomputes now.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now())
    }, []),
  )

  // Manual refresh recomputes now even when the data comes back unchanged.
  useEffect(() => {
    setNow(Date.now())
    // refreshKey is intentionally the only dep: any change means "recompute".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, intervalMs)
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick()
    })
    return () => {
      clearInterval(timer)
      sub.remove()
    }
  }, [intervalMs])

  return now
}
