#!/usr/bin/env bash
# scripts/setup-device.sh — phone-side setup for oc-phone over adb.
#
# What it does:
#   1. Locates adb (PATH, ~/Android/Sdk/platform-tools, ANDROID_HOME/ANDROID_SDK_ROOT).
#      Fails with install instructions if none is found.
#   2. Requires exactly the target device to be attached and authorized
#      (--serial=... selects one; ANDROID_SERIAL is honoured; otherwise the
#      single attached `device` is used — refuses to guess when several).
#   3. Installs the APK (default: the built debug APK in the opencode-phone
#      checkout; --apk= overrides), verifies the package, grants runtime
#      permissions (camera required; notifications best-effort), prints
#      confirmation.
#
# Idempotent: safe to re-run (`adb install -r`, grants are sticky).
# Never prints secrets (none are involved on this side).
set -euo pipefail

APP_ID="cc.agentlabs.opencode"
APK_DEFAULT="$HOME/Projects/opencode-phone/android/app/build/outputs/apk/debug/app-debug.apk"
APK_PATH="$APK_DEFAULT"
SERIAL="${ANDROID_SERIAL:-}"

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
  cat <<EOF
Usage: setup-device.sh [--apk=PATH] [--serial=SERIAL] [-h|--help]

Installs the oc-phone app on the attached Android device and grants the
runtime permissions it needs. Requires one authorized device on adb.

  --apk=PATH       APK to install (default: $APK_DEFAULT)
  --serial=SERIAL  Target device (default: \$ANDROID_SERIAL, else the single
                   attached device; fails if zero or several are attached).
  -h, --help       Show this help.

Safe to re-run.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --apk=*) APK_PATH="${arg#--apk=}" ;;
    --serial=*) SERIAL="${arg#--serial=}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown flag: $arg (see --help)" ;;
  esac
done

# --- 1. locate adb --------------------------------------------------------------
section "adb"
ADB=""
for cand in "${ANDROID_HOME:-}/platform-tools/adb" "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
            "$HOME/Android/Sdk/platform-tools/adb" "$(command -v adb 2>/dev/null || true)"; do
  if [[ -n "$cand" && -x "$cand" ]]; then ADB="$cand"; break; fi
done
[[ -n "$ADB" ]] || die "no adb found. Install Android platform-tools user-locally (no system packages needed), e.g.: mkdir -p ~/Android/Sdk && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/opencode/cmdtools.zip && unzip -q /tmp/opencode/cmdtools.zip -d ~/Android/Sdk/cmdline-tools && mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest && ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=~/Android/Sdk 'platform-tools'  (then re-run; adb will be at ~/Android/Sdk/platform-tools/adb)"
ok "adb: $ADB ($("$ADB" version | head -n1))"

# --- 2. device -------------------------------------------------------------------
section "device"

DEVICES="$("$ADB" devices | awk 'NR>1 && NF>=2 && $2=="device" {print $1}')"
N_DEVICES="$(printf '%s' "$DEVICES" | grep -c . || true)"
if [[ -n "$SERIAL" ]]; then
  printf '%s' "$DEVICES" | grep -qxF "$SERIAL" \
    || die "device '$SERIAL' is not attached+authorized. Attached devices: $(printf '%s' "$DEVICES" | tr '\n' ' ' || true)(empty = none). Check USB, enable USB debugging, accept the RSA prompt (tap 'Allow'), then re-run. See: $ADB devices"
  TARGET="$SERIAL"
else
  [[ "$N_DEVICES" -ge 1 ]] || die "no device attached. Plug in the phone with USB debugging enabled, accept the RSA prompt (tap 'Allow'), then re-run. (adb reports: $($ADB devices | tail -n +2 | tr '\n' ';'))"
  [[ "$N_DEVICES" -le 1 ]] || die "$N_DEVICES devices attached — refusing to guess. Re-run with --serial=... or ANDROID_SERIAL=.... Attached: $(printf '%s' "$DEVICES" | tr '\n' ' ')"
  TARGET="$DEVICES"
fi
ok "target device: $TARGET"

# --- 3. install ---------------------------------------------------------------------
section "install ($APP_ID)"

[[ -f "$APK_PATH" ]] || die "APK not found: $APK_PATH. Rebuild it in the opencode-phone checkout (./gradlew assembleDebug) or pass --apk=PATH to a built APK, then re-run."
info "installing $(basename "$APK_PATH") ..."
"$ADB" -s "$TARGET" install -r "$APK_PATH"
"$ADB" -s "$TARGET" shell pm list packages | grep -qxF "package:$APP_ID" \
  || die "install finished but package $APP_ID not found on device (pm list packages). Try uninstalling first: $ADB -s $TARGET uninstall $APP_ID"
ok "package $APP_ID installed (verified via pm list packages)"

# --- 4. permissions --------------------------------------------------------------------
section "permissions"

if "$ADB" -s "$TARGET" shell pm grant "$APP_ID" android.permission.CAMERA; then
  ok "CAMERA granted (QR scanner)"
else
  warn "pm grant CAMERA failed — grant Camera manually in Settings > Apps > oc-phone > Permissions."
fi
# POST_NOTIFICATIONS only exists on API 33+; pm grant may refuse elsewhere — best-effort both ways.
if "$ADB" -s "$TARGET" shell pm grant "$APP_ID" android.permission.POST_NOTIFICATIONS 2>/dev/null; then
  ok "POST_NOTIFICATIONS granted via pm grant"
elif "$ADB" -s "$TARGET" shell appops set "$APP_ID" POST_NOTIFICATION allow 2>/dev/null; then
  ok "notifications allowed via appops"
else
  warn "could not grant notifications over adb — enable them manually in Settings > Apps > oc-phone > Notifications."
fi

section "done"
ok "device setup complete: $APP_ID on $TARGET (re-run anytime; install -r keeps app data)"
info "Next: on the phone, add this workstation (scan the QR from 'oc-phone-qr' on a private screen, or type the Tailscale IP + credentials by hand)."
