#!/usr/bin/env bash
# Language spot-check (P10, A14): sets THIS app's own language (Android 13+ per-app locale; iOS the app's AppleLanguages),
# runs .maestro/languages-smoke.yaml with the expected words, saves a Home screenshot per language under
# artifacts/languages/, then puts the app back to English. Usage: scripts/languages-e2e.sh <ios|android> [de ar ja …]
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: languages-e2e.sh <ios|android> [languages…]}
shift
langs=("$@")
[[ ${#langs[@]} -gt 0 ]] || langs=(de ar ja)
app_id=$(APP_VARIANT=development npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).ios.bundleIdentifier)')
device=$(scripts/boot.sh "$platform")
mkdir -p artifacts/languages
set_lang() {
  if [[ $platform == android ]]; then
    adb -s "$device" shell cmd locale set-app-locales "$app_id" --locales "$1"
    adb -s "$device" shell am force-stop "$app_id"
  else
    xcrun simctl spawn "$device" defaults write "$app_id" AppleLanguages -array "$1"
    xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
  fi
}
status=0
for lang in "${langs[@]}"; do
  read -r question mood4 backup < <(node scripts/l10n-words.mjs "$lang")
  echo "== $lang: '$question' / '$mood4' / '$backup'"
  set_lang "$lang"
  MAESTRO_ENV="FACE_MATCH=0 QUESTION=$question MOOD4=$mood4 BACKUP=$backup" scripts/e2e.sh "$platform" development .maestro/languages-smoke.yaml || status=1
  if [[ $platform == android ]]; then
    adb -s "$device" exec-out screencap -p > "artifacts/languages/$lang-android.png"
  else
    xcrun simctl io "$device" screenshot "artifacts/languages/$lang-ios.png" >/dev/null 2>&1
  fi
done
set_lang en
exit $status
