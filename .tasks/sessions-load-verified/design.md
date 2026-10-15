# Task sessions-load-verified — Design

## Problem
Sessions loading bug (#32) claimed fixed 3+ times. Each "fix" was validated by a CUA test that accepted empty session lists as success. The test never actually caught the regression.

## Root Cause of False Fixes
CUA test `session_list` phase goal said "even if empty is fine" — literally cannot fail on the bug.

## What IS Fixed (code)
- `sessionScopeDirectory()` always returns `null` → app sends no `x-opencode-directory` header → server uses own CWD → returns sessions from the active project
- Server at `100.108.64.76:4096` verified: returns 32 sessions (with `roots=true`) regardless of directory header — consistent behavior
- Both `loadSessions` and `createSession` derive from the same SSoT helper, no drift possible

## What Was Broken (tests/CI)
1. CUA `session_list` phase accepted empty list — fixed (commit 42aa883)
2. `sessions_reload` phase placed AFTER `typescript` — model unavailability blocked it from running — fixed (commit 212b80b)
3. Emulator never boots in CI: `api-level: 30 + google_apis + x86_64` crashes on ubuntu-latest — fixed: `api-level: 28 + default + x86_64 + disable-animations`
4. CI used legacy `--scenarios` mode instead of `--showcase` — fixed (commit 212b80b)

## Success Metric
CI CUA smoke test passes with `sessions_reload` phase = success.
See .tasks/sessions-load-verified/success.md

## Touched Surface
- `scripts/android-cua-smoke.py` — test logic
- `.github/workflows/cua-smoke.yml` — CI configuration

## App Code Status
No code changes needed to `src/`. The sessions loading code is correct.
Verification pending CI run 27992511547.
