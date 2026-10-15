# Play Console — App content answers (cc.agentlabs.opencode)

Draft answers based on the app's ACTUAL behavior, to make the Console "App content"
section fast to complete. **You are legally attesting to these — review each against
current code before submitting.** Console path: Play Console → app → Monitor and
improve → Policy → App content.

App facts these answers derive from:
- The app is a client for a USER-self-hosted opencode server. AI traffic goes from
  the app directly to the user's own server. No backend operated by us.
- Crash reporting (Sentry) is OPT-IN, default OFF (`TelemetryConsentModal`).
- No ads, no analytics SDK, no third-party tracking.
- Connection settings + optional credentials stored locally via expo-secure-store
  (encrypted on-device). Biometric unlock uses the OS; no biometric data leaves device.

---

## 1. Privacy policy
- URL: `https://dzianisv.github.io/opencode-mobile/privacy/`

## 2. Data safety
**Does your app collect or share any required user data types?**
- If Sentry stays default-OFF and you treat opt-in diagnostics as collected:
  - **Data collected: Yes** → "App activity / Crash logs" and "App info and
    performance / Diagnostics". Collected = Yes, Shared = No, Processed
    ephemerally = No, **Optional** (user opt-in), purpose = App functionality /
    Analytics (crash diagnostics).
  - Everything else (personal info, location, messages, files, contacts): **Not
    collected** — they never leave the user's own server; the app stores
    connection settings locally only.
- Data encrypted in transit: **Yes** (HTTPS to server when user uses TLS; note the
  app also allows user-chosen HTTP to self-hosted servers).
- Users can request deletion: data is local/on the user's own server; no account.

## 3. Content rating (IARC questionnaire)
- Category: **Utility / Productivity / Tools** (developer tool).
- Violence / sexual / profanity / controlled substances / gambling / horror: **No**
  to all.
- Does the app let users interact / communicate: the app talks to the user's OWN
  server (the user's AI agent); no user-to-user social features, no shared content
  between users. Answer the "user communication / shares location" prompts as **No**
  (no inter-user communication).
- User-generated content shared publicly: **No**.
- Expected result: **Everyone / PEGI 3** (or similar).

## 4. Target audience and content
- Target age group: **18+** (or 13+/general) — a developer tool, **not** designed
  for or appealing to children.
- "Appeals to children": **No**.
- → avoids Families policy obligations.

## 5. Other declarations
- **Ads**: app contains **No ads**.
- **Government app**: No.
- **Financial features**: No.
- **Health**: No.
- **Data collection from children**: No.
- **News app**: No.
- **COVID-19 / contact tracing**: No.

## After App content is complete
1. Production → Create new release → the v0.4.3 AAB (uploaded via CI to the
   internal track) should be available to promote/add; or upload
   `android/app/build/outputs/bundle/release/app-release.aab`.
2. Select countries/regions (all, unless restricting).
3. Roll out to Production → Send for review. Google review: hours–days.
4. Once live, the public listing appears at
   `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` — then fire
   the launch posts in `distribution/launch/`.
