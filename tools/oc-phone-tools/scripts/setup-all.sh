#!/usr/bin/env bash
# scripts/setup-all.sh — first-time end-to-end setup for oc-phone.
#
# Verifies a phone is plugged in with adb enabled, runs the host setup
# (scripts/setup-host.sh), then the device setup (scripts/setup-device.sh),
# then prints the final "you're done, here's how to connect" summary.
#
# Idempotent: safe to re-run (both sub-scripts are; this script adds nothing
# of its own that isn't).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PASS_QR=0
PASS_SECRETS=0
APK_OVERRIDE=""
SERIAL_OVERRIDE=""

# --- output helpers -----------------------------------------------------------
if [[ -t 1 ]] && [[ "${NO_COLOR:-}" == "" ]]; then
  C_BOLD=$'\e[1m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'; C_OFF=$'\e[0m'
else
  C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_OFF=""
fi
section() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_OFF"; }
ok()      { printf '%sok:%s %s\n' "$C_GREEN" "$C_OFF" "$1"; }
info()    { printf '  %s\n' "$1"; }
die()     { printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: setup-all.sh [--apk=PATH] [--serial=SERIAL] [--qr] [--show-secrets] [-h|--help]

First-time flow: (1) check a phone is attached over adb, (2) host setup,
(3) device setup, (4) "you're done" summary.

  --apk=PATH       Passed through to setup-device.sh.
  --serial=SERIAL  Passed through to setup-device.sh.
  --qr             Passed through to setup-host.sh (renders the onboarding
                   QR at the end — private screen only, it embeds secrets).
  --show-secrets   Print secret values in the summary (default: redacted).
  -h, --help       Show this help.

Safe to re-run.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --apk=*) APK_OVERRIDE="$arg" ;;
    --serial=*) SERIAL_OVERRIDE="$arg" ;;
    --qr) PASS_QR=1 ;;
    --show-secrets) PASS_SECRETS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown flag: $arg (see --help)" ;;
  esac
done

HOST_ARGS=()
[[ "$PASS_QR" == "1" ]] && HOST_ARGS+=(--qr)
[[ "$PASS_SECRETS" == "1" ]] && HOST_ARGS+=(--show-secrets)
DEV_ARGS=()
[[ -n "$APK_OVERRIDE" ]] && DEV_ARGS+=("$APK_OVERRIDE")
[[ -n "$SERIAL_OVERRIDE" ]] && DEV_ARGS+=("$SERIAL_OVERRIDE")

# --- 0. fail fast: is a phone actually there? ------------------------------------
section "precheck: attached phone"

ADB=""
for cand in "${ANDROID_HOME:-}/platform-tools/adb" "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
            "$HOME/Android/Sdk/platform-tools/adb" "$(command -v adb 2>/dev/null || true)"; do
  if [[ -n "$cand" && -x "$cand" ]]; then ADB="$cand"; break; fi
done
if [[ -z "$ADB" ]]; then
  die "no adb and no device check possible. Install platform-tools first (see scripts/setup-device.sh --help), plug in the phone, then re-run."
fi
if [[ -n "${SERIAL_OVERRIDE:-}" ]]; then
  WANT="${SERIAL_OVERRIDE#--serial=}"
  "$ADB" devices | awk 'NR>1 && NF>=2 && $2=="device" {print $1}' | grep -qxF "$WANT" \
    || die "device '$WANT' not attached+authorized. Plug it in (USB debugging on, RSA prompt accepted), then re-run."
  ok "phone present: $WANT"
else
  N="$("$ADB" devices | awk 'NR>1 && NF>=2 && $2=="device" {print $1}' | grep -c . || true)"
  [[ "$N" -ge 1 ]] || die "no authorized device on adb. Plug in the phone with USB debugging enabled, accept the RSA prompt (tap 'Allow'), then re-run."
  ok "phone(s) present: $N attached+authorized"
fi

# --- 1+2. host, then device ----------------------------------------------------------
section "step 1/2: host setup"
bash "$SCRIPT_DIR/setup-host.sh" "${HOST_ARGS[@]}"

section "step 2/2: device setup"
bash "$SCRIPT_DIR/setup-device.sh" "${DEV_ARGS[@]}"

# --- 3. you're done ----------------------------------------------------------------------
section "you're done"
# shellcheck disable=SC1090
set -a; . "$HOME/.config/oc-phone/env"; set +a
info "The PC now serves oc-phone after every boot (systemd --user units, linger on),"
info "and the app is on your phone."
info ""
info "To connect the app to this workstation:"
info "  1. Phone + PC on the same Tailnet (Tailscale IP: ${OC_BRIDGE_HOST:-?})."
info "  2. On a PRIVATE screen run:  oc-phone-qr"
info "     (prints a QR the app scans — it embeds the server + bridge credentials)."
info "  3. Or add manually in the app: server http://${OC_BRIDGE_HOST:-?}:4096,"
info "     bridge http://${OC_BRIDGE_HOST:-?}:${OC_BRIDGE_PORT:-8787}."
info ""
info "Manual control: oc-phone-up / oc-phone-down (units own the services at boot)."
info "Re-run this script anytime — it is idempotent."
ok "setup-all complete"
