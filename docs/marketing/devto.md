---
title: "Drive your self-hosted AI coding agent from your phone"
published: true
tags: [android, selfhosted, ai, devtools]
cover_image: https://dzianisv.github.io/opencode-mobile/play-graphics/feature-graphic.png
canonical_url: https://dzianisv.github.io/opencode-mobile/
---

> Publish on dev.to a day or two AFTER the HN/Reddit launch — it's evergreen SEO, not a same-day play. Set `canonical_url` to the landing page so the landing page gets SEO credit. Swap `cover_image` for a hosted hero/feature graphic before publishing. Replace `{{PLAY_URL}}` with the Play link once approved.

I run [opencode](https://github.com/sst/opencode) — an open-source AI coding agent — on my home server. It connects to Claude or GPT via my own API keys and edits code through tool calls: reading files, writing diffs, running shell commands.

The workflow works well at my desk. Away from my desk, I had nothing useful. SSH into a terminal app loses the structured session UI. Generic AI chat apps know nothing about file diffs or tool-call approval. I wanted to actually *steer* a running session from my phone, not just read raw text output.

So I built OpenCode Mobile.

## What it is

OpenCode Mobile is a React Native / Expo Android app. It's a thin client for the opencode HTTP + SSE API — no backend of mine between your phone and your server.

You run opencode in server mode:

```bash
npm install -g opencode-ai
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

Then in the app you paste the server URL — a local network IP, a Tailscale address, a Cloudflare Tunnel URL, whatever you already use to reach that machine. The app connects, lists your sessions, and streams output in real time.

## What the UI gives you

**Streaming chat.** Responses come in token by token via SSE — the same stream you'd see in the terminal, rendered in a mobile chat UI.

**Diff viewer.** When the agent proposes a file change, you see an inline line-level diff — green additions, red removals — before the write happens.

**Tool-call approval.** opencode pauses before executing file writes, shell commands, or other destructive actions and waits for explicit approval. The app surfaces this as a bottom sheet: approve or reject, and the agent proceeds or stops. This is the feature I personally find most useful — start a session, walk away, and only get pulled back when the agent needs a decision.

**Session management.** Create, resume, switch between sessions.

**Biometric unlock.** Face/fingerprint gates both app-open and individual message sends.

## How it connects

- **Local network** — phone and server on the same Wi-Fi
- **Tailscale** — Tailscale IP works out of the box, no port forwarding
- **Cloudflare Tunnel** — `cloudflared tunnel` gives you a public HTTPS URL
- **ngrok** — same idea

Each saved connection is stored in the Android Keystore via `expo-secure-store`. The URL and password never leave the device except to reach your server directly.

## Model support

opencode connects to whatever provider you configure: Anthropic Claude, OpenAI GPT, Google Gemini, or any local model behind an OpenAI-compatible API (ollama, LM Studio, llama.cpp). The mobile app doesn't care — it talks to opencode, and opencode talks to your model. Your API keys stay on your server.

## Technical notes for the curious

The trickiest part was SSE streaming. React Native lacks a native `EventSource`. The standard web polyfill mostly works, but Android's OkHttp follows redirects and drops the `Accept: text/event-stream` header on the hop, which breaks reconnects against tunneled servers. The fix is a custom fetch wrapper that sets the header on every hop and manages reconnect/backoff.

The diff viewer is a custom line-level parser feeding a `FlatList`, not a WebView. This keeps dark-mode theming consistent and avoids the overhead of a full browser engine for rendering `+/-` lines.

Tool-call approval required coordinating two async streams: the inbound SSE stream and the outbound user response. The solution is a React Query mutation that fires on approval plus an optimistic UI update that unblocks the stream client-side while the server confirms.

## Open source

MIT licensed. Source at [github.com/dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile). Issues and PRs welcome.

Install ([all options on one page](https://dzianisv.github.io/opencode-mobile/download/)): add the self-hosted F-Droid repo `https://dzianisv.github.io/opencode-mobile/fdroid/repo` in your F-Droid client, or grab the [direct APK](https://github.com/dzianisv/opencode-mobile/releases/latest). Google Play is in review and going live shortly: {{PLAY_URL}}

Landing page and setup guide: [dzianisv.github.io/opencode-mobile](https://dzianisv.github.io/opencode-mobile/)

If you run opencode and try it, I'm especially interested in feedback on latency with local models — the streaming UI has a minimum render interval to avoid thrashing, and I don't know where that threshold feels wrong on slow hardware.
