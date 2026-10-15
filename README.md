# opencode-phone — run opencode from your Android phone

Use your [opencode](https://opencode.ai) AI coding agent from an Android
phone, over your own [Tailscale](https://tailscale.com) network. Nothing goes
through a third-party cloud: the phone talks directly to your workstation.

This repo is the whole system in one place: the **phone app** (repo root)
plus the **workstation-side companion tooling** under `tools/`.

## Architecture

```
┌──────────────┐  Tailnet (encrypted)   ┌─────────────────────────┐
│  Android app │ ◄────────────────────► │  your workstation       │
│              │  :4096 opencode serve  │                         │
│  scan QR to  │  :8787 bridge (tmux/   │  opencode serve :4096   │
│  onboard in  │        fs/theme)       │  oc-phone-bridge :8787  │
│  one tap     │  :2586 ntfy (optional) │  ntfy :2586 (optional)  │
└──────────────┘                        └─────────────────────────┘
```

- The app chats with `opencode serve` (HTTP + SSE) for sessions and messages.
- `tools/oc-phone-bridge` is a small sidecar API for things the opencode
  server doesn't expose: listing/creating/killing **tmux** sessions, peeking
  at terminal output, reading files under allowed roots, serving the opencode
  theme. (REST + bearer token; interactive PTY streaming arrives later —
  the app's terminal view currently needs an **opencode v2** server.)
- `tools/oc-notify` is an opencode plugin that POSTs to a self-hosted
  **ntfy** server when an agent needs approval, finishes, or errors — your
  phone buzzes even with the app closed.
- `tools/oc-phone-tools` holds the one-command setup scripts, `systemd
  --user` units (start server + bridge at boot), and `oc-phone-qr`, which
  prints a QR code that onboards the phone in one scan.

## What's where

| Path | What | Details |
| --- | --- | --- |
| repo root | The Expo / React Native Android app (`cc.agentlabs.opencode`) | [docs/app-readme.md](docs/app-readme.md) (the app's own readme) |
| `tools/oc-phone-bridge` | Workstation sidecar API (tmux/fs/theme) | [tools/oc-phone-bridge/README.md](tools/oc-phone-bridge/README.md) |
| `tools/oc-notify` | opencode → ntfy notification plugin | [tools/oc-notify/README.md](tools/oc-notify/README.md), [install](tools/oc-notify/INSTALL.md) |
| `tools/oc-phone-tools` | Setup scripts, systemd units, QR onboarding | [tools/oc-phone-tools/README.md](tools/oc-phone-tools/README.md) |

## Prerequisites

- A workstation (Linux) and an Android phone on the **same Tailnet**.
- On the workstation: `node` ≥ 22, `tailscale`, `tmux`, `opencode` CLI,
  `curl`, `openssl`, `adb` (for installing the app over USB).
- Optional: `ntfy` (the setup script installs it user-locally if missing).

## One-command setup

Plug the phone in (USB debugging on), then on the workstation:

```sh
bash tools/oc-phone-tools/scripts/setup-all.sh
```

This is safe to re-run. It verifies prerequisites, creates
`~/.config/oc-phone/env` (filling in **only** missing keys — existing
secrets are never overwritten, and the Tailscale IP is re-synced), installs
and enables `systemd --user` units for the server and bridge, installs the
debug APK over adb, grants camera/notification permissions, and prints a
"you're done" summary. Host-only and device-only variants:
`scripts/setup-host.sh`, `scripts/setup-device.sh`.

Credentials live in `~/.config/oc-phone/env` (bare `KEY=value`, no
`export`): `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`,
`OC_BRIDGE_TOKEN`, `OC_BRIDGE_HOST`, `OC_BRIDGE_PORT`,
`OC_BRIDGE_ALLOWED_ROOTS`. **That file is never committed** — it is not in
this repo and never will be.

## How the phone connects

Phone and workstation must be on the same Tailnet. On a **private** screen
run `oc-phone-qr` (symlinked to `tools/oc-phone-tools/oc-phone-qr`) and scan
the QR in the app — it carries the server URL (`http://<tailscale-ip>:4096`),
bridge URL (`:<8787>`), credentials, and default project dir. Or add the
connection by hand with the same values (app → Connections → add).

The QR encodes live credentials — treat a displayed QR like a pasted
password. On shared screens use `oc-phone-qr --no-secrets` and type the two
secrets into the app manually.

## Build / reinstall the app after a code change

```sh
# Terminal 1 — Metro bundler
npm install
npx expo start

# Android (emulator or plugged-in device)
npx expo run:android
```

Or the Gradle path used by the setup scripts (from the repo root):

```sh
cd android && ./gradlew assembleDebug
bash tools/oc-phone-tools/scripts/setup-device.sh   # adb install -r, keeps app data
```

Typecheck: `npm run typecheck`. Tests: `npm test`
(`node --test` over `src/**/*.test.ts`).

## Known limitations

- **Background notifications are best-effort.** Android throttles background
  work; the app has periodic re-checks plus an optional foreground service
  and optional ntfy push, but timely delivery with the app closed is not
  guaranteed (see status below).
- **Terminals need opencode v2.** The terminal view speaks the v2 PTY API;
  against a v1 server it is unavailable.
- **Plain HTTP inside the Tailnet only.** The server and bridge serve HTTP
  without TLS, which is acceptable only inside the encrypted Tailscale
  tunnel. Never expose them to the open internet.
- **QR holds live secrets** (see above).

## Status — what's verified vs unverified

Verified (test suites run 2026-10-15, all passing):

- App: **536/536** `node --test` assertions pass.
- Bridge: **56/56** tests pass (`npm test`).
- Notify plugin: **25/25** tests pass (`npm test`).
- QR payload contract: **4/4** round-trip self-test vectors pass
  (`node test-roundtrip.mjs --self-test`), plus the app-side
  encode/decode round-trip tests.

Unverified / honest gaps:

- **On-device notification behaviour is unverified** — ntfy → phone and
  background/foreground-service delivery have not been confirmed on a real
  device end to end.
- No Play release build has been cut from this tree (debug APK path only).

## License / attribution

MIT — see [LICENSE](LICENSE). The app is a fork of
[`dzianisv/opencode-mobile`](https://github.com/dzianisv/opencode-mobile);
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) records an Apache-2.0 notification
design adapted from
[`alvarolorentedev/opencode-mobile`](https://github.com/alvarolorentedev/opencode-mobile)
(design only — no code or artwork reused).
