// P11 (review M1, M3): what the release-configuration plugins write. Runs the plugins' own mods on a small manifest /
// Info.plist, so a refactor that stops removing INTERNET or the dev-client keys fails `npm run verify`.
const withNoInternet = require('./with-no-internet');
const withoutDevClientResidue = require('./without-dev-client-residue');

const INTERNET = 'android.permission.INTERNET';

async function runMod(config, platform, name, modResults) {
  const mod = config.mods[platform][name];
  const out = await mod({ ...config, modResults, modRequest: { platform, modName: name, projectRoot: '/tmp', platformProjectRoot: '/tmp', introspect: true } });
  return out.modResults;
}

const manifest = (perms, extra = {}) => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    'uses-permission': perms.map((p) => ({ $: { 'android:name': p } })),
    application: [{ $: { 'android:name': '.MainApplication' }, ...extra }],
  },
});

const names = (m, node) => (m.manifest['uses-permission'] ?? []).filter((p) => (node ? p.$['tools:node'] === node : !p.$['tools:node'])).map((p) => p.$['android:name']);

test('release builds remove INTERNET and mark it tools:node="remove" (A16, D13)', async () => {
  const out = await runMod(withNoInternet({ name: 'Mood', slug: 'mood-journal' }, { release: true }), 'android', 'manifest', manifest([INTERNET, 'android.permission.POST_NOTIFICATIONS']));
  expect(names(out)).toEqual(['android.permission.POST_NOTIFICATIONS']);
  expect(names(out, 'remove')).toEqual([INTERNET]);
  expect(out.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
});

test('a development prebuild after a release one puts INTERNET back (dev client needs Metro)', async () => {
  const released = manifest(['android.permission.POST_NOTIFICATIONS']);
  released.manifest['uses-permission'].push({ $: { 'android:name': INTERNET, 'tools:node': 'remove' } });
  const out = await runMod(withNoInternet({ name: 'Mood', slug: 'mood-journal' }, { release: false }), 'android', 'manifest', released);
  expect(names(out, 'remove')).toEqual([]);
  expect(names(out)).toContain(INTERNET);
});

test('release builds carry no development-client keys, local-network text or exp+ scheme (review M3)', async () => {
  const config = withoutDevClientResidue({ name: 'Mood', slug: 'mood-journal' });
  const plist = await runMod(config, 'ios', 'infoPlist', {
    EXDevMenuShowsAtLaunch: false,
    EXDevMenuIsOnboardingFinished: true,
    NSLocalNetworkUsageDescription: 'Expo Dev Launcher uses the local network',
    NSBonjourServices: ['_expo._tcp'],
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
    NSFaceIDUsageDescription: 'keep me',
    CFBundleURLTypes: [{ CFBundleURLSchemes: ['moodjournal-preview', 'com.plainapps.moodjournal.preview'] }, { CFBundleURLSchemes: ['exp+mood-journal'] }],
  });
  expect(Object.keys(plist).filter((k) => k.startsWith('EXDevMenu'))).toEqual([]);
  expect(plist.NSLocalNetworkUsageDescription).toBeUndefined();
  expect(plist.NSBonjourServices).toBeUndefined();
  expect(plist.NSAppTransportSecurity).toBeUndefined();
  expect(plist.NSFaceIDUsageDescription).toBe('keep me');
  expect(plist.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: ['moodjournal-preview', 'com.plainapps.moodjournal.preview'] }]);

  const out = await runMod(
    config,
    'android',
    'manifest',
    manifest([], {
      'meta-data': [{ $: { 'android:name': 'EXDevMenuShowsAtLaunch', 'android:value': 'false' } }, { $: { 'android:name': 'keep.me', 'android:value': '1' } }],
      activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ data: [{ $: { 'android:scheme': 'moodjournal-preview' } }, { $: { 'android:scheme': 'exp+mood-journal' } }] }] }],
    })
  );
  const app = out.manifest.application[0];
  expect(app['meta-data'].map((m) => m.$['android:name'])).toEqual(['keep.me']);
  expect(app.activity[0]['intent-filter'][0].data.map((d) => d.$['android:scheme'])).toEqual(['moodjournal-preview']);
});

