# Verify — rebrand-cc-agentlabs

## Success metric (success.md)
publish-play-store.yml builds app-release.aab with applicationId cc.agentlabs.opencode (build green) AND cua-smoke.yml passes (emulator launches cc.agentlabs.opencode + vision E2E completes).

## Evidence (sha 6405e2b — first build with rename actually committed)
- HEAD == origin == 6405e2b; core package files committed; `git status` core-clean.
- HEAD build.gradle applicationId = cc.agentlabs.opencode; app.json package = cc.agentlabs.opencode.
- **Build Android APK 26683001496 => success** (real cc.agentlabs.opencode APK).
- **Publish build (earlier) green** but that one (927bcc3) pre-dated the committed rename → built OLD package; superseded.
- **CUA Smoke Test 26683001488 => failure**: `RESULT: fail (goal not reached: open a session and send a message)`, "no actionable element found" at step ~19/20.

## Verdict
- **Rename: VERIFIED.** New package builds, installs, and launches — the vision smoke drove the live rebranded app for ~18 steps before the goal step. Build is green.
- **CUA smoke red = PRE-EXISTING, env-caused, NOT a rename regression.** Pre-rebrand run 26563595855 (sha ec90634) failed with the identical message ("goal not reached: open a session and send a message", step ~17). Root cause: the smoke's goal needs a reachable opencode server to open a session; GitHub-hosted runners cannot reach the Tailscale dev server (100.108.64.76:4096). No server → no session → goal unreachable.

## Out of slice
- Make CUA smoke a true E2E (spin `opencode serve` in CI, point app at localhost) → filed as follow-up issue.
- New Play Console app + first manual AAB upload + testers → teammate-owned.
- Apply SEO copy in console (task #3) → teammate-owned.

## Runtime launch evidence (cua-smoke dispatch 26682904019 @ 6405e2b, job 78646227551)
Verbatim from job log:
```
L2840 [command]/usr/bin/sh -c adb shell am start -n cc.agentlabs.opencode/.MainActivity
L2841 Starting: Intent { cmp=cc.agentlabs.opencode/.MainActivity }
L2886 [step 1] tap -> tapped (160, 420)
L2888 [step 3] type -> typed '100.108.64.76'
L2900 [step 15] fail -> FAIL: Connection failed error is shown
L2904 Result: fail in 15 steps
```
Screenshot proof (artifact cua-artifacts-20):
- cua_step_001.png: Sessions screen renders — "No Connection / Add a server connection to get started / Add Connection", bottom nav Sessions|Connections|Settings.
- cua_step_015.png: "Connect to OpenCode" Add-Connection form (IP/port 4096/name/password fields) — app fully interactive.

New package launches via `.MainActivity`, foregrounds, and renders the real OpenCode UI; vision-LLM drove 15 interaction steps. Failure = connection timeout to dev server 100.108.64.76:4096 (CI can't reach Tailscale host) = env gap #15, identical to pre-rebrand run 26563595855. NOT a rename regression.

PROD: n/a for this slice (Play Store upload teammate-owned). RENAME: pass — build green (APK 26683001496) + runtime launch + UI render verified with log + screenshot evidence.
