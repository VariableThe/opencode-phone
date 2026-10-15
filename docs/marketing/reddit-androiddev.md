# r/androiddev — copy-paste ready

> **Subreddit:** r/androiddev (~250k+ members, professional Android engineers)
> **Flair:** `Open Source` if available; otherwise `Showcase` / `App Showcase`. NOTE: r/androiddev is strict — pure "check out my app" promo posts get removed. This must read as an **engineering write-up**, not an ad. The framing below leads with the hard technical problems (SSE polyfill, custom diff renderer, async stream coordination), which is what survives moderation here.
> **Rules that matter here:** No low-effort self-promo; Showcase posts must include technical substance. Don't open with download links — open with the engineering. Put install links at the bottom. Be ready to discuss code.
> **Best time:** Weekday mornings ET. This sub also has a recurring "Anything Goes / App Feedback Thread" — if your standalone post is borderline, the weekly thread is a safe fallback.
> `{{PLAY_URL}}` = `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` once approved.

---

**Title:**

```
Building a streaming AI-agent client in RN/Expo: SSE polyfill quirks, a WebView-free diff viewer, and coordinating two async streams for tool-call approval
```

**Body:**

I just shipped OpenCode Mobile (open source, MIT) — an Android client for the [opencode](https://github.com/sst/opencode) AI coding agent. opencode runs as a CLI/server with an HTTP + SSE API; the app speaks that API and gives sessions a native UI. A few implementation problems were interesting enough to write up.

**1. SSE on React Native.** RN has no native `EventSource`. The web polyfill mostly works, but Android's OkHttp follows redirects and drops the `Accept: text/event-stream` header on the hop, which silently breaks reconnects against tunneled servers (Cloudflare/ngrok love to redirect). Fix was a custom fetch wrapper that re-sets the header on every hop and handles reconnect/backoff manually.

**2. Diff viewer without a WebView.** I render line-level diffs with a custom parser feeding a `FlatList` rather than embedding a WebView. Keeps dark-mode theming consistent with the rest of the app, avoids the memory/startup cost of a browser engine, and makes long diffs scroll cleanly.

**3. Tool-call approval = coordinating two async streams.** opencode pauses before destructive actions (file writes, shell commands) and waits for approval. So you have the inbound SSE stream and an outbound user decision that must rendezvous. I model it as a React Query mutation fired on approval plus an optimistic UI update that unblocks the stream client-side while the server confirms. Surfaced as a bottom sheet that interrupts the stream.

**Stack:** Expo SDK 54, TypeScript, React Query for server state, Zustand for local state, `expo-local-authentication` for biometric gating (app-open + per-send), `expo-secure-store` (Android Keystore) for connection secrets, Sentry (opt-in, off by default), signed AAB on every tag via GitHub Actions + EAS.

Source: https://github.com/dzianisv/opencode-mobile

Install / try it: https://dzianisv.github.io/opencode-mobile/download/ · F-Droid repo: https://dzianisv.github.io/opencode-mobile/fdroid/repo · APK: https://github.com/dzianisv/opencode-mobile/releases/latest · Google Play: in review — {{PLAY_URL}}

Happy to get into any of it — the SSE + approval coordination was the part I rewrote the most.
