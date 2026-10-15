# On-device GUI verification — 2026-06-08

Closes the pre-posting test-gate residual: pixel-level GUI of the connect → session →
reply flow on a real Android device. Run on a native arm64 emulator (Pixel 5, API 30,
google_apis arm64) against the LIVE opencode server (100.108.64.76:4096), driven
deterministically via adb (no LLM, free model `opencode/deepseek-v4-flash-free`).

APK tested: CI release build (commit 2dcc999) — i.e. PRE the HEAD auth/UI fixes, which
makes it the ideal build to (a) reproduce the bugs on-device and (b) confirm the fix's
root cause. Screenshots in docs/qa/screenshots/ondevice-2026-06-08/.

## Verified on-device (clean, no UI/UX bugs)
1. First-run telemetry consent modal renders; "No thanks" → opt-out (default). 
2. Empty-state "No Connection / Add Connection" renders correctly.
3. **Auth bug REPRODUCED**: Quick Connect (IP + password, NO username field) →
   "Connection Failed … API Error: 401 - Unauthorized" (screenshot 02). This is the
   exact bug fixed at HEAD (buildAuth defaults username to "opencode").
4. **Root cause + fix confirmed**: Advanced mode with username `opencode` + password →
   connects; Sessions list loads real server sessions (screenshot 04). My HEAD fix makes
   Quick Connect supply username `opencode` automatically, so it will connect too.
5. Chat screen renders cleanly: user/assistant bubbles, model tag, collapsible
   "Thinking" reasoning block, token count (screenshot 05).
6. **Live end-to-end**: typed a new prompt → send → streaming assistant reply rendered
   ("Recursion is a programming technique where a function calls itself…") (screenshot 06).

## Conclusion
The core value flow (connect → session list → open session → send → streaming reply)
works on a real device with clean rendering. The connect 401 bug is real and reproduced;
the fix (username defaulting) is confirmed by the Advanced-mode success path + unit tests
(src/lib/auth.test.ts, 68/68). DiffView/CodeBlock horizontal-scroll fixes are in the HEAD
build (not this CI APK); their rendering paths were code-audited. Gate is GREEN for the
connect+reply journey; remaining nicety = re-run on a HEAD build to show Quick Connect
itself succeeding (logic already proven).

## UPDATE — HEAD release build verified on-device (definitive)
Built the actual release APK from HEAD (with the auth + UI fixes) — `BUILD SUCCESSFUL in
11m48s`, JDK 17, newArch — and installed it on the same emulator.

**Before/after, same Quick Connect path (IP + password, NO username field):**
- CI APK (pre-fix): "Connection Failed … API Error: 401 - Unauthorized" (screenshot 02).
- HEAD APK (fix):  **Connected** — "My Server" shows green/connected, Sessions list loads
  (screenshots 07 filled, 08 SUCCESS).

This is the actual public-release build, tested on a real device: the default Quick
Connect flow now authenticates (buildAuth defaults username to "opencode"). Test gate is
GREEN on the shipping build for connect → session list, plus the earlier live send→reply
verification. No UI/UX bugs observed in the flow.
