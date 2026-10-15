# OpenCode Mobile — Launch Campaign Plan

> Owner: dzianisv (dzianisvv@gmail.com). All copy in this folder is verified-true. Do not invent metrics, ratings, or store claims.
> `{{PLAY_URL}}` = `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` — Play submitted to production review 2026-06-02, IN REVIEW, auto-publishes on approval (typically ≤7 days). Treat as "launching imminently"; swap the placeholder the moment it goes live.

---

## 1. Positioning & core narrative

**One-liner:** Drive your self-hosted AI coding agent from your phone.

**Category:** Mobile companion / remote control for the [opencode](https://github.com/sst/opencode) AI coding agent. NOT a chatbot, NOT an IDE, NOT a hosted AI service.

**Core narrative (the story every post tells):**
> AI coding agents now run long, autonomous sessions. opencode is one of the best open-source ones — but it lives on your laptop/server, and the moment you walk away you lose all control. OpenCode Mobile gives you a real native client to *steer* those sessions from your phone: watch the agent code in real time, see every diff, and approve or block every file write and shell command — without your code, keys, or traffic ever leaving your own infrastructure.

**Three pillars (lead with the one that fits the audience):**
1. **Control, not just chat** — streaming + inline diffs + tool-call approval. The differentiator vs. SSH/terminal apps and generic AI chat apps.
2. **Self-hosted & private by default** — your server, your keys, no proprietary backend, no accounts, telemetry off by default, MIT. (Lead pillar for r/selfhosted, HN, privacy crowd.)
3. **Bring your own model** — Claude / GPT / Gemini / local LLMs via any OpenAI-compatible endpoint. (Lead pillar for r/LocalLLaMA.)

**What makes it credible (proof points, all true):**
- Open source, MIT, public repo + CI building signed AAB on every tag.
- Real engineering substance (SSE polyfill fix, WebView-free diff renderer, async approval coordination).
- Zero lock-in: no account, no required subscription, no analytics by default.
- Multiple legitimate install channels already live (F-Droid self-hosted repo + direct APK + landing/guide), Play imminent.

**Honest friction to address head-on (don't hide it):** You need your own opencode server. See risk list (§9) for messaging.

---

## 2. Target audiences & where they hang out

| Audience | Why they care | Where to reach them |
|---|---|---|
| Existing opencode users | Direct upgrade to their workflow; lowest-friction converts | sst/opencode GitHub Discussions, opencode Discord, X mentions of "opencode" |
| Self-hosters / homelabbers | "Your server, your keys" resonates hard | r/selfhosted, r/homelab, r/HomeServer, lemmy selfhosted, awesome-selfhosted |
| Local-LLM enthusiasts | Bring-your-own-model + privacy | r/LocalLLaMA, r/ollama, LocalLLaMA Discord, ollama community |
| Android engineers | RN/Expo implementation story | r/androiddev, Android Weekly, Kotlin/Android Slacks, X #AndroidDev |
| AI-coding / dev-tools crowd | New tool in a hot category | HN, r/programming (carefully), dev.to, Product Hunt, X dev community |
| Tailscale / Cloudflare Tunnel users | The connectivity story is native to them | Tailscale community forum/Discord, r/Tailscale, Cloudflare community |
| F-Droid / FOSS Android users | MIT + F-Droid repo + privacy | r/fdroid, r/fossdroid, IzzyOnDroid ecosystem |

---

## 3. Day-by-day launch sequence (T-7 → T+30)

### Pre-launch (T-7 → T-1)
- **T-7:** Lock all assets. Capture/finish the 6 PH/landing screenshots + a 20–40s demo GIF/video (see ASSETS.md). Verify landing, guide, F-Droid repo, and latest APK release are all reachable. Polish the GitHub README so the repo (the link everything points to) converts.
- **T-6:** Pre-seed the niche communities that are NOT launch-day broadcasts: open a friendly post/comment in **sst/opencode Discussions** ("built a mobile client for opencode, feedback welcome") and the **opencode Discord**. These warm users are your earliest upvoters and most credible commenters.
- **T-5:** Submit listings that take time to appear: **AlternativeTo**, **LibHunt/Awesome lists** PRs (awesome-selfhosted, awesome-android, awesome-ai-coding/awesome-opencode if one exists), **F-Droid IzzyOnDroid** consideration. These are evergreen and don't compete with launch day.
- **T-3:** Draft and schedule the X thread; line up the Product Hunt page as a draft (don't publish). Decide exact HN day (Tue–Thu).
- **T-1:** Final reachability check of every URL in every post. Confirm whether Play has approved — if yes, replace `{{PLAY_URL}}` everywhere; if not, keep "in review, going live shortly." Pre-write answers to the top 10 anticipated questions (§7).

### Launch day (T0 — pick a Tuesday, Wednesday, or Thursday)
Tight single-day sequence; do NOT blast every channel at once — stagger to build momentum and look organic.

| Time (US Eastern) | Action | File |
|---|---|---|
| 08:30–09:30 | **Show HN** (the anchor) | `show-hn.md` |
| ~10:30 (≈1h after HN) | **r/selfhosted** | `reddit-selfhosted.md` |
| ~12:00 | **X thread**; reply to last tweet with the HN link | `x-thread.md` |
| ~13:00 (≈2h after HN, if HN is doing well) | **r/androiddev** | `reddit-androiddev.md` |
| Afternoon | Post a heads-up in opencode Discord + sst/opencode Discussions linking the HN thread | — |
| All day | **Babysit HN.** Reply to every comment within ~1h. This is the single highest-leverage activity. | — |

### T+1 → T+2
- **T+1:** **r/LocalLLaMA** (different day from r/selfhosted to avoid cross-post spam perception). Reply to all Reddit comments within a few hours.
- **T+2:** **Publish dev.to article** (evergreen SEO; canonical → landing page). Cross-link from the X thread.

### T+3 (or next clean midnight PT)
- **Product Hunt** launch at 12:01am PT. Maker comment within 60s. Rally any friendly network early (PH weighs early velocity). Reply to every PH comment.

### T+4 → T+7
- File/finish **awesome-list PRs** that weren't done in pre-launch.
- Post to secondary subreddits one per day, spaced out: r/homelab, r/ollama, r/fdroid, r/Tailscale (tailor each to its angle; never copy-paste identical bodies).
- Watch for the Play approval; when it lands, **edit every live post** that allows editing to swap in `{{PLAY_URL}}`, and post a short "now on Google Play" follow-up tweet.

### T+7 → T+30 (sustain)
- **Content cadence:** 1 short technical post/week (dev.to / blog) — e.g. "How opencode's tool-call approval works", "Reaching your homelab from your phone: Tailscale vs Cloudflare Tunnel", "Running opencode with a local model". Each links back to the app naturally.
- **Demo video** to YouTube (T+10ish) — 60–90s screen capture of a real session: connect → prompt → stream → diff → approve. Embed on landing page and in dev.to.
- **Engage upstream:** keep replying in opencode community; offer to be listed in opencode's docs/ecosystem if they have one.
- **Iterate from feedback:** ship 1–2 visible improvements driven by launch feedback and post the changelog (gives a reason for a second wave of posts).
- **Re-post cadence:** a tool can be reposted to a subreddit roughly once a quarter with a genuine update — schedule the next wave around the Play "now live" milestone if it lands after launch week.

---

## 4. Channel sequencing rules (avoid penalties)

- **HN first, always.** It's the highest-signal audience and gives social proof you can reference elsewhere ("also on HN today"). One submission only — never re-submit.
- **Never post identical text to multiple subreddits the same day.** Reddit's spam filters and mods flag cross-posting. Each subreddit gets its own tailored title + body (already written per-sub) and its own day where possible.
- **Don't link-drop your own site in tweet 1** — X throttles link-first posts. Links go in the last tweet / first reply.
- **r/programming and r/programming-adjacent:** only if HN does well and you can frame it as the technical write-up, not a launch ad. High removal risk otherwise; optional.
- **Product Hunt last among the "big" channels** — it benefits from the existing buzz and gives a clean second spike.
- **Discord/forum communities:** participate, don't spam. One genuine post + answer questions. Read each server's self-promo rules first (many have a dedicated #show-and-tell / #projects channel).

**Optimal post times (general):**
- HN: Tue–Thu 08:00–10:00 ET.
- Reddit (US/EU subs): weekday mornings 8–11am ET.
- X: 9–11am or 1–3pm ET weekdays.
- Product Hunt: 12:01am PT.
- dev.to: any weekday morning; it's evergreen.

---

## 5. Additional growth channels (beyond the drafts)

**Directories & lists (evergreen, do once):**
- **AlternativeTo** — list as an alternative to terminal AI tools / mobile dev clients.
- **awesome-selfhosted**, **awesome-android**, **awesome-react-native**, any **awesome-ai-coding / awesome-opencode** list — open PRs.
- **LibHunt** — submit the GitHub repo.
- **F-Droid / IzzyOnDroid** — beyond the self-hosted repo, pursue mainline/IzzyOnDroid inclusion (MR #39530 pending per project memory; chase it). Wider reach than the self-hosted repo alone.
- **OpenSourceAlternative.to**, **Slant**, **SaaSHub** — quick listings.

**Communities to be present in (not spam):**
- **sst/opencode** GitHub Discussions + Discord — your warmest, most relevant audience. Highest-conversion channel by far.
- **Tailscale** community forum / Discord — the "reach your homelab from your phone" story is perfect there.
- **Cloudflare** community + **ngrok** community — same connectivity angle.
- **Expo / React Native** Discord #showcase — the build story.
- **r/ollama**, ollama Discord — local-model angle.

**Content / SEO cadence (T+7 onward, 1/week):**
- "How to reach your self-hosted opencode server from your phone (Tailscale / Cloudflare Tunnel / ngrok)" — captures setup search intent.
- "Running opencode with a local LLM and a mobile UI."
- "Tool-call approval: why human-in-the-loop matters for autonomous coding agents."
- Each canonical-points to the landing page; each embeds the demo video.

**YouTube / demo:**
- 60–90s screen-recorded real session (connect → prompt → stream → diff → approve → done). This is the single most conversion-lifting asset for PH, landing, dev.to, and Reddit. Also cut a 15s vertical clip for X/Shorts.

**SEO basics (mostly done — verify):** sitemap, robots, OG image, IndexNow already live per project memory. Make sure the landing page has the demo video and clear "you need your own server" framing above the fold.

---

## 6. Metrics & realistic targets

**Track (weekly):**
- GitHub: stars, unique clones, release (APK) download counts, issues/PRs opened.
- F-Droid repo: index.json fetches / APK downloads (server logs).
- Play Console (once live): installs, store-listing views, conversion %, crash-free rate, ratings.
- Referral traffic to landing page (GitHub Pages analytics / Plausible if added) by source.
- Per-channel: HN points + rank + comments; Reddit upvotes/comments per sub; PH rank + upvotes; X impressions/engagement; dev.to reads/reactions.

**Realistic targets (a niche dev tool with a self-hosting prerequisite — be honest, this is not a consumer app):**
- **Launch week:** HN front page (top 30) for a few hours = several thousand repo visits; 150–400 GitHub stars; 200–800 APK + F-Droid downloads combined; PH top 10 in Dev Tools for the day.
- **Month 1:** 400–1,000 stars; 1,000–3,000 total installs across F-Droid + APK + Play; a handful of community issues/PRs (a good health signal).
- **Leading indicator that matters most:** retained, returning users (people who connect a server and come back) and inbound issues — both signal real adoption beyond a launch-day spike.

Note: download numbers hinge heavily on Play going live (massively lowers install friction) and on the demo video existing. Both are the biggest levers.

---

## 7. Engagement / response playbook

**Golden rule:** Be the builder, be fast, be honest. On HN especially, the first hour of replies sets the tone and drives the ranking.

**Cadence:** HN — reply within ~1h all day. Reddit — within a few hours. PH — within the hour. X — same day.

**Tone:** technical, humble, no marketing-speak. Concede limitations openly; it builds trust and disarms critics.

**Prep these FAQ answers (paste-ready):**

- **"Do I need my own server? That's a lot of friction."**
  Yes — it's a client for opencode, which you self-host. That's deliberate: your code and API keys never leave your infrastructure, there's no backend of mine to trust, and you can point it at any model including local ones. Setup is two commands. If you already run opencode, it's instant.

- **"Why not just SSH + a terminal app / tmux?"**
  You can, but you lose the structured session UI: no inline diffs, no tool-call approval gate, no clean session switching. The whole point is *steering* the agent (approve/reject actions), not reading raw text.

- **"Is my code / are my keys sent to you?"**
  No. The app talks directly to your server. No proprietary backend, no accounts. Sentry crash reporting is opt-in and off by default; connection secrets live in the Android Keystore.

- **"iOS?"**
  Android only right now. (State it plainly; don't promise iOS unless it's real.)

- **"How does it handle a slow/local model?"**
  Streams token-by-token via SSE with a minimum render interval to avoid UI thrash. Genuinely want feedback on how it feels at low tok/s.

- **"Is it on Google Play / F-Droid main catalog?"**
  Available now via a self-hosted F-Droid repo and direct signed APK. Google Play is in review and going live shortly. Mainline F-Droid/IzzyOnDroid inclusion is in progress.

- **"What models does it support?"**
  Whatever opencode supports — Claude, GPT, Gemini, or any OpenAI-compatible/local endpoint. The app is model-agnostic; opencode handles the provider.

- **"Security of exposing my server?"**
  Use Tailscale (no public exposure) for the safest setup; Cloudflare Tunnel/ngrok give HTTPS if you need public reach. opencode supports a server password. The guide covers this.

**Handling negativity:** Thank, clarify, don't get defensive. If someone finds a real bug, file an issue on the spot and link it — public responsiveness is great marketing.

---

## 8. Cross-references
- Channel posts: `show-hn.md`, `reddit-selfhosted.md`, `reddit-localllama.md`, `reddit-androiddev.md`, `product-hunt.md`, `x-thread.md`, `devto.md`
- Assets status & gaps: `ASSETS.md`

---

## 9. Risk list & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **"I need my own server" friction** turns away casual installers | Lower install→active conversion | Reframe as the feature (privacy, no lock-in, BYO model). Make the guide dead-simple (two commands). Target audiences who already self-host. Don't market to people who want a turnkey chatbot. |
| HN/Reddit reads it as spam or low-effort | Removal, downvotes | Lead with engineering substance, tailor every post per platform, never copy-paste across subs, be present to answer. |
| Play approval slips past launch week | Higher install friction during peak attention | Drafts already say "going live shortly" with swappable `{{PLAY_URL}}`; F-Droid repo + APK carry installs in the meantime; do a "now on Play" follow-up wave when it lands. |
| No demo video at launch | Big conversion loss (this is the #1 gap) | Prioritize the 60–90s demo before T0 (see ASSETS.md). At minimum ship the GIF. |
| Confusion: people think the app *is* the AI / runs models | Wrong expectations, bad reviews | Every post states plainly "you need a running opencode server; the app is a thin client." Keep saying it. |
| Security FUD about exposing a home server | Hesitation | Push Tailscale as the default safe path; mention server password; link the guide. |
| Cross-posting penalties | Shadow-removal, mod bans | Stagger days, unique copy per channel (done). |
| Over-promising (iOS, ratings, "#1") | Trust damage / store policy | Never claim what isn't true. No fake metrics, no other-store claims. iOS = "Android only" plainly. |
| Single-maintainer support load after a spike | Burnout, slow replies hurt rep | Pre-write FAQ answers (§7), triage issues, accept it's a marathon — sustain cadence in §3. |
