# oc-notify — OpenCode → ntfy phone notifications (server side)

When a coding agent on this machine is blocked — asking for approval,
finishing a turn, or erroring — this OpenCode plugin POSTs a small JSON
notification to a self-hosted [ntfy](https://ntfy.sh) topic. Your phone
(subscribed to that topic) buzzes. The phone-app receiver is a separate
project; this repo is the server-side half only.

## How it works

```
opencode event (permission / idle / error)
  → plugins/notify.ts  (OpenCode plugin, runs inside opencode)
  → POST https://<ntfy-host>/  {topic, message=<envelope JSON>, title, priority, tags}
  → ntfy topic  →  phone app
```

Wire format: the structured envelope
`{type, server, sessionID, title, message, at}` travels **JSON-encoded inside
the ntfy `message` field** — the only structured carrier ntfy preserves
verbatim (unknown top-level fields are silently dropped by the server; the
`click` field survives but holds a single URL and the frozen app parser does
not read it). The ntfy-level `title` stays human-readable
(`[server] Permission needed`, …).

Trade-off: stock ntfy clients (e.g. the plain ntfy Android app) display the
raw JSON as the message body instead of prose. The human-readable text is
still inside the envelope's own `title`/`message` fields and in the ntfy
`title`, but anyone reading the stock app sees JSON, not a pretty sentence.
This is the price of machine-readable deep-linking (`sessionID`) through a
server that strips unknown fields.

The plugin subscribes to three OpenCode events:

| OpenCode event      | Notification              | ntfy priority |
|---------------------|---------------------------|---------------|
| `permission.updated`| Agent is asking approval  | high (4)      |
| `session.idle`      | Agent finished a turn     | default (3)   |
| `session.error`     | Session reported an error | high (4)      |

Spam guards: permission ids are deduped (ask + reply fire only once);
idle/error are rate-limited to one per session per 30 s.

## Privacy

The POST body contains the ntfy routing fields (`topic`, `title`,
`priority`, `tags`) plus the envelope `{type, server, sessionID, title,
message, at}` **JSON-encoded in `message`** (ntfy strips unknown top-level
fields, so the envelope cannot ride along as extra keys — identical copies
are still sent as forward-compat but nothing relies on them). No file
contents, prompts, tool arguments, or secrets ever leave the machine. Error
messages are truncated to 160 chars, other messages to 200. Permission ids
are used for local dedupe only and are never sent.

## Env vars

| Var              | Required | Example                              |
|------------------|----------|--------------------------------------|
| `NTFY_URL`       | yes      | `http://<TAILSCALE-IP>:2586`            |
| `NTFY_TOPIC`     | yes      | `oc-9f3a-...` (unguessable!)         |
| `NTFY_TOKEN`     | no       | `tk_...` (Bearer, if ntfy needs auth)|
| `OC_SERVER_NAME` | no       | `rig` (default: `workstation`)       |

If `NTFY_URL`/`NTFY_TOPIC` are unset, the plugin is a silent **no-op** — it
sends nothing and can never break a coding session (all errors swallowed,
5 s fetch timeout).

These must be visible in the **opencode server process** environment, e.g.:

```sh
# ~/.bashrc (or wherever your shell reads on login)
export NTFY_URL="http://<TAILSCALE-IP>:2586"
export NTFY_TOPIC="oc-<your-secret-topic>"
export OC_SERVER_NAME="workstation"
```

then restart opencode. Env is read on every event, so changing it does not
require reinstalling the plugin — just restart opencode.

If you start opencode via `~/.local/bin/oc-phone-up`, it forwards
`NTFY_URL` / `NTFY_TOPIC` / `NTFY_TOKEN` / `OC_SERVER_NAME` from
`~/.config/oc-phone/env` into the `opencode serve` child automatically —
no `~/.bashrc` entries needed on that path.

## Install

See [INSTALL.md](INSTALL.md). Short version (global install, reversible):

```sh
mkdir -p ~/.config/opencode/plugins
ln -s <checkout>/tools/oc-notify/plugins/notify.ts ~/.config/opencode/plugins/oc-notify.ts
```

Then host ntfy: `./setup-ntfy.sh` (check mode, prints next steps),
`./setup-ntfy.sh --install`, `./setup-ntfy.sh --write-unit`.

## Test

```sh
npm test   # node --test test/*.test.ts, no build step, no dependencies
```

End-to-end curl check (needs ntfy running; see INSTALL.md):

```sh
curl -d '{"topic":"<your-topic>","message":"hello from oc-notify","title":"[rig] test","priority":3,"tags":["opencode"]}' \
  http://<TAILSCALE-IP>:2586/
```

## Layout

- `plugins/notify.ts` — the OpenCode plugin (event wiring, no-op + never-throw guards)
- `src/payload.ts` — pure, dependency-free payload/config builders (unit-tested)
- `test/payload.test.ts`, `test/plugin.test.ts` — `node --test` suites (plugin tests hit a real local HTTP stub)
- `setup-ntfy.sh` — ntfy hosting: check / user-space install / systemd unit
- `INSTALL.md` — install, verify, revert instructions
