# Google Play Console Setup — OpenCode Mobile

Package: `ai.opencode.mobile`  
Developer: Vibe Technologies, LLC

## Status

- [x] Keystore generated (`keystores/production-release.jks`, alias: `upload`)
- [x] GitHub secrets set: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
- [ ] Google Cloud project created
- [ ] Service account created + JSON key downloaded
- [ ] Play Developer API enabled
- [ ] Service account linked to Play Console
- [ ] App created in Play Console (`ai.opencode.mobile`)
- [ ] First AAB manually uploaded (internal track)
- [ ] GitHub secret set: `PLAY_STORE_SERVICE_ACCOUNT_JSON`

---

## Step 1: Create Google Cloud Project

1. Go to: https://console.cloud.google.com/
2. "Select a project" → "New Project"
3. Name: `opencode-mobile-deploy`
4. Click "Create"

## Step 2: Create Service Account

1. IAM & Admin → Service Accounts
2. "Create Service Account"
3. Name: `playstore-deploy`
4. Description: `Automated Play Store deployment for ai.opencode.mobile`
5. "Create and Continue" → skip role → "Done"

## Step 3: Download JSON Key

1. Click service account → "Keys" tab
2. "Add Key" → "Create new key" → JSON → "Create"
3. File downloads automatically — save to Bitwarden as `PLAY_STORE_SERVICE_ACCOUNT_JSON`
4. **NEVER commit to git**

## Step 4: Enable Play Developer API

1. APIs & Services → Library
2. Search: `Google Play Android Developer API`
3. Click "Enable"

## Step 5: Link Cloud Project to Play Console

1. https://play.google.com/console/
2. All apps → (select `ai.opencode.mobile`)
3. Setup → API access
4. "Link a Google Cloud project" → select `opencode-mobile-deploy`
5. "Link"

## Step 6: Grant Service Account Permissions

1. Play Console → Setup → API access → Service accounts
2. Find `playstore-deploy@...` → "Grant access"
3. Check: **"Release to production, exclude devices, and use Play App Signing"**
4. "Apply" → "Invite user"

## Step 7: First Manual Upload (REQUIRED before CI can deploy)

Google Play requires at least one manual upload before automated CI uploads work.

```bash
# Build AAB locally (in the opencode-mobile repo)
cd android
RELEASE_STORE_FILE=../keystores/production-release.jks \
RELEASE_STORE_PASSWORD=$(cat ../keystores/KEYSTORE_INFO.txt | grep "Store Password:" | head -1 | awk '{print $NF}') \
RELEASE_KEY_ALIAS=upload \
RELEASE_KEY_PASSWORD=$(cat ../keystores/KEYSTORE_INFO.txt | grep "Store Password:" | head -1 | awk '{print $NF}') \
./gradlew bundleRelease
```

Then in Play Console:
1. Internal testing → "Create new release"
2. Upload `android/app/build/outputs/bundle/release/app-release.aab`
3. Complete store listing (title, description, icon)
4. Complete app content declarations
5. "Save and publish"

## Step 8: Add Service Account JSON to GitHub

```bash
# After downloading the JSON key from Google Cloud:
cat /path/to/service-account.json | \
  gh secret set PLAY_STORE_SERVICE_ACCOUNT_JSON --repo dzianisv/opencode-mobile
```

## Step 9: Test CI Deployment

Trigger workflow manually:
```bash
gh workflow run publish-play-store.yml --repo dzianisv/opencode-mobile
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Tag number over 30 is not supported` | Corrupt keystore | ✅ Fixed — new PKCS12 keystore generated |
| `Package not found` | App not in Play Console | Complete Step 7 (first manual upload) |
| `Permission denied` for service account | Permissions not propagated | Wait 5-10 min after Step 6 |
| `serviceAccountJsonPlainText` invalid | Wrong JSON format | Use raw JSON, not base64 |
