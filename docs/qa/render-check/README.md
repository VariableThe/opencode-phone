# Reply→Render Visual Check (release gate)

Visual proof that a **real agent reply** renders correctly in the app's chat surfaces:
markdown, fenced code blocks (long lines horizontally scroll, not truncated), and the diff view.

## How these were produced

- A **real Gemini (`gemini-2.5-flash`) reply** was captured from a live local opencode server
  (provider `@ai-sdk/google`, nested `{providerID,modelID}`), asking for a string-reverse function
  with a ~430-char single-line comment plus a unified diff.
- The reply was rendered through the **actual app components** — `MessageBubble` →
  `Markdown` / `CodeBlock` and `DiffView` (the edit-tool diff surface) — via an Expo **web export**
  (`react-native-web`), served and screenshotted in a real Chromium browser.

## Verdict — ALL PASS (no app bugs)

| Surface | Result |
|---|---|
| Markdown (heading, bullets), light + dark | PASS — high contrast both themes |
| Code block, 430-char single line | PASS — horizontally scrolls; far-right reveals the line END (`…display purposes.`), so not truncated/wrapped |
| Diff (fenced ```diff and native `DiffView`), light + dark | PASS — +/- coloring, horizontal scroll |

## Key screenshots

- `05-faithful-light.png`, `06-faithful-dark.png` — production-faithful render (`isDark` = OS scheme,
  exactly as the chat screen derives it).
- `07-dark-top-viewport.png` — dark markdown/code contrast close-up.
- `08-dark-scrolled-right.png` — long code line scrolled to its END (horizontal-scroll proof).
- `02-all-surfaces.png` / `03-scrolled-right.png` — all surfaces at scroll-left=0 vs scrolled-right.

The reply→render path is **bug-free and release-ready**.
