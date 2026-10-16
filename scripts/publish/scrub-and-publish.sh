#!/usr/bin/env bash
# Scrub + re-publish the public snapshot repo (VariableThe/opencode-phone).
#
# The local working tree contains machine-specific values (Tailscale IP,
# hostname, home-dir paths), so a naive copy would leak them. This script
# stages a clean copy, re-applies the scrub, FAILS LOUDLY if any private
# value survives (grep guard), then commits + pushes to the public repo.
#
# Usage:
#   scripts/publish/scrub-and-publish.sh            # full run: push to main
#   scripts/publish/scrub-and-publish.sh --dry-run  # stage + scrub + scan, no push
#
# What gets published: the app tree (repo root) + workstation tooling staged
# under tools/ from the sibling checkouts (../oc-phone-bridge, ../oc-notify,
# ../oc-phone-tools). Build outputs, node_modules, APKs, keystores and the
# app's original git history are never pushed — each run is a clean snapshot
# commit on top of the public repo's own history.
#
# overlay files owned by the PUBLIC repo (restored from the clone, not ours):
#   README.md, .gitignore
# generated each run from the local tree:
#   docs/app-readme.md  (verbatim copy of the local README.md)

set -euo pipefail

REPO="VariableThe/opencode-phone"
BRANCH="main"
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGE="$(mktemp -d /tmp/opencode/opencode-phone-publish.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

log() { printf '[publish] %s\n' "$*"; }
fail() { printf '[publish] FATAL: %s\n' "$*" >&2; exit 1; }

# --- 1. Authenticated-account check: never push to the wrong place. ---------
ACCT="$(gh auth status 2>&1 | grep -oE 'Logged in to [^ ]+ account [^ ]+' | head -1 || true)"
[[ "$ACCT" == *"account VariableThe"* ]] \
  || fail "gh is not authed as VariableThe (got: '${ACCT:-none}'). Refusing to push. Aborting."
log "gh authed as VariableThe."

# --- 2. Clone the public repo (its README/.gitignore are owned by it). -----
git clone --depth 1 "https://github.com/${REPO}.git" "$STAGE/clone" >/dev/null 2>&1 \
  || fail "could not clone ${REPO}. Check network / repo visibility."
cp "$STAGE/clone/README.md" "$STAGE/public-README.md"
cp "$STAGE/clone/.gitignore" "$STAGE/public-gitignore"
log "cloned public ${REPO}@${BRANCH}."

# --- 3. Wipe + stage a clean copy. -------------------------------------------
find "$STAGE/clone" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
rsync -a --delete \
  --exclude='.git/' --exclude='node_modules/' --exclude='dist/' --exclude='build/' \
  --exclude='android/app/build/' --exclude='android/build/' --exclude='android/.cxx/' \
  --exclude='android/.gradle/' --exclude='android/.kotlin/' \
  --exclude='__pycache__/' --exclude='*.pyc' \
  --exclude='*.apk' --exclude='*.aab' --exclude='*.keystore' --exclude='*.jks' \
  --exclude='.env' --exclude='.env.*' --exclude='google-services.json' \
  "$APP_DIR/" "$STAGE/clone/"
for tool in oc-phone-bridge oc-notify oc-phone-tools; do
  [[ -d "$APP_DIR/../$tool" ]] || fail "sibling checkout missing: $APP_DIR/../$tool"
  mkdir -p "$STAGE/clone/tools/$tool"
  rsync -a --delete \
    --exclude='.git/' --exclude='node_modules/' --exclude='dist/' --exclude='build/' \
    --exclude='__pycache__/' --exclude='*.pyc' \
    "$APP_DIR/../$tool/" "$STAGE/clone/tools/$tool/"
done
# Restore public-owned overlays; app-readme mirrors the local README.
cp "$STAGE/public-README.md" "$STAGE/clone/README.md"
cp "$STAGE/public-gitignore" "$STAGE/clone/.gitignore"
cp "$APP_DIR/README.md" "$STAGE/clone/docs/app-readme.md"
log "staged clean copy (app + tools/)."

