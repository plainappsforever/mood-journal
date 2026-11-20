// P10b review S3 (port of eye-app's plugin): Mood schedules only local reminders and uses no push, but the generated iOS
// entitlements carried `aps-environment` (expo-notifications adds it for local reminders too; `prebuild --no-clean`
// keeps what an earlier prebuild wrote). The key would add the Push capability to
// the App ID at the first device build and invite a review question. Removed here; listed early in app.config.ts so
// it runs after the other entitlement mods (mods of one type run last-registered-first).
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
