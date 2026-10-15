# Worklog

- 2026-06-23T00:00Z: Diagnosed: CUA session_list phase accepted empty lists. CI emulator boots API 30 google_apis but crashes silently. Sessions_reload was gated behind typescript.
- 2026-06-23T00:01Z: Fixed session_list phase (commit 42aa883) — _precreate_test_session + named session required in goal
- 2026-06-23T00:02Z: Fixed sessions_reload position + CI emulator + --showcase mode (commit 212b80b). Pushed to main.
- 2026-06-23T00:04Z: Fixed banner label (commit cdbea50)
- 2026-06-23T00:06Z: CRITICAL BUG FOUND: _precreate_test_session used opencode_url which is 10.0.2.2 in CI. Fixed: replace 10.0.2.2 → 127.0.0.1 before API call (commit bbe8af9).
- 2026-06-23T00:06Z: Active CI run: 27992695069 (has all fixes). Build in progress (~20 min). Waiting.
- Verified: server at 127.0.0.1:4096 returns 32 sessions with ?roots=true. App code is correct.
