// Mood P11 (release-build findings, V1_LOG P11): two manifest/plist facts every variant must get right.
// 1. Own URL scheme only. `expo prebuild --no-clean` (deletion rule) keeps the schemes an earlier prebuild of ANOTHER
//    variant wrote, so the preview APK also answered `moodjournal-dev://` (the dev app's links and widget faces). Every
//    variant now removes the other variants' schemes from the main activity (Android) and CFBundleURLTypes (iOS).
//    The same leftover put the dev variant's App Group next to the preview one in the app's entitlements (a production
//    build would then need `group.…moodjournal.dev` on its App ID): other variants' groups are removed too.
//    And expo-widgets reuses an existing widget target's build configuration without updating its bundle id, so the
//    preview app embedded `…moodjournal.dev.ExpoWidgetsTarget` ("Embedded binary's bundle identifier is not prefixed with
//    the parent app's"): bundle ids that start with another variant's id are moved to this variant's id. Registered
//    BEFORE expo-widgets in app.config.ts, so this mod runs after it.
// 2. Camera optional (Android). The CAMERA permission ("Take photo") makes Play treat android.hardware.camera as a
//    REQUIRED feature and hide the app from devices without one; photos also come from the picker, so it is optional.
const { withAndroidManifest, withEntitlementsPlist, withInfoPlist, withXcodeProject, AndroidConfig } = require('expo/config-plugins');

/** `com.x.dev.ExpoWidgetsTarget` → `com.x.preview.ExpoWidgetsTarget` when `com.x.dev` is another variant's id. */
function moveBundleId(value, ownId, otherIds) {
  const raw = String(value).replace(/^"|"$/g, '');
  // The longest matching id decides (production's id is a prefix of the other two).
  const match = [ownId, ...otherIds].filter((o) => raw === o || raw.startsWith(`${o}.`)).sort((x, y) => y.length - x.length)[0];
  return match && match !== ownId ? `"${ownId}${raw.slice(match.length)}"` : value;
}


module.exports = function withVariantManifest(config, { otherSchemes = [], otherGroups = [], ownId, otherIds = [] } = {}) {
  if (ownId) {
    config = withXcodeProject(config, (mod) => {
      const configs = mod.modResults.pbxXCBuildConfigurationSection();
      for (const entry of Object.values(configs)) {
        const settings = entry?.buildSettings;
        if (settings?.PRODUCT_BUNDLE_IDENTIFIER) settings.PRODUCT_BUNDLE_IDENTIFIER = moveBundleId(settings.PRODUCT_BUNDLE_IDENTIFIER, ownId, otherIds);
      }
      return mod;
    });
  }
  const foreign = (s) => otherSchemes.includes(s);
  config = withEntitlementsPlist(config, (mod) => {
    const key = 'com.apple.security.application-groups';
    if (Array.isArray(mod.modResults[key])) mod.modResults[key] = mod.modResults[key].filter((g) => !otherGroups.includes(g));
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    if (Array.isArray(plist.CFBundleURLTypes)) {
      plist.CFBundleURLTypes = plist.CFBundleURLTypes.map((t) => ({ ...t, CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !foreign(s)) })).filter(
        (t) => t.CFBundleURLSchemes.length > 0
      );
    }
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    for (const activity of app.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (filter.data) filter.data = filter.data.filter((d) => !foreign(d.$?.['android:scheme']));
      }
    }
    const features = (manifest['uses-feature'] ?? []).filter((f) => f.$?.['android:name'] !== 'android.hardware.camera');
    features.push({ $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } });
    manifest['uses-feature'] = features;
    return mod;
  });
};
module.exports.moveBundleId = moveBundleId;
