# INSTALL — oc-notify

## 1. Host ntfy (on the workstation, Tailnet only)

```sh
cd <checkout>/tools/oc-notify
./setup-ntfy.sh            # check mode: reports docker/podman/ntfy, Tailnet IP, next steps
./setup-ntfy.sh --install  # downloads the static ntfy binary to ~/opt/ntfy (user-space, no sudo)
./setup-ntfy.sh --write-unit  # writes ~/.config/systemd/user/ntfy.service (binds Tailnet IP only)
sudo -n true 2>/dev/null; : never needed — do NOT run any of this as root
systemctl --user daemon-reload && systemctl --user enable --now ntfy
```

Pick an unguessable topic (the topic IS the password):

```sh
python3 -c "import secrets; print('oc-' + secrets.token_hex(12))"
# e.g. oc-4f2c9a1b7e3046d8a1c2f5b3 — keep it secret
```

Verify the server answers (replace IP/topic):

```sh
curl -d '{"topic":"oc-YOUR-TOPIC","message":"ntfy is up","title":"test","priority":3}' \
  http://<TAILSCALE-IP>:2586/
```

## 2. Install the plugin (global, reversible)

`~/.config/opencode/plugins/` did not exist before — creating it and adding
one symlink touches no existing config file. Revert = delete the symlink.

```sh
mkdir -p ~/.config/opencode/plugins
ln -s <checkout>/tools/oc-notify/plugins/notify.ts ~/.config/opencode/plugins/oc-notify.ts
ls -la ~/.config/opencode/plugins/   # confirm the symlink
```

Revert:

```sh
rm ~/.config/opencode/plugins/oc-notify.ts
rmdir ~/.config/opencode/plugins/ 2>/dev/null || true
```

Project-level alternative (only for one repo, no global effect):

```sh
mkdir -p .opencode/plugins
ln -s <checkout>/tools/oc-notify/plugins/notify.ts .opencode/plugins/oc-notify.ts
```

## 3. Configure env (in opencode's process environment)

```sh
export NTFY_URL="http://<TAILSCALE-IP>:2586"
export NTFY_TOPIC="oc-YOUR-TOPIC"
export OC_SERVER_NAME="workstation"   # optional
# export NTFY_TOKEN="tk_..."          # optional, only if ntfy requires auth
```

Add to `~/.bashrc` (or equivalent), then **restart opencode** so it picks
up the env. The plugin reads env on every event — no reinstall needed after
env changes. Without `NTFY_URL`/`NTFY_TOPIC` it is a silent no-op.

## 4. Verify end-to-end

1. `npm test` in `<checkout>/tools/oc-notify` — 23 tests, all must pass.
2. Restart opencode, trigger a permission ask (e.g. run something outside
   the allowed permissions), and confirm the phone buzzes.
3. `journalctl --user -u ntfy -f` shows incoming publishes server-side.

## Notes

- Do NOT `git init` / commit / push this directory (per project policy).
- Do NOT bind ntfy to a public interface — Tailnet IP only (`setup-ntfy.sh`
  enforces this; default port 2586).
- Never write the topic name into chat logs, screenshots, or shared docs.
