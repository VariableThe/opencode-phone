## Problem
Service account lacks Play Console API access. CI can build+sign AAB but upload fails.

## Goal
First AAB published to Play Store internal testing track via CI.

## Success Metric
`publish-play-store.yml` workflow completes successfully — AAB uploaded to internal track.

## Current State
- App created in Play Console (ai.opencode.mobile, ID: 4975545755653045321)
- Service account exists: playstore-deploy@opencode-mobile-deploy.iam.gserviceaccount.com
- CI workflow builds AAB with release signing ✅
- Upload fails: "The caller does not have permission"
- User is currently on Play Console API access page in Chrome

## Proposed Design
1. User grants service account access in Play Console (they're on the page now)
2. Re-trigger publish-play-store.yml workflow
3. Monitor until AAB uploads successfully

## Alternatives Considered
1. Manual upload via Play Console UI — rejected (not repeatable, defeats CI purpose)
2. Use different auth mechanism — rejected (service account is standard approach)

## Risks & Open Questions
- Risk: Service account might need specific permissions (Admin vs Release Manager)
  Mitigation: Grant Admin initially, can restrict later

## Touched Surface
- No code changes needed — this is a permissions/config task
- .github/workflows/publish-play-store.yml already correct
