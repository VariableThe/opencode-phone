#!/usr/bin/env bash
# scripts/setup-host.sh — first-time (and re-runnable) PC-side setup for oc-phone.
#
# What it does:
#   1. Checks prerequisites (node>=22, npm, curl, openssl, tailscale).
#      Installs user-locally what it can (ntfy binary to ~/opt/ntfy,
#      bridge `npm install`); never installs system packages — if one is
#      genuinely required it prints the exact command instead.
#   2. Creates ~/.config/oc-phone/env if absent; fills in ONLY missing keys
#      (existing secrets are never overwritten). Re-syncs OC_BRIDGE_HOST to
#      the live Tailscale IPv4 (announced, single line).
#   3. Verifies the OpenCode theme files the bridge serves (tui.json +
#      themes/<name>.json).
#   4. Installs + enables the systemd --user units (oc-phone-server,
#      oc-phone-bridge). Starts them only if nothing is listening yet;
#      never steals ports from already-running manual (oc-phone-up) copies.
#   5. Prints connection details (secrets redacted unless --show-secrets)
#      and optionally renders the onboarding QR via oc-phone-qr (--qr).
#
# Idempotent: safe to re-run. No destructive actions, no secrets printed
# unless explicitly requested.
set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$HOME/.config/oc-phone"
ENV_FILE="$ENV_DIR/env"
UNIT_DIR="$HOME/.config/systemd/user"
BRIDGE_DIR="$HOME/Projects/oc-phone-bridge"
NTFY_DIR="$HOME/opt/ntfy"
NODE_MIN_MAJOR=22

SHOW_SECRETS=0
SHOW_QR=0

# --- output helpers -----------------------------------------------------------
if [[ -t 1 ]] && [[ "${NO_COLOR:-}" == "" ]]; then
  C_BOLD=$'\e[1m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'; C_OFF=$'\e[0m'
else
  C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_OFF=""
fi
section() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_OFF"; }
ok()      { printf '%sok:%s %s\n' "$C_GREEN" "$C_OFF" "$1"; }
info()    { printf '  %s\n' "$1"; }
warn()    { printf '%sWARN:%s %s\n' "$C_YELLOW" "$C_OFF" "$1"; }
die()     { printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: setup-host.sh [--qr] [--show-secrets] [-h|--help]

PC-side setup for oc-phone: prerequisites, credentials, theme check,
systemd --user units (boot persistence), connection summary.

  --qr             Also render the onboarding QR via oc-phone-qr
                   (WARNING: the QR embeds live credentials — private screen only).
  --show-secrets   Print secret values in the summary (default: redacted).
  -h, --help       Show this help.

Safe to re-run. Never touches system packages; user-local installs only.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --qr) SHOW_QR=1 ;;
    --show-secrets) SHOW_SECRETS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown flag: $arg (see --help)" ;;
  esac
done

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# --- 1. prerequisites ----------------------------------------------------------
section "Prerequisites"

need_cmd curl || die "curl is required but missing. Install it with: sudo apt install curl  (then re-run)"
ok "curl present"
need_cmd openssl || die "openssl is required but missing. Install it with: sudo apt install openssl  (then re-run)"
ok "openssl present"
need_cmd tailscale || die "tailscale is required but missing (system package — not installing automatically). Install it with: curl -fsSL https://tailscale.com/install.sh | sh  (then re-run)"
ok "tailscale present"

TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
[[ -n "$TS_IP" ]] || die "tailscale is installed but reports no IPv4 (is tailscaled up? try: sudo tailscale up). Re-run after connecting."
ok "Tailscale IPv4: $TS_IP"

if need_cmd node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$NODE_MAJOR" -ge "$NODE_MIN_MAJOR" ]]; then
    ok "node $(node --version) (>= $NODE_MIN_MAJOR)"
  else
    die "node $(node --version) is too old (need >= $NODE_MIN_MAJOR). Upgrade your user-local node, e.g.: download https://nodejs.org/dist/ , extract to ~/.local, then re-run. (Not changing it automatically.)"
  fi
else
  die "node is required but missing. Install user-locally, e.g.: curl -fsSL https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.xz -o /tmp/opencode/node.tar.xz && mkdir -p ~/.local && tar -xJf /tmp/opencode/node.tar.xz -C ~/.local --strip-components=1  (then re-run)"
fi
need_cmd npm || die "npm is required but missing (ships with node — check your PATH includes ~/.local/bin). Then re-run."
ok "npm present"

# ntfy binary (user-local install if absent)
if [[ -x "$NTFY_DIR/ntfy" ]]; then
  ok "ntfy binary present ($NTFY_DIR/ntfy)"
