# Worklog — 20260601-opencode-page-growth

## 2026-06-01 cycle 1
- target: real screenshots — stand up emulator + real app
- env fights: ~/.gradle, ~/Library/Android, old AVD all symlink to exFAT /Volumes/Dzianis-3.
  exFAT breaks BOTH gradle instrumented-cache AND emulator qcow2. / had only 3.9GB free.
- fixes: reclaimed android/app/build (4.4G) + ShipIt caches (1.4G) → 9.6G free;
  AVD oc36 recreated on APFS (~/.android/avd, 4G data partition);
  GRADLE_USER_HOME=/private/tmp/gradle-oc (APFS).
- emulator oc36 (android-36 arm64) BOOTED; opencode serve up on 0.0.0.0:4096
  (cwd /tmp/oc-demo, real provider via auth.json).
- build: debug APK compiling (no errors); install queued on completion.
- SEO/growth findings: /opencode + /opencode-mobile duplicate content; ZERO analytics live.
- next: install APK → drive app (add conn http://10.0.2.2:4096, send prompt) → screencap real screens.
