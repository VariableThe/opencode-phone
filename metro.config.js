// Metro bundler config.
//
// Wraps Expo's default Metro config with Sentry's config so the JS bundle
// gets a Debug ID embedded at build time (see
// https://docs.sentry.io/platforms/react-native/manual-setup/metro/).
//
// Why this matters: without this, Metro/Hermes produce bundles + source maps
// with NO debug ID. `android/sentry.gradle` (applied from
// android/app/build.gradle) then falls back to associating the uploaded
// source map with Sentry purely by `--release`/`--dist` string matching
// (see its `has-sourcemap-debugid.js` check). That legacy path is fragile —
// it silently breaks if the release/dist Gradle computes for the upload
// ever drifts from the release/dist the app reports at runtime via
// `Sentry.init()` (src/lib/sentry.ts). Debug ID matching sidesteps that
// entire class of bug: the bundle and its source map are linked by an
// embedded ID, independent of any release/dist string.
const { getSentryExpoConfig } = require("@sentry/react-native/metro")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname)

module.exports = config