else
  info "ntfy binary missing — installing user-locally to $NTFY_DIR ..."
  mkdir -p "$NTFY_DIR" /tmp/opencode
  if curl -fsSL "https://github.com/binwiederhier/ntfy/releases/latest/download/ntfy_linux_x86_64.tar.gz" -o /tmp/opencode/ntfy.tar.gz; then
    tar -xzf /tmp/opencode/ntfy.tar.gz -C /tmp/opencode ntfy
    mv /tmp/opencode/ntfy "$NTFY_DIR/ntfy"
    chmod +x "$NTFY_DIR/ntfy"
    rm -f /tmp/opencode/ntfy.tar.gz
    ok "ntfy installed to $NTFY_DIR/ntfy"
  else
    rm -f /tmp/opencode/ntfy.tar.gz
    die "ntfy download failed. Install it manually: mkdir -p ~/opt/ntfy && curl -fsSL https://github.com/binwiederhier/ntfy/releases/latest/download/ntfy_linux_x86_64.tar.gz -o /tmp/ntfy.tar.gz && tar -xzf /tmp/ntfy.tar.gz -C /tmp ntfy && mv /tmp/ntfy ~/opt/ntfy/ntfy  (then re-run)"
  fi
fi

# bridge dependencies (node_modules only — never touches bridge source)
if [[ -x "$BRIDGE_DIR/node_modules/.bin/tsx" ]]; then
  ok "bridge dependencies present (node_modules/.bin/tsx)"
else
  [[ -d "$BRIDGE_DIR" ]] || die "bridge checkout missing at $BRIDGE_DIR (expected repo). Clone it first, then re-run."
  info "installing bridge dependencies (npm install in $BRIDGE_DIR) ..."
  (cd "$BRIDGE_DIR" && npm install --no-audit --no-fund)
  ok "bridge dependencies installed"
fi

# adb is optional on the host side (setup-device.sh requires it)
if need_cmd adb || [[ -x "$HOME/Android/Sdk/platform-tools/adb" ]]; then
  ok "adb present (device setup available)"
else
  warn "adb not found — scripts/setup-device.sh will refuse to run until Android platform-tools are available."
  info "  Get it user-locally via Android Studio, or: mkdir -p ~/Android/Sdk && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/opencode/cmdtools.zip && unzip -q /tmp/opencode/cmdtools.zip -d ~/Android/Sdk/cmdline-tools && mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest && ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=~/Android/Sdk 'platform-tools'"
fi

# --- 2. credentials ------------------------------------------------------------
section "Credentials ($ENV_FILE)"

mkdir -p "$ENV_DIR"
[[ -f "$ENV_FILE" ]] || { : > "$ENV_FILE"; info "created $ENV_FILE"; }
chmod 600 "$ENV_FILE"

rand_secret() { openssl rand -base64 48 | tr -d '\n'; }

# ensure KEY=VALUE line exists; never overwrite an existing non-empty value.
# $1=key $2=default-or-__RANDOM__
ensure_key() {
  local key="$1" def="$2" val
  if grep -qE "^${key}=" "$ENV_FILE"; then
    val="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    if [[ -n "$val" ]]; then info "$key: kept existing value"; return; fi
    warn "$key present but empty — generating a fresh value."
  else
    info "$key missing — adding it."
  fi
  if [[ "$def" == "__RANDOM__" ]]; then val="$(rand_secret)"; else val="$def"; fi
  grep -vE "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "$key: generated"
}

TS_NAME="$(tailscale status --self 2>/dev/null | awk '{print $2}' | head -n1 || true)"
[[ -n "$TS_NAME" && "$TS_NAME" != "-" ]] || TS_NAME="$(hostname -s 2>/dev/null || echo workstation)"

ensure_key "OPENCODE_SERVER_USERNAME" "opencode"
ensure_key "OPENCODE_SERVER_PASSWORD" "__RANDOM__"
ensure_key "OC_BRIDGE_TOKEN" "__RANDOM__"
ensure_key "OC_BRIDGE_PORT" "8787"
ensure_key "OC_BRIDGE_ALLOWED_ROOTS" "$HOME/Projects"
ensure_key "NTFY_URL" "http://${TS_IP}:2586"
ensure_key "NTFY_TOPIC" "oc-phone"
ensure_key "OC_SERVER_NAME" "$TS_NAME"

# OC_BRIDGE_HOST must track the live Tailscale IP (oc-phone-qr reads it).
if grep -qE '^OC_BRIDGE_HOST='"$TS_IP"'$' "$ENV_FILE"; then
  info "OC_BRIDGE_HOST: already $TS_IP"
