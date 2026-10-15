# oc-phone-tools

Workstation-side half of QR-code onboarding for the oc-phone app. Prints a
terminal QR code containing everything the phone app needs to add this
workstation as a connection in one scan. (The app-side scanner is a separate
task; this repo only defines the contract and produces the code.)

Install: `~/.local/bin/oc-phone-qr` is a **symlink** to `oc-phone-qr` in this
directory — this repo stays the source of truth.

## Quick start

Three one-command setups (each safe to re-run; `--help` on any of them):

```sh
# Everything, first time (phone plugged in, USB debugging on):
bash ~/Projects/oc-phone-tools/scripts/setup-all.sh

# PC side only (prereqs, credentials, boot-persistence units):
bash ~/Projects/oc-phone-tools/scripts/setup-host.sh

# Phone side only (install APK + permissions over adb):
bash ~/Projects/oc-phone-tools/scripts/setup-device.sh
```

`setup-all.sh` checks a phone is attached, runs the host setup, then the
device setup, and prints the "you're done, here's how to connect" summary.
All three use `set -euo pipefail`, coloured section output, never install
system packages (user-local only — otherwise they print the exact command
for you), and never print secrets unless you pass `--show-secrets`
(`--qr` renders the onboarding QR, which embeds live credentials — private
screen only).

## Setup scripts (what each does)

- `scripts/setup-host.sh` — the PC side: verifies user-local prerequisites
  (node ≥ 22, npm, curl, openssl, tailscale; ntfy binary at `~/opt/ntfy`,
  installing it user-locally if absent; bridge `npm install` only if
  `node_modules/.bin/tsx` is missing), creates `~/.config/oc-phone/env`
  filling in **only** missing keys (existing secrets are never overwritten;
  `OC_BRIDGE_HOST` is re-synced to the live Tailscale IPv4), verifies the
  theme files the bridge serves (`~/.config/opencode/tui.json` +
  `~/.config/opencode/themes/<name>.json`), installs + enables the
  `systemd --user` units below (starting them only if their ports are
  free — never a second copy), then prints connection details.
- `scripts/setup-device.sh` — the phone side: finds adb (`PATH`,
  `~/Android/Sdk/platform-tools`, `$ANDROID_HOME`/`$ANDROID_SDK_ROOT`),
  requires one attached + authorized device (`--serial=` selects;
  fails clearly if zero or several), `adb install -r` the APK (default:
  `~/Projects/opencode-phone/android/app/build/outputs/apk/debug/app-debug.apk`,
  `--apk=` overrides), verifies via `pm list packages`, grants
  `CAMERA` (required, QR scanner) and `POST_NOTIFICATIONS`/appops
  (best-effort), prints confirmation.
- `scripts/setup-all.sh` — first-time flow: fails fast with no authorized
  device on adb, then host setup, then device setup, then the final
  summary. Pass-through: `--apk=`, `--serial=`, `--qr`, `--show-secrets`.

## Boot persistence (systemd --user)

`systemd/oc-phone-server.service` (opencode serve, Tailnet IP `:4096`) and
`systemd/oc-phone-bridge.service` (bridge, Tailnet IP `:8787`) mirror the
existing `ntfy.service` conventions (journal logs, `Restart=on-failure`,
`WantedBy=default.target`, enabled + user linger so they start after boot).
Both resolve the Tailscale IPv4 **at start time** (`tailscale ip -4`), so a
changed Tailnet IP is picked up by `systemctl --user restart <unit>` with
no unit edit — just re-run `setup-host.sh` afterwards to re-sync
`OC_BRIDGE_HOST` in the env file (which `oc-phone-qr` reads).

```sh
systemctl --user is-enabled oc-phone-server oc-phone-bridge
systemctl --user status oc-phone-server oc-phone-bridge
journalctl --user -u oc-phone-server -u oc-phone-bridge -f
```

Relationship with `oc-phone-up` / `oc-phone-down`: the **units own the
services at boot**; the manual scripts are for ad-hoc use. `oc-phone-up`
never starts a second copy on an occupied port (safe no-op when the units
serve), prints a hint when units are active, and `oc-phone-down` only
stops pidfile-recorded manual copies — never unit-managed processes (it
says when units are still enabled). To hand the ports to the units:
`oc-phone-down`, then `systemctl --user start oc-phone-server
oc-phone-bridge`.

Disable boot start (uninstall the persistence, keep everything else):

```sh
systemctl --user disable --now oc-phone-server oc-phone-bridge
```

## Reinstalling the app after a code change

The app source (`opencode-phone`) is untouched by these scripts. After a
code change, rebuild the debug APK, then just re-run the device script
(`install -r` keeps app data):

```sh
cd ~/Projects/opencode-phone && ./gradlew assembleDebug
bash ~/Projects/oc-phone-tools/scripts/setup-device.sh
```

Verify on demand: `adb shell pm list packages | grep cc.agentlabs.opencode`.

## How the phone connects

Phone + PC on the same Tailnet. On a **private** screen run `oc-phone-qr`
(colour/section flags: `--small`, `--no-secrets`, `--print-payload`,
`--force`) and scan the QR in the app — it carries the server URL
(`http://<tailscale-ip>:4096`), bridge URL (`:<8787>`), credentials, and
default project dir. Or add the connection manually with the same values.

## Requirements

- Credentials/config at `~/.config/oc-phone/env` (bare `KEY=value` assignments,
  **no `export`** — the script sources it under `set -a` so children inherit it).
  Keys: `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`,
  `OC_BRIDGE_TOKEN`, `OC_BRIDGE_HOST`, `OC_BRIDGE_PORT`, `OC_BRIDGE_ALLOWED_ROOTS`
  (comma-separated).
