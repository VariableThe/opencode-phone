# agentlabs.cc/opencode — Deploy Guide

## Status

- Vercel project: `opencode-mobile-site` (team `dzianisvs-projects`)
- Auto-domain (live now): https://opencode-mobile-site.vercel.app
- Custom domain (pending DNS): https://agentlabs.cc/opencode
- Source: `/home/azureuser/workspace/vibebrowser/OpenCodeMobileSite/`

## Pages deployed

| Path | Purpose |
|------|---------|
| `/` | Landing page — download badges, features, Cloud CTA |
| `/privacy` | Privacy policy (rendered from `distribution/privacy-policy.html`) |
| `/terms` | Terms of service |
| `/support` | Contact info + FAQ |
| `/docs` | Documentation placeholder |

## DNS — ACTION REQUIRED

Cloudflare API token was not found (not in Bitwarden, not in env). You must
add the DNS record manually.

**Log in to Cloudflare → agentlabs.cc zone → DNS → Add record:**

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `opencode` | `cname.vercel-dns.com` | DNS only (orange cloud OFF) |

After adding the CNAME, Vercel will automatically issue a TLS certificate.
Verify with:

```bash
curl -sI https://agentlabs.cc/opencode/ | head -5
```

## Re-deploy

```bash
source ~/.bitwarden_credentials
export BW_SESSION=$(BW_PASSWORD="$BW_PASSWORD" bw unlock --passwordenv BW_PASSWORD --raw)
export VERCEL_TOKEN=$(bw get notes "VERCEL_TOKEN" --session "$BW_SESSION")
export VERCEL_ORG_ID=team_vF4d4Phgfv1IqW1MEZw7mBre
export VERCEL_PROJECT_ID=prj_Gy68vPhrgN0wEpFtxrCKUX38whLh
cd /home/azureuser/workspace/vibebrowser/OpenCodeMobileSite
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

## Privacy policy sync

The `/privacy` page reads `../../../opencode-mobile/distribution/privacy-policy.html`
at build time (relative to the Next.js project root, resolved server-side).
When the privacy policy changes, re-deploy the site to pick up the new version.

## Verification command

```bash
curl -sI https://dzianisv.github.io/opencode-mobile/privacy/ | head -3
```
