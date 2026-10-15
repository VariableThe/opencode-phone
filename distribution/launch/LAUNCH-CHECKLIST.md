# Launch Checklist

> READY TO POST: All drafts now contain the live, verified install URLs — no `{{...}}` placeholders remain. Primary CTA is the landing page (https://dzianisv.github.io/opencode-mobile/), which lists the self-hosted F-Droid repo and direct APK. Google Play is still in internal testing (not public), so every draft frames it as "coming soon" — do not add a play.google.com link until the production track is live.

---

## Fire sequence

| # | Action | File | Day / Time | Notes |
|---|---|---|---|---|
| 1 | Confirm landing page + F-Droid repo + latest APK release are reachable | — | T-1 day | These are the live install paths used in every draft |
| 2 | (Optional, when ready) Promote Play track to Production / Open Testing, then add the link to drafts | — | When approved | Play is internal-only today; drafts say "coming soon" until this lands |
| 3 | Post to **Hacker News** (Show HN) | `show-hn.md` | Tuesday–Thursday, 8–10am US Eastern | HN front page peaks mid-morning weekdays; one shot |
| 4 | Post to **r/selfhosted** | `reddit.md` | Same day as HN, ~1hr after | Cross-traffic from HN helps early upvotes |
| 5 | Post to **r/androiddev** | `reddit.md` | Same day, ~2hrs after HN | Tech audience; upvote momentum from HN useful |
| 6 | Post **X thread** (7 tweets) | `x-thread.md` | Same day, afternoon | Link HN post in reply to tweet 7 for social proof |
| 7 | Publish **dev.to article** | `devto.md` | Day 2 (Wednesday–Friday) | Evergreen SEO; no urgency to same-day |
| 8 | Post to **r/LocalLLaMA** | `reddit.md` | Day 2 | Separate day avoids cross-post spam perception |
| 9 | Submit **Product Hunt** | `product-hunt.md` | Day 3, 12:01am PT | PH resets at midnight PT; submit exactly then for full day |

---

## After launch

- Reply to all HN comments within 6 hours of posting
- Reply to all Reddit comments within 24 hours
- Monitor Play Console reviews; respond to 1–3 stars within 48 hours
- Self-hosted F-Droid repo is live at https://dzianisv.github.io/opencode-mobile/fdroid/repo (used in all drafts). Optional: file an upstream fdroiddata MR for inclusion in the main F-Droid catalog once the Sentry opt-in gate is merged