- `node` + `npx` (for QR rendering), `curl` (for the health check).
- `opencode serve` on `<host>:4096` and the bridge on `<host>:8787`
  (start with `oc-phone-up`).

## Usage

```sh
oc-phone-qr                         # check server, print summary + QR
oc-phone-qr --print-payload         # also print the ocphone:// URL (debugging)
oc-phone-qr --no-secrets            # omit password + bridgeToken (shared spaces)
oc-phone-qr --small                 # compact QR  (--ascii is an alias)
oc-phone-qr --force                 # print QR even if the health check fails
oc-phone-qr --host=<TAILSCALE-IP> --server-port=4096 --bridge-port=8787 \
  --dir=~/Projects --name=myserver
```

Env overrides (CLI flags win): `OC_PHONE_HOST`, `OC_PHONE_SERVER_PORT`,
`OC_PHONE_BRIDGE_PORT`, `OC_PHONE_DIR`, `OC_PHONE_NAME`, `OC_PHONE_ENV_FILE`.

Worked examples:

```sh
# Normal onboarding on a private screen:
oc-phone-up && oc-phone-qr

# Café / shared screen — secrets stay out of the QR; type them into the app:
oc-phone-qr --no-secrets

# Narrow terminal:
oc-phone-qr --small

# Debugging what the app will receive (careful: prints secrets):
oc-phone-qr --print-payload --force | head -c 300
```

## Payload contract (frozen: v1)

The QR encodes a URI so the OS/app can route it to the app:

```
ocphone://connect?v=1&d=<base64url(JSON)>
```

- `v=1` (query) — contract version. App MUST reject anything else.
- `d` — base64url (RFC 4648 §5: `-`/`_` alphabet, **no padding**) of the
  UTF-8 JSON object below. MUST be URL-safe with no `+`, `/`, `=` characters.
- JSON object (key order not significant, but the encoder emits this order):

  | key                | type   | required | notes                                      |
  |--------------------|--------|----------|--------------------------------------------|
  | `v`                | number | yes      | Always `1`.                                |
  | `name`             | string | yes      | Connection label. Your Tailscale self hostname (e.g. `myserver`), else `hostname -s`. |
  | `url`              | string | yes      | Opencode server URL, e.g. `http://<TAILSCALE-IP>:4096`. |
  | `username`         | string | yes      | HTTP basic-auth username.                  |
  | `password`         | string | no       | HTTP basic-auth password. ABSENT with `--no-secrets`. |
  | `bridgeUrl`        | string | yes      | Bridge URL, e.g. `http://<TAILSCALE-IP>:8787`. |
  | `bridgeToken`      | string | no       | Bridge bearer token. ABSENT with `--no-secrets`. |
  | `defaultProjectDir`| string | yes      | First entry of `OC_BRIDGE_ALLOWED_ROOTS` unless overridden. |

- App-side decode steps: (1) check scheme `ocphone://` + host `connect`;
  (2) check query `v=1`; (3) base64url-decode `d` (add `=` padding as needed);
  (4) `JSON.parse`; (5) check `v === 1` and required string fields;
  (6) if `password`/`bridgeToken` are absent, prompt the user for them.
- v1 is frozen. Any future change (new keys, new auth) bumps `v` and both
  query and JSON versions together; old apps reject unknown `v`.

Reference decoder (independent implementation + contract tests):
`test-roundtrip.mjs` — `node test-roundtrip.mjs --self-test`.

## Flags

| Flag | Effect |
|------|--------|
| `--no-secrets` | Drop `password` and `bridgeToken` keys entirely; user types them into the app. |
| `--print-payload` | Print the `ocphone://` URL to stdout (for debugging). |
| `--small` / `--ascii` | Compact half-block QR for narrow terminals (default is full-size ANSI blocks). |
| `--force` | Print the QR even when the `GET /api/info` health check fails. |
| `--host=` / `--server-port=` / `--bridge-port=` / `--dir=` / `--name=` | Override host/ports/dir/label. |
| `-h` / `--help` | Help. |

Before printing, the script performs an authenticated `GET /api/info`
(basic auth) against the server. Non-200 → clear warning + exit 1 unless
`--force`.

## Security warning

The default QR encodes **live credentials** (server password + bridge token —
both high-entropy secrets granting code-execution-adjacent access to this
workstation). Treat a displayed QR like a pasted password:

- Never display it on a shared screen, stream, recording, or screenshot it
  into chat (any camera frame can capture it).
- In shared spaces use `--no-secrets` and enter the two secrets into the app
  by hand.
- Anyone holding a photo of the QR owns the credentials — if exposed,
  regenerate `OPENCODE_SERVER_PASSWORD` and `OC_BRIDGE_TOKEN` and re-run
  `oc-phone-up`.

## Tests

```sh
node test-roundtrip.mjs --self-test            # no secrets needed
oc-phone-qr --print-payload | xargs -0 node test-roundtrip.mjs  # real payload
# (simpler: node test-roundtrip.mjs "$(oc-phone-qr --print-payload 2>/dev/null)")
```

## QR rendering approach

`npx --yes qrcode-terminal` (npm package `qrcode-terminal@0.12.0`), no system
packages installed. Two gotchas handled in-script: the package's CLI only
honours argv when stdin is a TTY, so the payload is **piped via stdin**; and
`--small` reaches the package's `{small:true}` API through the npx-installed
copy (`npx -p qrcode-terminal -c 'node -e …'` resolving `lib/main.js` next to
the installed bin) because the CLI exposes no small flag. Nothing vendored.