test('every variant answers only its own scheme, and the camera is optional (P11 release findings)', async () => {
  const withVariantManifest = require('./with-variant-manifest');
  const config = withVariantManifest({ name: 'Mood', slug: 'mood-journal' }, { otherSchemes: ['moodjournal-dev', 'moodjournal'] });
  const plist = await runMod(config, 'ios', 'infoPlist', { CFBundleURLTypes: [{ CFBundleURLSchemes: ['moodjournal-preview', 'com.plainapps.moodjournal.preview'] }, { CFBundleURLSchemes: ['moodjournal-dev'] }] });
  expect(plist.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: ['moodjournal-preview', 'com.plainapps.moodjournal.preview'] }]);
  const out = await runMod(
    config,
    'android',
    'manifest',
    manifest([], { activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ data: [{ $: { 'android:scheme': 'moodjournal-dev' } }, { $: { 'android:scheme': 'moodjournal-preview' } }] }] }] })
  );
  expect(out.manifest.application[0].activity[0]['intent-filter'][0].data.map((d) => d.$['android:scheme'])).toEqual(['moodjournal-preview']);
  expect(out.manifest['uses-feature']).toEqual([{ $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } }]);
});

test('Firebase push components are removed from the merged manifest (no push in Mood)', async () => {
  const withoutFirebasePush = require('./without-firebase-push');
  const out = await runMod(withoutFirebasePush({ name: 'Mood', slug: 'mood-journal' }), 'android', 'manifest', manifest([]));
  const app = out.manifest.application[0];
  expect(app.service.map((s) => s.$['tools:node'])).toEqual(app.service.map(() => 'remove'));
  expect(app.service.map((s) => s.$['android:name'])).toContain('com.google.firebase.messaging.FirebaseMessagingService');
  expect(app.provider.map((s) => s.$['android:name'])).toEqual(['com.google.firebase.provider.FirebaseInitProvider']);
});

test('the app keeps only its own App Group (prebuild --no-clean left the dev group in the preview entitlements)', async () => {
  const withVariantManifest = require('./with-variant-manifest');
  const config = withVariantManifest({ name: 'Mood', slug: 'mood-journal' }, { otherGroups: ['group.com.plainapps.moodjournal.dev'] });
  const ent = await runMod(config, 'ios', 'entitlements', {
    'aps-environment': 'development',
    'com.apple.security.application-groups': ['group.com.plainapps.moodjournal.preview', 'group.com.plainapps.moodjournal.dev'],
  });
  expect(ent['com.apple.security.application-groups']).toEqual(['group.com.plainapps.moodjournal.preview']);
  expect(ent['aps-environment']).toBe('development');
});

test('a widget extension bundle id left from another variant moves to this variant (expo-widgets reuses the target)', () => {
  const { moveBundleId } = require('./with-variant-manifest');
  const others = ['com.plainapps.moodjournal.dev', 'com.plainapps.moodjournal'];
  expect(moveBundleId('"com.plainapps.moodjournal.dev.ExpoWidgetsTarget"', 'com.plainapps.moodjournal.preview', others)).toBe('"com.plainapps.moodjournal.preview.ExpoWidgetsTarget"');
  expect(moveBundleId('com.plainapps.moodjournal.dev', 'com.plainapps.moodjournal.preview', others)).toBe('"com.plainapps.moodjournal.preview"');
  // production's id is a prefix of the others: only an exact match or a "." boundary counts
  expect(moveBundleId('"com.plainapps.moodjournal.preview.ExpoWidgetsTarget"', 'com.plainapps.moodjournal.preview', others)).toBe('"com.plainapps.moodjournal.preview.ExpoWidgetsTarget"');
  expect(moveBundleId('"com.plainapps.moodjournal.ExpoWidgetsTarget"', 'com.plainapps.moodjournal.dev', ['com.plainapps.moodjournal.preview', 'com.plainapps.moodjournal'])).toBe('"com.plainapps.moodjournal.dev.ExpoWidgetsTarget"');
});
