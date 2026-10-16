// Ported from print-cost (D11, D83 note) in Mood P11 (review M1, SPEC Honest promises, D13, A16).
// Removes android.permission.INTERNET from the Android manifest in preview and production: development builds
// need it to reach Metro. Release JS is embedded and the app uses no network; links open in the browser, which is
// another app with its own permission. Two parts: drop the permission Expo's prebuild template declares in the app
// manifest, and add a tools:node="remove" marker so a library manifest cannot bring it back during the manifest merge.
// Applied to EVERY variant (print-cost D83 note). `expo prebuild --no-clean` keeps the manifest an earlier release prebuild
// wrote, so a development prebuild must take the remove markers (INTERNET and the release-only blockedPermissions) out
// again and put INTERNET back: without that the dev client crashed at start ("NsdService: … no INTERNET").
const { withAndroidManifest } = require('expo/config-plugins');

const INTERNET = 'android.permission.INTERNET';
const RELEASE_ONLY_BLOCKED = [
  INTERNET,
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.VIBRATE',
];

module.exports = function withNoInternet(config, { release } = { release: true }) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const perms = manifest['uses-permission'] ?? [];
    if (release) {
      const others = perms.filter((p) => p.$['android:name'] !== INTERNET);
      others.push({ $: { 'android:name': INTERNET, 'tools:node': 'remove' } });
      manifest['uses-permission'] = others;
    } else {
      const kept = perms.filter((p) => !(p.$['tools:node'] === 'remove' && RELEASE_ONLY_BLOCKED.includes(p.$['android:name'])));
      if (!kept.some((p) => p.$['android:name'] === INTERNET)) kept.push({ $: { 'android:name': INTERNET } });
      manifest['uses-permission'] = kept;
    }
    return mod;
  });
};
