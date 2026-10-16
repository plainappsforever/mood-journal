// REVIEW_V2 S13 / RELEASE_KIT 1c row 3 (D88): the expo-widgets extension reads and writes App Group
// UserDefaults (node_modules/expo-widgets/ios/WidgetsStorage.swift), but the package ships no privacy
// manifest and the generated ExpoWidgetsTarget has none, while Apple checks required-reason APIs per
// bundle (ITMS-91053). This writes ios/ExpoWidgetsTarget/PrivacyInfo.xcprivacy and adds it to the
// extension's Resources phase. List this plugin BEFORE expo-widgets in app.config.ts: mods of the
// same type run last-registered-first, so this one then runs after the widget target exists.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'ExpoWidgetsTarget';
const FILE = 'PrivacyInfo.xcprivacy';
const REF_PATH = `${TARGET}/${FILE}`;

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>1C8F.1</string>
        <string>CA92.1</string>
      </array>
    </dict>
  </array>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyTracking</key>
  <false/>
</dict>
</plist>
`;

function withManifestFile(config) {
  return withDangerousMod(config, [
    'ios',
    async (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, FILE), MANIFEST);
      return mod;
    },
  ]);
}

function withManifestInTarget(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const targetUuid = project.findTargetKey(TARGET);
    if (!targetUuid) return mod; // WIDGETS=0 build: no extension
    const refs = project.pbxFileReferenceSection();
    const already = Object.values(refs).some((ref) => typeof ref === 'object' && String(ref.path).replace(/"/g, '') === REF_PATH);
    if (already) return mod;
    const { buildPhase } = project.addBuildPhase([REF_PATH], 'PBXResourcesBuildPhase', 'Resources', targetUuid);
    const buildFile = project.pbxBuildFileSection()[buildPhase.files[0].value];
    const ref = refs[buildFile.fileRef];
    ref.name = FILE;
    ref.lastKnownFileType = 'text.xml';
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup({ fileRef: buildFile.fileRef, basename: FILE }, mainGroup);
    return mod;
  });
}

module.exports = function withWidgetPrivacyManifest(config) {
  return withManifestInTarget(withManifestFile(config));
};
