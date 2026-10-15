# oc-phone-bridge

Workstation-side sidecar for the opencode phone app (Phase 0.3 skeleton).

A small, Tailnet-only HTTP API that lets a phone app list/create/kill **tmux**
sessions, peek at their output (`capture-pane`), read files under allowed
roots, and fetch the OpenCode theme. Plain `node:http`, no web framework.

> **Interactive PTY / WebSocket streaming is explicitly out of scope** — it
> arrives in Phase 2.1. This phase is REST endpoints + auth + tests only.

## Run

Requires Node.js ≥ 22.

```sh
npm install

# Token is mandatory (min 32 chars) — the server refuses to start without it.
export OC_BRIDGE_TOKEN="$(openssl rand -base64 48)"
export OC_BRIDGE_HOST="127.0.0.1"   # default; use your Tailscale IP to serve the phone
export OC_BRIDGE_PORT="8787"        # default
export OC_BRIDGE_ALLOWED_ROOTS="$HOME"  # default; comma-separated

npm run dev     # tsx src/server.ts
npm start       # same
npm run typecheck
npm test        # tsx --test tests/*.test.ts
```

## Environment

| Var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OC_BRIDGE_TOKEN` | yes | — | Bearer token. Server exits(1) if unset or shorter than 32 chars. |
| `OC_BRIDGE_HOST` | no | `127.0.0.1` | Bind address. Loopback or a Tailscale IP only. |
| `OC_BRIDGE_PORT` | no | `8787` | Integer 1–65535. |
| `OC_BRIDGE_ALLOWED_ROOTS` | no | `$HOME` | Comma-separated absolute paths. `GET /fs/*` and `POST /tmux` `dir` must resolve inside one of these. Empty config denies all fs access. |

## API

All routes require `Authorization: Bearer <OC_BRIDGE_TOKEN>` (including
`/health`). Errors are JSON: `{error, code}` with the matching status.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | `{ok:true, version, tmux}` — `tmux` is `tmux -V` output, or `unavailable: …` when tmux is missing. |
| `GET` | `/tmux` | `{sessions:[{name, created, paneCommand, isOpencode}]}` — `[]` when no tmux server exists. `paneCommand` is the active pane's foreground command (`#{pane_current_command}`), or `null` when unavailable; `isOpencode` flags opencode sessions (see below). |
| `POST` | `/tmux` | Create session. JSON `{name, dir?, cmd?}` → `201 {name}`. `dir` must be absolute and inside an allowed root. |
| `DELETE` | `/tmux/:name` | Kill session → `200 {name}`; `404 SESSION_NOT_FOUND`. |
| `GET` | `/tmux/:name/tail?lines=N` | Last N lines via `capture-pane -p -S -N`. Default 200, max 2000 (`400 INVALID_LINES` beyond). |
| `GET` | `/fs/list?path=` | `{path, entries:[{name, type, size, mtime}]}` for a directory inside an allowed root. |
| `GET` | `/fs/read?path=` | `{path, size, content}` for a text file (max 1 MiB, else `413`). |
| `GET` | `/theme` | `{name, json}` — the OpenCode theme (see below); `404 {…, name:null}` when unconfigured. |

Validation: session names must match `[A-Za-z0-9_-]{1,64}` (a name like
`; rm -rf ~` is rejected with `400` before any subprocess runs); JSON bodies
only (`application/json`, max 64 KiB, else `413`); query `path`s are resolved
and prefix-checked against the allowed roots (traversal → `403`).

### `isOpencode` heuristic (exact)

`GET /tmux` runs a single `tmux list-panes -a -F
'#{session_name}|#{session_created}|#{window_active}|#{pane_active}|#{pane_current_command}'`
(via `execFile` argv, no shell) and picks each session's active pane of its
active window. Fields are `|`-separated because this tmux build rewrites
tab characters in its own output to `_`, so `\t` cannot be used as a
separator. `isOpencode` is true iff that pane's command, after taking the
first whitespace-separated token, stripping surrounding quotes, taking the
basename after `/`, and stripping a leading `-` login-shell marker, equals
`opencode` exactly (case-sensitive).

Matches: `opencode`, `/usr/local/bin/opencode`, `-opencode`. Rejects by
design (conservative, no guessing): `opencode-tui`, `my-opencode`,
`Opencode`, shells, empty input. When pane info is unavailable the session
still lists with `paneCommand: null, isOpencode: false` instead of failing
the request.

### Theme paths read (exactly)

1. `<configDir>/tui.json` — the `theme` field (e.g. `"tokyonight"`).
2. `<configDir>/themes/<name>.json` — the theme definition.

`<configDir>` is `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`.

## Security

**This service can spawn shells as the workstation user** (`tmux new-session`
runs the phone-supplied `cmd`, and `/fs/read` exposes file contents). Treat it
accordingly:

- **Bind Tailnet/loopback only** — `127.0.0.1` or the machine's Tailscale IP.
  Never bind `0.0.0.0` or any public interface.
- **Always require the token** — every route is authenticated; the server
  will not start without a ≥32-char `OC_BRIDGE_TOKEN`. Rotate it like a
  password and never log it (access logs record method/path/status only —
  never headers, tokens, or query values).
- **Never expose without TLS** — this skeleton serves plain HTTP, which is
  only acceptable inside the encrypted Tailscale tunnel. Do not put it on the
  open internet or behind a TLS-terminating proxy without adding TLS first.
- **Defense in depth** — tmux is driven via `execFile('tmux', argv)` (no
  shell, names passed as single argv elements); session names, `dir`, `path`,
  and `lines` are validated before use; body size (64 KiB) and file-read size
  (1 MiB) are capped.

## Deliberately deferred (later phases)

- **PTY streaming / WebSocket** (Phase 2.1) — no `ws` dependency yet; `tail`
  polling is the interim peek mechanism.
- **ntfy registration / push notifications.**
- **Server registry / multi-host support.**
