#!/usr/bin/env bash
# setup-ntfy.sh — host ntfy for oc-notify WITHOUT docker and WITHOUT root.
#
# ntfy ships a static single Go binary; this script installs it in user-space
# (~/opt/ntfy), bound to the Tailnet interface only. Never touches system
# packages, never binds a public interface.
#
# Usage:
#   ./setup-ntfy.sh               # check mode: report environment + next steps (default, read-only)
#   ./setup-ntfy.sh --install     # download + verify the ntfy binary (idempotent)
#   ./setup-ntfy.sh --write-unit  # write ~/.config/systemd/user/ntfy.service (backs up existing)
#
# Env overrides: NTFY_VERSION (default: latest GitHub release), NTFY_PORT (default: 2586),
#   NTFY_DIR (default: ~/opt/ntfy), BIND_IP (default: auto-detected Tailscale IPv4).
set -u

NTFY_PORT="${NTFY_PORT:-2586}"
NTFY_DIR="${NTFY_DIR:-$HOME/opt/ntfy}"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/ntfy.service"

info()  { printf '%s\n' "$*"; }
warn()  { printf 'WARN: %s\n' "$*" >&2; }
die()   { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

tailscale_ip() {
  if have tailscale; then
    tailscale ip -4 2>/dev/null | head -n1
    return 0
  fi
  ip -4 addr show tailscale0 2>/dev/null | grep -oP '(?<=inet\s)100\.\S+' | cut -d/ -f1 | head -n1
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)  echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    armv7l)  echo "arm7" ;;
    i386|i686) echo "386" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
}

latest_version() {
  # Resolves e.g. v2.16.0 from the GitHub releases API using python3 (no jq needed).
  curl -fsSL --max-time 20 https://api.github.com/repos/binwiederhier/ntfy/releases/latest \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])'
}

check_mode() {
  info "=== oc-notify ntfy setup check ==="
  info "docker:      $(have docker && echo present || echo ABSENT)"
  info "podman:      $(have podman && echo present || echo ABSENT)"
  info "ntfy binary: $(have ntfy && command -v ntfy || echo ABSENT)"
  if [ -x "$NTFY_DIR/ntfy" ]; then
    info "user-space:  $NTFY_DIR/ntfy ($("$NTFY_DIR/ntfy" --version 2>/dev/null || echo version-unknown))"
  else
    info "user-space:  ABSENT ($NTFY_DIR/ntfy not found)"
  fi
  local ip
  ip="$(tailscale_ip || true)"
  info "tailscale:    $([ -n "${ip:-}" ] && echo "up ($ip)" || echo DOWN-or-absent)"
  info "port TCP $NTFY_PORT: $( (ss -ltn 2>/dev/null | grep -q ":$NTFY_PORT ") && echo LISTENING || echo free)"
  info "systemd unit: $([ -f "$UNIT_FILE" ] && echo present || echo absent)"
  info ""
  if ! have docker && ! have podman && ! have ntfy && [ ! -x "$NTFY_DIR/ntfy" ]; then
    info "Hosting path: user-space static binary (no docker/podman/ntfy on this machine)."
  fi
  info "Next steps:"
  info "  1. ./setup-ntfy.sh --install     # download static ntfy binary to $NTFY_DIR"
  info "  2. ./setup-ntfy.sh --write-unit  # systemd --user unit binding ${ip:-<tailscale-ip>}:$NTFY_PORT"
  info "  3. systemctl --user daemon-reload && systemctl --user enable --now ntfy"
  info "  4. curl -d '{\"topic\":\"<pick-a-secret-topic>\",\"message\":\"ntfy is up\"}' http://${ip:-<tailscale-ip>}:$NTFY_PORT/"
}

do_install() {
  local version="${NTFY_VERSION:-}"
  if [ -z "$version" ]; then
    info "Resolving latest ntfy release..."
    version="$(latest_version)" || die "could not resolve latest release (network/GitHub API failed). Set NTFY_VERSION=vX.Y.Z manually"
    info "Latest release: $version"
  fi
  local arch
  arch="$(detect_arch)"
  local tgz="ntfy_${version#v}_linux_${arch}.tar.gz"
  local url="https://github.com/binwiederhier/ntfy/releases/download/${version}/${tgz}"
  mkdir -p "$NTFY_DIR"
  if [ -x "$NTFY_DIR/ntfy" ]; then
    info "ntfy already installed at $NTFY_DIR/ntfy — re-verifying version."
  fi
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  info "Downloading $url ..."
  curl -fSL --max-time 120 -o "$tmp/$tgz" "$url" || die "download failed"
  tar -xzf "$tmp/$tgz" -C "$tmp"
  local bin
  bin="$(find "$tmp" -name ntfy -type f | head -n1)"
  [ -n "${bin:-}" ] || die "ntfy binary not found in archive"
  install -m 0755 "$bin" "$NTFY_DIR/ntfy"
  rm -rf "$tmp"; trap - EXIT
  "$NTFY_DIR/ntfy" --version || die "installed binary does not run"
  info "Installed: $NTFY_DIR/ntfy"
  info "Suggested topic (secret — do not share): oc-$(python3 -c 'import secrets; print(secrets.token_hex(12))')"
  info "Run it (Tailnet only):"
  info "  ${BIND_IP:-$(tailscale_ip)} -> $NTFY_DIR/ntfy serve --listen-http ${BIND_IP:-$(tailscale_ip)}:$NTFY_PORT --cache-file $NTFY_DIR/cache.db"
  info "Or: ./setup-ntfy.sh --write-unit"
}

do_write_unit() {
  local ip="${BIND_IP:-$(tailscale_ip || true)}"
  [ -n "${ip:-}" ] || die "no Tailscale IP detected; set BIND_IP=100.x.y.z explicitly"
  mkdir -p "$UNIT_DIR" "$NTFY_DIR"
  if [ -f "$UNIT_FILE" ]; then
    local bak="$UNIT_FILE.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$UNIT_FILE" "$bak"
    info "Backed up existing unit to $bak"
  fi
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=ntfy push server (oc-notify, Tailnet only)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%h/opt/ntfy/ntfy serve --listen-http ${ip}:${NTFY_PORT} --cache-file %h/opt/ntfy/cache.db
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
EOF
  info "Wrote $UNIT_FILE (binds ${ip}:${NTFY_PORT} — Tailnet interface only, never 0.0.0.0)"
  info "Activate: systemctl --user daemon-reload && systemctl --user enable --now ntfy"
}

case "${1:-}" in
  ""|--check)      check_mode ;;
  --install)       do_install ;;
  --write-unit)    do_write_unit ;;
  -h|--help)       sed -n '2,14p' "$0" ;;
  *) die "unknown arg '$1'; use --check (default), --install, or --write-unit" ;;
esac