# --- 4. Re-apply the scrub. --------------------------------------------------
C="$STAGE/clone"
# 4a. Precise rules first (destinations that must NOT get the generic IP).
# (perl \x{...} does not match raw UTF-8 bytes without -CSD, so match the
# comment by its ASCII-anchored shape instead; the em-dash in the replacement
# is a literal UTF-8 pass-through.)
sed -i 's|^// Defaults only .*|// Default is intentionally empty — the Tailscale address of the self-hosted|' "$C/src/stores/settings.ts"
sed -i 's|^// stay user-overridable (never hard-code it at call sites).$|// ntfy server is filled in by QR onboarding / setup-host.sh and stays\n// user-overridable (never hard-code it at call sites).|' "$C/src/stores/settings.ts"
sed -i 's|baseUrl: "http://100\.96\.42\.5:2586"|baseUrl: ""|' "$C/src/stores/settings.ts"
sed -i 's|placeholder="http://100\.96\.42\.5:2586"|placeholder="http://<TAILSCALE-IP>:2586"|' "$C/app/(tabs)/settings.tsx"
sed -i 's|http://100\.96\.42\.5|http://<TAILSCALE-IP>|g' \
  "$C/tools/oc-notify/INSTALL.md" "$C/tools/oc-notify/README.md" \
  "$C/tools/oc-notify/src/payload.ts" \
  "$C/tools/oc-phone-tools/README.md" "$C/tools/oc-phone-tools/oc-phone-qr"
sed -i 's|--host=100\.96\.42\.5|--host=<TAILSCALE-IP>|' "$C/tools/oc-phone-tools/README.md"
sed -i 's|Connection label. Tailscale self hostname|Connection label. Your Tailscale self hostname|' "$C/tools/oc-phone-tools/README.md"
sed -i 's|/home/aditya/Projects/oc-notify|<checkout>/tools/oc-notify|g' \
  "$C/tools/oc-notify/INSTALL.md" "$C/tools/oc-notify/README.md"
sed -i 's|--dir=/home/aditya/Projects|--dir=~/Projects|' "$C/tools/oc-phone-tools/README.md"
# 4b. Generic fallbacks: remaining occurrences + any NEW ones elsewhere.
grep -rl '100\.96\.42\.5' "$C" --exclude-dir=.git | xargs -r sed -i 's|100\.96\.42\.5|100.64.0.10|g'
grep -rl 'asus-zorin' "$C" --exclude-dir=.git | xargs -r sed -i 's|asus-zorin|myserver|g'
grep -rl '/home/aditya' "$C" --exclude-dir=.git | xargs -r sed -i 's|/home/aditya|/home/user|g'
log "scrub applied."

# --- 5. Guard: fail loudly if any private value survived. --------------------
# (This script itself contains the raw patterns as sed expressions, so it is
# excluded from the scan — the patterns below appear only as code literals.)
GUARD_FAIL=0
for pat in '100\.96\.42\.5' 'asus-zorin' '/home/aditya'; do
  hits="$(grep -rn "$pat" "$C" --exclude-dir=.git --exclude='scrub-and-publish.sh' || true)"
  if [[ -n "$hits" ]]; then
    GUARD_FAIL=1
    printf '[publish] GUARD HIT for pattern %s:\n%s\n' "$pat" "$hits"
  fi
done
[[ "$GUARD_FAIL" -eq 0 ]] || fail "scrub guard found private values above. NOTHING pushed. Fix the scrub rules and re-run."
log "guard clean: no occurrences of 100.96.42.5 / asus-zorin / /home/aditya outside this script."

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: staged tree at $STAGE/clone (kept for inspection)."
  trap - EXIT # keep the staging dir so the operator can inspect it
  echo "STAGE_DIR=$STAGE/clone"
  (cd "$STAGE/clone" && git status --short | head -30)
  exit 0
fi

# --- 6. Commit + push (small number of clean snapshot commits, no history). --
cd "$STAGE/clone"
git add -A
if git diff --cached --quiet; then
  log "no changes vs public HEAD — nothing to push."
  exit 0
fi
git -c user.name="VariableThe" -c user.email="variablethe@users.noreply.github.com" \
  commit -m "feat: public snapshot $(date -u +%Y-%m-%d) — completion notifications on by default" >/dev/null
SHA="$(git rev-parse HEAD)"
git push origin "$BRANCH" || fail "push failed. To retry later: re-run this script (it is idempotent)."
log "pushed ${SHA} to https://github.com/${REPO}."
