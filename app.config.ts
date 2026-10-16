import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
const VARIANTS = {
  development: { name: 'Mood Dev', id: 'com.plainapps.moodjournal.dev', scheme: 'moodjournal-dev' },
  preview: { name: 'Mood Preview', id: 'com.plainapps.moodjournal.preview', scheme: 'moodjournal-preview' },
  production: { name: 'Mood', id: 'com.plainapps.moodjournal', scheme: 'moodjournal' },
} as const;

type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];
const otherSchemes = Object.values(VARIANTS).map((v) => v.scheme).filter((s) => s !== scheme);
const otherGroups = Object.values(VARIANTS).filter((v) => v.id !== id).map((v) => `group.${v.id}`);

// P9 (D20, eye-app D67): iOS "Mood" widget via expo-widgets (adds the ExpoWidgetsTarget extension and an App Group
// group.<bundle id>; simulator builds sign it ad hoc, a device build needs a team id). WIDGETS=0 builds without it.
// Android has its own RemoteViews widget in modules/mood-widget (expo-widgets is excluded from Android autolinking).
const widgetsEnabled = process.env.WIDGETS !== '0';

// P11 (review M3): the development client and its menu defaults are configured for development builds only; release
// variants additionally strip keys an earlier development prebuild left behind (`prebuild --no-clean`).
const release = variant !== 'development';
// Release variants block what nothing in Mood uses (P11, aapt of the first preview APK): storage, overlay, network state,
// Firebase push (no push; reminders are local) and the launcher-badge permissions of expo-notifications' badge library
// (SPEC: no badges, shouldSetBadge false). Same list as warranty-wallet D63.
const RELEASE_BLOCKED = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_NETWORK_STATE',
  'com.google.android.c2dm.permission.RECEIVE',
  'android.permission.READ_APP_BADGE',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'com.majeur.launcher.permission.UPDATE_BADGE',
  'com.huawei.android.launcher.permission.CHANGE_BADGE',
  'com.huawei.android.launcher.permission.READ_SETTINGS',
  'com.huawei.android.launcher.permission.WRITE_SETTINGS',
  'com.oppo.launcher.permission.READ_SETTINGS',
  'com.oppo.launcher.permission.WRITE_SETTINGS',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
];
const DEV_CLIENT_PLUGINS: ([string, { launchMode: string }] | string)[] = [['expo-dev-client', { launchMode: 'most-recent' }], './plugins/with-dev-menu-defaults.js'];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'mood-journal',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    icon: './assets/expo.icon',
  },
  android: {
    package: id,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // P11 (review M1): the app needs no storage, overlay or network-state permission (files come from the system pickers,
    // backups go through SAF / the share sheet). Library manifests add some during the merge, so release variants block
    // them; checked with `aapt dump permissions` on the preview APK (V1_LOG P11).
    ...(release
      ? { blockedPermissions: [...RELEASE_BLOCKED] }
      : {}),
  },
  plugins: [
    // Release variants: no development-client residue (keys, local-network text, exp+ scheme). FIRST, so its mods run after the others'.
    ...(release ? (['./plugins/without-dev-client-residue.js'] as const) : []),
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#208AEF', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    'expo-notifications',
    // 15 UI languages (P10, D11): the phones' per-app language settings list them (iOS CFBundleLocalizations, Android 13+
    // localeConfig) and Arabic lays the UI out right-to-left.
    [
      'expo-localization',
      {
        supportsRTL: true,
        supportedLocales: {
          ios: ['en', 'de', 'ar', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'vi', 'zh-Hans'],
          android: ['en', 'de', 'ar', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'vi', 'zh-CN'],
        },
      },
    ],
    // Face ID only when the lock is switched on (SPEC Principles).
    ['expo-local-authentication', { faceIDPermission: 'Mood uses Face ID to unlock your journal when you turn the lock on.' }],
    '@react-native-community/datetimepicker',
    // Photos come from the system photo picker (no permission). The camera is asked for only at the first "Take photo"
    // (SPEC Principles); microphone blocked.
    [
      'expo-image-picker',
      {
        photosPermission: 'Mood lets you add photos from your library to a journal entry. Photos stay on your phone.',
        cameraPermission: 'Mood uses the camera when you take a photo for a journal entry. Photos stay on your phone.',
        microphonePermission: false,
      },
    ],
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended (development only, M3).
    ...(release ? [] : DEV_CLIENT_PLUGINS),
    // Android cloud backup (Drive) takes nothing of the journal; device-to-device transfer keeps everything (SPEC Privacy).
    './plugins/with-backup-rules.js',
    // P11: Firebase push components of expo-notifications removed (no push, no google-services.json), every variant.
    './plugins/without-firebase-push.js',
    // P11: only this variant's URL scheme and App Group (prebuild --no-clean kept the dev ones); camera optional.
    ['./plugins/with-variant-manifest.js', { otherSchemes, otherGroups, ownId: id, otherIds: Object.values(VARIANTS).map((v) => v.id).filter((v) => v !== id) }],
    ...(widgetsEnabled
      ? [
          // Before expo-widgets on purpose (its target must exist when this plugin's mod runs; eye-app D88).
          './plugins/with-widget-privacy-manifest.js',
          [
            'expo-widgets',
            {
              enableAndroid: false,
              widgets: [
                {
                  name: 'MoodWidget',
                  displayName: 'Mood',
                  // One string for every language (expo-widgets); says what a tap does (review S1, L26).
                  description: 'Tap a face to start an entry. Shows your streak.',
                  supportedFamilies: ['systemSmall', 'systemMedium', 'accessoryCircular', 'accessoryRectangular'],
                  contentMarginsDisabled: false,
                },
              ],
            },
          ] as [string, unknown],
        ]
      : []),
    // Xcode 27 / iOS 27 SDK: apps without the UIScene lifecycle trap at launch. SDK 57 opt-in (expo >= 57.0.23,
    // expo-build-properties >= 57.0.20); SDK 58+ has it by default, then remove this line. See docs/DECISIONS.md D9.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
    // D13 / A16 (review M1): no INTERNET in preview and production; development keeps it to reach Metro (the plugin puts it
    // back there after a release prebuild, print-cost D83 note).
    ['./plugins/with-no-internet.js', { release }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
    widgetsEnabled,
  },
});
