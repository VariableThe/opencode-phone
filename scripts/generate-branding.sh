#!/usr/bin/env bash
# Regenerate all branding PNGs from assets/branding/*.svg.
# Usage: bash scripts/generate-branding.sh   (run from the repo root)
# Needs: node, npm, python3 with Pillow. Installs @resvg/resvg-js into
# /tmp/opencode-branding (user-local staging, never into the repo or system).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="/tmp/opencode-branding"
RESVG_VER="2.6.2"

mkdir -p "$STAGE"
cd "$STAGE"
[ -f package.json ] || npm init -y >/dev/null 2>&1
[ -d node_modules/@resvg/resvg-js ] || npm install "@resvg/resvg-js@$RESVG_VER" 2>&1 | tail -1

node "$ROOT/scripts/render-branding.mjs" "$ROOT" "$STAGE"

python3 - "$ROOT" "$STAGE" <<'EOF'
import os, sys
from PIL import Image, ImageDraw

root, stage = sys.argv[1], sys.argv[2]
mip = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

# Launcher: full-bleed square + circular round variant, as WebP.
for density, size in mip.items():
    src = Image.open(os.path.join(stage, "icon-%d.png" % size)).convert("RGBA")
    outdir = os.path.join(root, "android", "app", "src", "main", "res", "mipmap-" + density)
    src.save(os.path.join(outdir, "ic_launcher.webp"), "WEBP", quality=90)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    blank = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    blank.paste(src, (0, 0), mask)
    blank.save(os.path.join(outdir, "ic_launcher_round.webp"), "WEBP", quality=90)

print("launcher webp done")
EOF

echo OK
