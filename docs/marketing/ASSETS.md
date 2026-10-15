# Visual & Demo Assets — what exists, what's needed

Conversion-ranked. A short **demo video** and a **diff screenshot** are the two highest-leverage missing pieces.

---

## What already exists (in repo)

| Asset | Path | Size | Status |
|---|---|---|---|
| App icon | `distribution/play-graphics/icon-512.png` and `fastlane/metadata/android/en-US/images/icon.png` | 512×512 | Ready (Play, PH, GitHub social, favicon source) |
| Feature graphic | `distribution/play-graphics/feature-graphic.png` and `fastlane/.../images/featureGraphic.png` | 1024×500 | Ready (Play feature graphic). NOT the right ratio for a PH thumbnail (PH wants ~1270×760) or X card — make a variant. |
| Screenshot 1 — Connect screen | `fastlane/metadata/android/en-US/images/phoneScreenshots/01.png` (also in `docs-site/screenshots/01.png`) | 1080×2400 | Usable, BUT has a visible rendering glitch (see "Fix" below). Shows: server URL field, nickname, Connect button, a saved "Home MacBook · Connected" entry, and Cloudflare Tunnel / ngrok tunnel buttons. Good story. |
| Screenshot 2 — Live streaming + approval | `.../phoneScreenshots/02.png` (also `docs-site/screenshots/02.png`) | 1080×2400 | Strong. Shows a real prompt ("Refactor the auth middleware…"), `opencode streaming…`, reading a file, a `+` diff, and **Approve / Reject** buttons. This is the money shot — use it first on PH and the landing hero. |
| Screenshot 3 — Full diff view | `.../phoneScreenshots/03.png` (also `docs-site/screenshots/03.png`) | 1080×2400 | Content is right (full `+/-` diff of `auth.ts` with **Accept All / Discard**) but it is **rendered/scaled small with letterboxing** — looks low quality at full size. Needs re-capture at native 1080×2400. |
| Old low-res screenshot | `distribution/play-graphics/screenshots/01-no-connection.png` | 320×640 | Obsolete — do not use (too small, below Play's 320px-min comfort and looks dated). |

The three 1080×2400 screenshots are already wired into both the Play fastlane listing and the docs-site. The Play store listing graphics are covered.

---

## Fixes needed on existing assets

1. **Screenshot 01 glitch:** the blue "Connect with URL" header button overlaps its own text label (the label sits on top of a full-width blue bar). Re-capture so the segmented control / header renders cleanly before using it in any marketing context.
2. **Screenshot 03 quality:** re-capture at native 1080×2400 (current file is the diff view but scaled down with black letterbox bars). The diff is the single best differentiator — it must look crisp.
3. **Caption overlays:** the raw screenshots have no captions. For Play/PH, produce captioned variants (text overlay on the dark bg) per the shot list in `product-hunt.md`. Plain screenshots convert worse than captioned ones on store/PH galleries.

---

## What's still needed (priority order)

### P0 — biggest conversion lift
1. **Demo video, 60–90s** (screen recording of a real session): launch → paste server URL / pick tunnel → send a prompt → watch token streaming → see the inline diff → tap **Approve** → done. This is the #1 asset for PH, the landing page hero, dev.to embed, and Reddit. Nothing sells "control your agent from your phone" like motion.
   - Also cut a **15–20s vertical clip** (1080×1920) for X / YouTube Shorts.
   - Export a **looping GIF (≤5MB, ~10–15s)** of the stream→diff→approve moment for embeds where video is awkward (Reddit, GitHub README).

### P1 — needed for Product Hunt / landing polish
2. **6 captioned gallery screenshots** per the `product-hunt.md` shot list (1080×1920 portrait, dark theme, real UI):
   1. Connection setup (use the fixed v of screenshot 01)
   2. Active streaming session (screenshot 02 — already good)
   3. Diff viewer (use a re-captured, crisp screenshot 03)
   4. Tool-call approval bottom sheet (screenshot 02 covers part of this; a dedicated shot is better)
   5. Session list (NEW — not currently captured; need a screen showing multiple named sessions + timestamps)
   6. Biometric unlock prompt (NEW, optional — reinforces the privacy story)
3. **PH thumbnail / hero graphic** ~1270×760, dark bg (#0F172A), icon left, device showing the streaming/diff screen right, headline "AI Coding Agent. In Your Pocket." (The 1024×500 feature graphic is the wrong ratio for this.)

### P2 — nice to have / SEO & social
4. **OG / social-share image** (1200×630) for the landing page and link unfurls on X/Reddit/Slack/Discord. (Project memory says an OG image exists for SEO — verify it's current and shows the app, not just text.)
5. **Animated terminal-to-phone diagram** or a simple architecture graphic for dev.to / README: `your server (opencode + your keys) ⇄ tunnel ⇄ phone (thin client)`. Reinforces the "no backend of mine" trust message that's central to every post.
6. **A "session list" screen** is the one feature in the messaging (manage multiple sessions) that currently has NO screenshot — worth capturing for completeness.

---

## Quick checklist before T0
- [ ] Re-capture screenshot 01 (no overlap glitch)
- [ ] Re-capture screenshot 03 at native 1080×2400
- [ ] Capture session-list screen
- [ ] Produce 6 captioned PH gallery shots
- [ ] Record 60–90s demo video + 15s vertical clip + GIF
- [ ] Make 1270×760 PH/hero thumbnail
- [ ] Verify OG image (1200×630) is current and shows the app
- [ ] Confirm `cover_image` URL in `devto.md` resolves to a hosted hero image
