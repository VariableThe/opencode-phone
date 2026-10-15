# Decisions (autopilot) — rebrand-cc-agentlabs

1. Q: Own which slice given teammate said "focus SEO, I handle uploads"?
   Choice: own "package rename is correct + CI builds/launches new package"; leave Play Console app creation + first upload + testers to teammate.
   Why: rename is the code-side, CI-verifiable unit I control end-to-end. Upload is gated on teammate + manual-first-upload Google limitation.

2. Q: CUA smoke fails ("goal not reached: open a session and send a message"). Block the rename slice?
   Choice: do NOT block. Mark rename verified at build+launch; file follow-up for the smoke.
   Why: pre-rebrand run 26563595855 failed identically → pre-existing, env-caused (no opencode server reachable from CI). Not a regression. Evidence in verify.md.
   Alternatives: (a) spin opencode serve in CI to make smoke green — rejected as scope creep, separate issue; (b) claim E2E pass — rejected, dishonest per R5 (no send-a-message proof).

3. Q: Commit teammate's uncommitted icon/branding + lockfiles too?
   Choice: no — commit only package-identity files; leave icons/package-lock/skills-lock to teammate.
   Why: keep auditable, single-purpose diff; avoid shipping someone else's half-done branding.
