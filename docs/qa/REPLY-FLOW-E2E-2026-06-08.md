# Reply-flow E2E verification — 2026-06-08

Closes the residual test-gate gap: opencode could not reply inside CI (no provider),
so the send→reply→diff journey was unexercised. Verified here against the LIVE remote
opencode server using app-identical SDK calls and a FREE model (no cost, no remote mutation).

Server: http://100.108.64.76:4096 (auth opencode:test), model opencode/deepseek-v4-flash-free
Script: /tmp/oc_e2e.py (replicates src/lib/sdk.ts: session.create → prompt_async → message poll → diff)

Result:
- [1] create session -> 200
- [2] prompt_async -> 204
- [3] assistant reply after ~8s (127 chars): "A binary search is an algorithm that finds a
      target value in a sorted array by repeatedly dividing the search interval in half."
- [4] diff endpoint -> 200 (0 entries; no file edit triggered to avoid mutating the remote)
- RESULT: PASS reply flow

## Gate status after this run
- Connect → create session → session list: GREEN, on-device CUA E2E (run 27142662582).
- Send prompt → streaming assistant reply: GREEN, verified against real replying server (this doc).
- Diff: endpoint 200 + DiffView UI fixed (horizontal scroll); not exercised with a populated
  diff (would mutate remote). Rendering code audited.
- 10 UI/UX bugs fixed across all screens; tsc clean, 65/65 unit tests pass.

## Residual (only remaining gap)
Literal pixel-level GUI of the streaming reply + a populated diff on a real device. Local
emulator unavailable (homebrew sdkmanager fetched Linux-x86-64 binaries on arm64 macOS —
wrong-OS, won't run). Closeable by a ~10-min manual phone walkthrough, or by wiring a free
provider into the CI emulator run.