else
  grep -vE '^OC_BRIDGE_HOST=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf 'OC_BRIDGE_HOST=%s\n' "$TS_IP" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "OC_BRIDGE_HOST: synced to live Tailscale IP $TS_IP (single line updated, nothing else touched)"
fi

# --- 3. theme files --------------------------------------------------------------
section "Theme files (served by the bridge GET /theme)"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${OC_BRIDGE_HOST:?OC_BRIDGE_HOST missing in $ENV_FILE}"
: "${OC_BRIDGE_PORT:?OC_BRIDGE_PORT missing in $ENV_FILE}"

TUI_JSON="$HOME/.config/opencode/tui.json"
if [[ -f "$TUI_JSON" ]]; then
  THEME_NAME="$(TUI_JSON="$TUI_JSON" node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.TUI_JSON,"utf8")).theme||"")}catch(e){}' 2>/dev/null || true)"
  # fallback without node env trickery if the above printed nothing
  if [[ -z "${THEME_NAME:-}" ]]; then
    THEME_NAME="$(grep -o '"theme"[[:space:]]*:[[:space:]]*"[^"]*"' "$TUI_JSON" | head -n1 | cut -d'"' -f4 || true)"
  fi
  if [[ -n "${THEME_NAME:-}" && -f "$HOME/.config/opencode/themes/${THEME_NAME}.json" ]]; then
    ok "theme '$THEME_NAME' present ($TUI_JSON + themes/${THEME_NAME}.json)"
  elif [[ -n "${THEME_NAME:-}" ]]; then
    warn "tui.json names theme '$THEME_NAME' but themes/${THEME_NAME}.json is missing — the bridge GET /theme will 404."
  else
    warn "$TUI_JSON has no theme field — the bridge GET /theme will 404 until one is set."
  fi
else
  warn "$TUI_JSON missing — the bridge GET /theme will 404 until it exists."
fi

# --- 4. systemd units --------------------------------------------------------------
section "systemd --user units (boot persistence)"

mkdir -p "$UNIT_DIR"
for unit in oc-phone-server.service oc-phone-bridge.service; do
  cp -f "$REPO_DIR/systemd/$unit" "$UNIT_DIR/$unit"
  ok "installed $UNIT_DIR/$unit"
done
systemctl --user daemon-reload
systemctl --user enable oc-phone-server.service oc-phone-bridge.service >/dev/null
ok "units enabled (start automatically after boot, once linger lets user units run at boot)"

port_listening() { ss -ltn 2>/dev/null | grep -qF "$1:$2"; }

for svc in "oc-phone-server:4096" "oc-phone-bridge:$OC_BRIDGE_PORT"; do
  svc_name="${svc%%:*}"; svc_port="${svc##*:}"
  if port_listening "$OC_BRIDGE_HOST" "$svc_port"; then
    info "$svc_name: $OC_BRIDGE_HOST:$svc_port already listening — leaving the running copy alone (not starting a second one)."
    info "  (When you want the units to own the ports instead: oc-phone-down, then: systemctl --user start $svc_name)"
  else
    info "starting $svc_name (port $svc_port free) ..."
    systemctl --user start "$svc_name"
    ok "$svc_name started"
  fi
done

# --- 5. summary ----------------------------------------------------------------------
section "Connection details"
mask() { if [[ "$SHOW_SECRETS" == "1" ]]; then printf '%s' "$1"; else printf '%s' "(redacted — re-run with --show-secrets to reveal)"; fi; }
info "host   : $OC_BRIDGE_HOST (Tailscale IP)"
info "server : http://$OC_BRIDGE_HOST:4096  (user $OPENCODE_SERVER_USERNAME)"
info "bridge : http://$OC_BRIDGE_HOST:$OC_BRIDGE_PORT"
info "dir    : ${OC_BRIDGE_ALLOWED_ROOTS%%,*}"
info "units  : $(systemctl --user is-enabled oc-phone-server 2>/dev/null)/$(systemctl --user is-enabled oc-phone-bridge 2>/dev/null) (enabled)"
info "manual : oc-phone-up / oc-phone-down remain for ad-hoc control; units own the services at boot."
if [[ "$SHOW_QR" == "1" ]]; then
  info "QR     : rendering via oc-phone-qr (PRIVATE SCREEN ONLY — embeds live credentials)"
  "$HOME/.local/bin/oc-phone-qr" || warn "oc-phone-qr failed (services still starting? re-run: oc-phone-qr)"
else
  info "QR     : run 'oc-phone-qr' on a private screen to onboard the phone (or re-run this script with --qr)."
fi
ok "host setup complete"
