# App branding

Original mark for the opencode-phone client. Do not copy artwork from
`alvarolorentedev/opencode-mobile` or any other project; this mark was drawn
from scratch for this repo.

## Concept

A terminal prompt: a bold `>` chevron plus a block cursor, framed by a
rounded-square "terminal window" outline. Three flat shapes, no text (text is
illegible at 48dp), no gradients, no shadows, no clip art.

## Palette (tokyonight, matching the server theme in `src/lib/opencode-theme.ts`)

| Role     | Hex       | Source                              |
| -------- | --------- | ----------------------------------- |
| `bg`     | `#1a1b26` | tokyonight night background (`ink`) |
| `accent` | `#82aaff` | tokyonight blue (`brand`)           |
| `caret`  | `#c8d3f5` | tokyonight foreground (`paper`)     |

The launcher background and the splash background are both solid `bg`;
the mark itself is `accent` with a `caret` cursor block.

## Sources

| File                      | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `icon.svg`                | Full-bleed 1024 artboard (bg + mark)                  |
| `adaptive-foreground.svg` | Transparent 432 foreground; mark inside safe circle  |
| `monochrome.svg`          | All-white silhouette for Android 13+ themed icons    |
| `splash.svg`              | Transparent 512 mark (bg comes from config)          |

Keep the four files in sync: the mark geometry is identical, only the
artboard, the `translate/scale` wrapper, and the colors differ.

### Adaptive-icon safe zone

The foreground is 432x432. The mark group is wrapped in
`translate(216 216) scale(0.43) translate(-512 -512)`, which puts the
chevron + cursor (icon coords x 396-628, y 432-592) inside the central
~232px, within the 264px-diameter mask safe circle. Only the
rounded-square frame intentionally bleeds toward the mask edge, the way
normal adaptive icons do.

## Regenerating

Edit the SVGs, then run from the repo root:

```bash
bash scripts/generate-branding.sh
```

The script installs `@resvg/resvg-js` into `/tmp/opencode-branding`
(user-local, never into the repo or system), renders every PNG the
project needs — `assets/*.png` plus all `mipmap-*` / `drawable-*`
densities for the committed prebuilt `android/` project — and converts
the launcher PNGs to WebP with Pillow. No system packages required.

## Output map

- `assets/icon.png` (1024), `assets/icon-appstore.png` (1024),
  `assets/adaptive-icon.png` (432), `assets/adaptive-icon-mono.png` (432),
  `assets/splash-icon.png` (512)
- `android/.../mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher{,_round}.webp`
  (48/72/96/144/192), `ic_launcher_foreground.png` + `ic_launcher_mono.png`
  (108/162/216/324/432) backing `mipmap-anydpi-v26/ic_launcher{,_round}.xml`
- `android/.../drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splashscreen_logo.png`
  (288/432/576/864/1152)
