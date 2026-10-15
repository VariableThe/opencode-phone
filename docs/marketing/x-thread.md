# X (Twitter) thread — copy-paste ready

> Post as a native thread (write tweet 1, then "add another tweet" for 2–8). Don't paste links in tweet 1 — X suppresses reach on link-first tweets. Put the main link in the last tweet and/or the first reply.
> Best windows: 9–11am ET or 1–3pm ET on weekdays.
> After posting, quote-tweet your own thread later that day linking the HN/PH post for a second impression.
> `{{PLAY_URL}}` = `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` once approved.

---

**Tweet 1 (hook)**
```
I built an Android app that connects to your self-hosted AI coding agent.

Token-by-token streaming. Inline diff viewer. Tool-call approval — from your phone.

OpenCode Mobile. MIT, free, no backend of mine.

🧵
```

**Tweet 2 (the problem)**
```
The problem: opencode runs a long coding session on my server. I leave my desk.

SSH + a terminal loses the session UX. Generic AI chat apps have no concept of file diffs or tool-call approval.

I wanted a real client, not a workaround.
```

**Tweet 3 (how it works)**
```
How it works:

opencode exposes an HTTP + SSE API. The app speaks it — streaming output, session state, diffs, tool calls.

Your code stays on your server. Your provider keys stay on your server. The app is a thin client. No proxy, no middleman.
```

**Tweet 4 (features)**
```
What you get:

→ Watch the agent generate code token by token
→ See every file diff before it's written
→ Approve or reject shell commands + file writes
→ Manage multiple sessions
→ Connect via Tailscale, Cloudflare Tunnel, ngrok, or local network
```

**Tweet 5 (local-model angle)**
```
Works with any model opencode supports: Claude, GPT, Gemini — or local LLMs via any OpenAI-compatible endpoint (ollama, LM Studio, llama.cpp).

Your keys. Your hardware. Your inference budget.
```

**Tweet 6 (OSS / trust)**
```
MIT licensed. No subscription. No ads.

Sentry crash reporting is opt-in and OFF by default. Connection secrets live in the Android Keystore.

Source: github.com/dzianisv/opencode-mobile
```

**Tweet 7 (CTA)**
```
On Android now:

Install (F-Droid + direct APK): dzianisv.github.io/opencode-mobile/download
Setup guide: dzianisv.github.io/opencode-mobile/guide

Google Play going live shortly: {{PLAY_URL}}

If you run opencode, give it a try. Issues + PRs welcome.
```

**Tweet 8 (optional, post as reply for social proof)**
```
Also on Hacker News today if you want the technical deep-dive (SSE polyfill, WebView-free diff renderer, coordinating two async streams for approval):

[paste HN link here after you post Show HN]
```
