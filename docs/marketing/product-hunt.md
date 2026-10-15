# Product Hunt — copy-paste ready

> **Launch timing:** Submit at 12:01am PT. PH ranks by upvotes-per-day and the leaderboard resets at midnight PT, so launching the second the day opens maximizes your window. Avoid launching the same day as a huge consumer product (check the upcoming page first). Tue/Wed/Thu tend to be calmer than Mon.
> **Hunter:** self-hunt is fine; a hunter with reach is a bonus but not required.
> **First comment must be posted by you within the first minute** — it sets the narrative.
> `{{PLAY_URL}}` = `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` once approved (PH lets you add the Play link as a product link on the day it goes live).

---

## Name

```
OpenCode Mobile
```

## Tagline (60 chars max)

```
Drive your self-hosted AI coding agent from your phone
```
(54 chars)

## Topics / categories

`Developer Tools` · `Android` · `Open Source` · `Artificial Intelligence`

## Links

- Website (primary): https://dzianisv.github.io/opencode-mobile/
- Install (F-Droid + APK, one page): https://dzianisv.github.io/opencode-mobile/download/
- GitHub: https://github.com/dzianisv/opencode-mobile
- F-Droid repo: https://dzianisv.github.io/opencode-mobile/fdroid/repo
- Direct APK: https://github.com/dzianisv/opencode-mobile/releases/latest
- Google Play: {{PLAY_URL}}  *(add on launch day once approved)*

---

## Description

OpenCode Mobile is the Android client for [opencode](https://github.com/sst/opencode) — the open-source AI coding agent. Connect to your own opencode server over local Wi-Fi, Tailscale, Cloudflare Tunnel, or ngrok, and control AI-powered coding sessions from anywhere.

You get token-by-token streaming output, a full inline diff viewer for every file change the agent proposes, and an explicit tool-call approval UI so you decide what gets written or executed. Your code, your API keys, your server — the app is a pure thin client that never proxies your traffic through any backend of ours.

Free and MIT licensed. No subscription, no ads, no telemetry you didn't opt into.

---

## First Comment (Maker Comment — post within 60 seconds)

Hey Product Hunt! I'm the developer of OpenCode Mobile.

I built this because I run long opencode sessions on my home server and needed a way to check in from my phone — not just to read output, but to actually approve tool calls and steer the agent. Terminal apps over SSH lose the session structure. Generic AI chat apps have no concept of file diffs or tool calls. So I built a proper native client.

A few things worth knowing:

- It's a client for [opencode](https://github.com/sst/opencode) (by the sst team, MIT). You need opencode running somewhere — laptop, home server, VPS. Setup is `npm install -g opencode-ai && opencode serve`, then paste the URL into the app.
- Connect however you already reach home: local network, Tailscale, Cloudflare Tunnel, ngrok.
- Works with any model opencode supports: Claude, GPT, Gemini, or local LLMs via any OpenAI-compatible endpoint. Your keys stay on your server.
- MIT licensed, source public. Available now via a self-hosted F-Droid repo and a direct APK; Google Play is in review and going live shortly.

Happy to answer anything — especially about the SSE streaming + tool-call approval flow, which was the trickiest part to get right. Thanks for checking it out!

---

## Gallery shot list (produce before launch — see ASSETS.md)

1080×1920 portrait, dark theme, real app UI — no mockups:

1. **Connection setup** — "Add Connection" with URL + password fields. Caption: "Connect to your own opencode server."
2. **Active streaming session** — response mid-generation. Caption: "Token-by-token streaming from your server."
3. **Diff viewer** — inline diff with green/red lines. Caption: "Review every file change before it lands."
4. **Tool-call approval** — bottom sheet, pending shell command. Caption: "You approve every action the agent takes."
5. **Session list** — multiple named sessions. Caption: "All your coding sessions in one place."
6. **Hero / thumbnail** (1270×760) — dark bg (#0F172A), icon left, device showing streaming chat right, headline: "AI Coding Agent. In Your Pocket."
