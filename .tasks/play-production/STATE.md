# Play production go-live — STATE
- phase: 6-publishing (in CI)
- goal: app publicly downloadable on Google Play -> path to 1k downloads
- authorized: 2026-06-01 by user (AskUserQuestion "Production (go live)")
- dispatched: publish-play-store.yml run 26750741792 (track=production status=completed)
- branch: chore/play-production-track

## Watch
- AAB build ~19min, then r0adkll upload to production track.
- SUCCESS => submitted to Google review; public listing after approval (hours-days).
- FAILURE => likely missing console declaration (data safety / content rating /
  target audience / countries). Capture exact error => that's the human console gate.

## Parallel
- CUA smoke E2E run 26750362939 (proves app works) on branch
  fix/cua-smoke-local-opencode-server.
- PR #17 (links -> agentlabs.cc) ready to merge.

## Next gates toward 1k downloads (post public-live)
1. ASO: apply optimized listing copy + graphics in console (task #3, console owner).
2. Growth launch: Show HN, Reddit (r/androiddev, r/selfhosted, r/LocalLLaMA),
   Product Hunt, X thread, dev.to — landing hub agentlabs.cc/opencode.
3. F-Droid mainline MR (fix stale package id first) — slow channel (2-8wk review).

## CI publish result (run 26750741792) — FAILED with actionable gate
- Build AAB: OK (~18min). Publish step error:
  "Only releases with status draft may be created on draft app."
- Meaning: the Play Console app has never had its FIRST production release
  published. Google API only allows status=draft until a human publishes once.
- Action: re-dispatch track=production status=draft -> uploads AAB into the
  production track as a DRAFT. Remaining HUMAN gate: console owner opens Play
  Console -> Production -> review the draft -> complete any pending declarations
  (data safety / content rating / countries) -> click "Publish / Send for review".
