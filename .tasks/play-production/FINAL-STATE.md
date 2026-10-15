# Release state — 2026-06-01 (end of session)

## Done
- v0.4.2 tagged; signed cc.agentlabs.opencode APK on GitHub release (direct install works).
- F-Droid mainline MR: https://gitlab.com/fdroid/fdroiddata/-/merge_requests/39530
- F-Droid self-hosted repo publish: androguard<4.1 pin fix (dcb6ee0), re-run 26782570394.
- agentlabs.cc/opencode live; links repointed (PR #17). Launch kit (PR #19). Smoke fix (PR #18).

## Blocked (human/external)
1. Play production: app is "Draft app". Owner must, in Play Console
   (app 4973009715197528834): complete App content (data safety, content rating,
   target audience, privacy) -> Production -> Create release (v0.4.2 AAB staged) -> Publish.
   API cannot do first publish (Google rule); declarations are legal answers - not auto-fillable.
2. IzzyOnDroid: needs Codeberg login (none configured). Request text ready in
   distribution/izzyondroid-submission/ (update pkg to cc.agentlabs.opencode first).
3. F-Droid mainline: MR #39530 under review (weeks; reproducible-build for Expo is the hard part).
4. 1k downloads: post-launch growth; launch kit ready in distribution/launch/.

## F-Droid self-hosted repo — DEPRIORITIZED (2026-06-01)
publish-fdroid.yml `fdroid update` crashes in androguard parsing our CI-built APK's
v2+v3 signature: androguard 4.0.x -> "res1 must be zero!"; 4.1.0/4.1.1/4.1.4 ->
"'NoOverwriteDict' object has no attribute 'append'" (duplicate signing-block id).
androguard 4.1.4 parses the RELEASE-asset APK locally (v3 short-circuits) but fails
the CI-built APK. This is a known androguard/fdroidserver limitation with
multi-scheme-signed APKs. STOPPED after 4 attempts — niche channel. The real
F-Droid path is mainline MR #39530 (F-Droid's own build farm, not this pip path).
