# Show HN — copy-paste ready

> Post once. HN allows a single submission per project. Tue–Thu, 8:00–10:00am US Eastern is the sweet spot.
> `{{PLAY_URL}}` = swap in `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` on the day Play approval lands. Until then, leave the Play line exactly as written below.

---

**Title (use exactly — under 80 chars, no emoji, no "free"):**

```
Show HN: OpenCode Mobile – drive your self-hosted AI coding agent from your phone
```

**URL field:** `https://github.com/dzianisv/opencode-mobile`

---

**Text (paste into the "text" box if you submit as a text post; otherwise post as the first comment immediately after submitting):**

Hey HN,

I built a React Native / Expo Android app that lets you control a running [opencode](https://github.com/sst/opencode) session from your phone.

**What it does**

opencode (sst/opencode, MIT) is a terminal-based AI coding agent — you run it on your laptop or a server, it talks to Claude / GPT / Gemini / local models via your own API keys, and it writes, edits, and runs code through tool calls. OpenCode Mobile is a thin HTTP + SSE client that connects to that server process. From your phone you can:

- Watch token-by-token streaming output as the agent reasons and codes
- Review inline file diffs before they're written
- Approve or reject tool calls (file writes, shell commands) in real time
- Start, resume, and switch between sessions
- Connect over local Wi-Fi, Tailscale, Cloudflare Tunnel, or ngrok

**Why I built it**

I run long opencode sessions that outlast my desk time. I wanted to check in from the couch, approve a tool call, and let the agent keep going. The alternatives — SSH + a terminal app, or generic Claude/GPT chat apps — lose the structured session state: no diffs, no tool-call gating. The opencode HTTP API was already there; the phone just needed a real client.

**How it's built**

- React Native + Expo SDK 54, TypeScript throughout
- SSE streaming via an `EventSource` polyfill (RN has no native one); needed patching because Android's OkHttp drops the `Accept: text/event-stream` header across redirects, which breaks reconnects
- Diff rendering with a custom line-level parser into a FlatList — no WebView, so dark-mode theming stays consistent and it's cheap to render
- Biometric auth via `expo-local-authentication` gates app-open and individual sends
- Connection secrets in the Android Keystore via `expo-secure-store`
- CI builds a signed AAB on every tag via GitHub Actions + EAS

**What it is not**

Not a standalone AI model and not a code editor. You need a running opencode server. If you already use opencode, setup is:

```
npm install -g opencode-ai
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

…then paste the URL into the app. Your API keys stay on your server; nothing proxies through any backend of mine.

**Status / privacy**

Stable on Android, MIT licensed. No accounts, no ads. Sentry crash reporting is opt-in and off by default. Install today via a self-hosted F-Droid repo or a direct signed APK. Google Play is in review and should be live shortly — {{PLAY_URL}} (currently in review; until then use the links below).

- Source: https://github.com/dzianisv/opencode-mobile
- Install (F-Droid + APK, one page): https://dzianisv.github.io/opencode-mobile/download/
- Landing page: https://dzianisv.github.io/opencode-mobile/
- Setup guide: https://dzianisv.github.io/opencode-mobile/guide/
- F-Droid repo (add this URL in an F-Droid client): https://dzianisv.github.io/opencode-mobile/fdroid/repo
- Direct APK: https://github.com/dzianisv/opencode-mobile/releases/latest

Happy to answer questions about the SSE streaming implementation, the Expo build pipeline, or the opencode API surface.
