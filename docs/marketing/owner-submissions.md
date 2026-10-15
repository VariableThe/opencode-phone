# Owner submission pack — account-gated directories

These directories drive real, durable discovery (organic search + their own audiences) but
**require an owner login / OAuth**, so an agent can't submit them. Everything below is
**paste-and-go**: sign in, copy each field, submit. ~10 minutes each.

> ## ⭐ TOP PRIORITY — IzzyOnDroid is the FASTEST path to the F-Droid goal (Goal #2)
>
> **Why this matters more than the mainline MR:** IzzyOnDroid (`apt.izzysoft.de`) is a
> widely-used F-Droid-protocol repository. Unlike F-Droid mainline, **it does NOT build from
> source — it ships your own signed APK straight from GitHub Releases.** That means it
> *completely bypasses* the Expo prebuilt-binary / reproducible-build wall that made the
> mainline MR (#39530) so slow, and it typically accepts apps in **days, not months**.
> Getting in satisfies goal.md condition (2) "app accepted & available in an F-Droid
> repository" **without waiting on linsui's merge.**
>
> **Our repo already meets every requirement:** MIT (FOSS) ✓, signed APK on GitHub Releases
> (`app-release.apk`, consistent key) ✓, fastlane metadata at
> `fastlane/metadata/android/en-US/` (title, descriptions, changelog `5.txt`, icon, feature
> graphic, 3 phone screenshots) ✓.
>
> **What's needed:** a free Codeberg account (2-min signup at https://codeberg.org/user/sign_up),
> then open ONE issue at **https://codeberg.org/IzzyOnDroid/repodata/issues/new** with the
> template "App Request". Paste:
>
> ```
> Title: [AppRequest] OpenCode Mobile
>
> - App name: OpenCode Mobile
> - Package id: cc.agentlabs.opencode
> - Source code: https://github.com/dzianisv/opencode-mobile
> - License: MIT (FOSS)
> - Releases (signed APK attached to each tag): https://github.com/dzianisv/opencode-mobile/releases
> - Fastlane metadata: yes — fastlane/metadata/android/en-US/ (title, short/full description,
>   changelogs, icon, featureGraphic, phoneScreenshots)
> - UpdateCheckMode equivalent: GitHub Releases, tags vX.Y.Z, APK asset name app-release.apk
> - AntiFeatures: NonFreeNet (connects to a user-self-hosted opencode server which may call
>   proprietary AI APIs). Crash reporting via Sentry is opt-in and OFF by default.
> - Current version: 0.4.4 (versionCode 5)
>
> Open-source Android client for the opencode AI coding agent. Connects to a server the user
> hosts themselves; all model calls use the user's own keys. No ads, no mandatory telemetry.
> ```
>
> After they add it, the install line becomes: add repo `https://apt.izzysoft.de/fdroid/repo`
> in any F-Droid client → search "OpenCode". Add that URL to the website `/download/` page and
> the marketing drafts once live. **Do this first — it's the quickest win on the whole goal.**

---


All URLs are live and verified. Do these **any time** — they don't depend on Google Play
going live. When Play is live, come back and add the Play URL where noted.

**Canonical facts (reuse everywhere):**

| Field | Value |
|---|---|
| Name | OpenCode Mobile |
| Tagline (≤60) | Drive your self-hosted AI coding agent from your phone |
| Category | Developer Tools / AI Coding |
| License | MIT (open source) |
| Platforms | Android (Linux/macOS/Windows for the opencode server) |
| Website | https://dzianisv.github.io/opencode-mobile/ |
| Install page | https://dzianisv.github.io/opencode-mobile/download/ |
| Source | https://github.com/dzianisv/opencode-mobile |
| F-Droid repo | https://dzianisv.github.io/opencode-mobile/fdroid/repo |
| Direct APK | https://github.com/dzianisv/opencode-mobile/releases/latest |
| Google Play | in review — add `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` once live |
| Screenshots | `fastlane/metadata/android/en-US/images/phoneScreenshots/02.png` (diff+approve — best), `03.png`, `01.png` |
| Icon | `distribution/play-graphics/icon-512.png` |
| Pricing | Free |
| Author | VIBE TECHNOLOGIES, LLC |
| Contact | support@agentlabs.cc |

---

## 1. AlternativeTo  → https://alternativeto.net/manage-app/

Highest-value: ranks well in Google for "<tool> alternative" queries.

- **Add as alternative to:** Cursor, GitHub Copilot, Claude Code, Continue.dev, Aider (pick 2–3 most apt)
- **Name:** `OpenCode Mobile`
- **Short description (one line):**
  > Free, open-source Android client for the opencode AI coding agent — run AI coding sessions from your phone against a server you host yourself.
- **Long description:**
  > OpenCode Mobile is a thin Android client for opencode (the open-source AI coding agent CLI). Connect your phone to your own opencode server and run AI-powered coding sessions from anywhere: stream the agent's responses in real time, review file diffs, and approve tool calls before they run. All model calls go through YOUR server and YOUR API keys (Claude, GPT, Gemini, or local LLMs) — nothing routes through third-party infrastructure. MIT licensed, no ads, no mandatory telemetry. Install via F-Droid or a signed APK.
- **License:** Open Source — MIT
- **Platforms:** Android (server: Linux, macOS, Windows, Self-Hosted)
- **Features/tags:** AI, self-hosted, open source, coding assistant, privacy-focused, no-tracking
- **Links:** Website + Source + Install page (above)

## 2. OpenAlternative  → https://openalternative.co/submit

Curated open-source directory; strong SEO + newsletter.

- **Name:** `OpenCode Mobile`
- **Website:** https://dzianisv.github.io/opencode-mobile/
- **Repository:** https://github.com/dzianisv/opencode-mobile
- **Tagline:** Drive your self-hosted AI coding agent from your phone
- **Description:**
  > Open-source Android client for the opencode AI coding agent. Connect to an opencode server you run yourself and code from your phone — real-time streaming, file-diff review, and tool-call approval. Your keys, your code, your infrastructure. MIT licensed.
- **Alternative to:** Cursor, GitHub Copilot, Claude Code
- **Topics:** ai, developer-tools, self-hosted, mobile, react-native, coding-agent

## 3. LibHunt  → https://www.libhunt.com/ (submit via the relevant topic, or the "Suggest" link)

- **Name:** `opencode-mobile`
- **Repo:** https://github.com/dzianisv/opencode-mobile
- **Description:** Free, open-source Android client for the opencode AI coding agent — self-hosted, MIT licensed.
- **Topic/category:** Artificial Intelligence / Developer Tools / Mobile

## 4. Slant  → https://www.slant.co/  (add as an option to existing questions)

Add OpenCode Mobile as an option to questions like:
- "What are the best AI coding assistants?"
- "What are the best self-hosted developer tools?"
- **Option blurb:** Open-source (MIT) Android client for the opencode AI coding agent; self-hosted, bring-your-own-key, with diff review and tool-call approval.

## 5. SaaSHub  → https://www.saashub.com/submit-service

- **Name:** OpenCode Mobile
- **Tagline:** Self-hosted AI coding agent, on your phone
- **Description:** (reuse the AlternativeTo long description)
- **Categories:** Developer Tools, AI, Open Source
- **Alternatives:** Cursor, GitHub Copilot, Claude Code

## 6. Product Hunt  → https://www.producthunt.com/posts/new

Full launch-day kit (tagline, first comment, gallery shot list, maker comment, FAQ) is in
**`product-hunt.md`**. PH is a same-day event — schedule for a Tue–Thu 12:01am PT, ideally
once Play is live so the Play link can be a product link. Don't burn it on a random day.

## 7. Hacker News / Reddit / X / dev.to

Owner-posted social launch — full drafts in `show-hn.md`, `reddit-*.md`, `x-thread.md`,
`devto.md`, sequenced in `CAMPAIGN.md`. These are the single biggest download lever; they
need a logged-in account with some history to avoid auto-flagging.

---

## Already submitted by the agent (no owner action needed — awaiting maintainer merge)

Curated-list PRs are open and rules-compliant:
- tailscale-dev/awesome-tailscale#7
- ai-for-developers/awesome-ai-coding-tools#383
- jondot/awesome-react-native#1207
- mahseema/awesome-ai-tools#1463
- +awesome-cli-coding-agents#107, +awesome-coding-ai#9

If any close as "not merged," that's the maintainer's call — don't resubmit.

---

## Suggested order (highest ROI first)

1. **AlternativeTo** (durable SEO, 10 min)
2. **OpenAlternative** (SEO + newsletter, 10 min)
3. **SaaSHub** + **LibHunt** + **Slant** (15 min total)
4. **Hacker News + Reddit** social launch (see CAMPAIGN.md timing)
5. **Product Hunt** (schedule for a Tue–Thu, ideally after Play is live)

Steps 1–3 don't depend on Play and can be done today.
