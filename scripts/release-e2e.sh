#!/usr/bin/env bash
# Release-build checks (P11) on THIS app's simulator/emulator, against the installed preview (or production) build.
# Usage: scripts/release-e2e.sh <ios|android> <core|cold|20k|lang> [languages…]   (VARIANT=preview by default)
#   core  first launch, two-tap entry, Stats, About/privacy link, dev links inert   (.maestro/release/core.yaml)
#   cold  stops the app, sends the widget's own link <scheme>://new?mood=3 cold, checks the editor (cold-link.yaml)
#   20k   new folder with a 20,000-row Daylio CSV (S9_CSV, made by the P11 generator), import + automatic backup + restore
#   lang  per language: clear the app, set its language, fresh launch in that language (languages.yaml)
# Writes nothing outside artifacts/ and the new MoodRelease<time> folder (never deleted; the owner may clear them).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: release-e2e.sh <ios|android> <core|cold|20k|lang> [languages…]}
what=${2:?Usage: release-e2e.sh <ios|android> <core|cold|20k|lang> [languages…]}
shift 2
variant=${VARIANT:-preview}
read -r app_id scheme < <(APP_VARIANT=$variant npx expo config --json --type public | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(c.ios.bundleIdentifier, c.scheme)')
device=$(scripts/boot.sh "$platform")
run() { MAESTRO_ENV="FACE_MATCH=0 SCHEME=$scheme $1" scripts/e2e.sh "$platform" "$variant" "${@:2}"; }
case $what in
  core) run "" .maestro/release/core.yaml ;;
  cold)
    url="$scheme://new?mood=3"
    if [[ $platform == android ]]; then
      adb -s "$device" shell am force-stop "$app_id"
      start=$(date +%s)
      # exactly the widget's PendingIntent (modules/mood-widget: ACTION_VIEW, the link, setPackage, NEW_TASK)
      adb -s "$device" shell am start -W -a android.intent.action.VIEW -d "'$url'" -p "$app_id" -f 0x10000000 | grep -E "Status|TotalTime|WaitTime" || true
    else
      xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
      xcrun simctl openurl "$device" "$url"
    fi
    run "" .maestro/release/cold-link.yaml ;;
  20k)
    folder="MoodRelease$(date +%H%M%S)"
    csv=${S9_CSV:?set S9_CSV to the generated 20,000-row Daylio CSV}
    file=$(basename "$csv")
    if [[ $platform == android ]]; then
      adb -s "$device" shell mkdir -p "/sdcard/Download/$folder" "/sdcard/Download/$folder-b"
      adb -s "$device" push "$csv" "/sdcard/Download/$folder/$file" >/dev/null
      adb -s "$device" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$folder/$file" >/dev/null || true
    else
      base=$(scripts/ios-files-root.sh "$device")
      mkdir -p "$base/$folder" "$base/$folder-b"
      cp "$csv" "$base/$folder/$file"
    fi
    echo "folder: $folder"
    run "FOLDER=$folder BFOLDER=$folder-b FILE=${file%.csv}" .maestro/release/import-20k.yaml ;;
  lang)
    langs=("$@")
    [[ ${#langs[@]} -gt 0 ]] || langs=(ar ja)
    mkdir -p artifacts/languages
    status=0
    for lang in "${langs[@]}"; do
      read -r question mood4 backup < <(node scripts/l10n-words.mjs "$lang")
      echo "== $lang: '$question' / '$mood4' / '$backup'"
      run "" .maestro/release/clear.yaml || status=1
      if [[ $platform == android ]]; then
        adb -s "$device" shell cmd locale set-app-locales "$app_id" --locales "$lang"
        adb -s "$device" shell am force-stop "$app_id"
      else
        xcrun simctl spawn "$device" defaults write "$app_id" AppleLanguages -array "$lang"
        xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
      fi
      run "QUESTION=$question MOOD4=$mood4 BACKUP=$backup" .maestro/release/languages.yaml || status=1
      if [[ $platform == android ]]; then
        adb -s "$device" exec-out screencap -p >"artifacts/languages/$lang-android-$variant.png"
      else
        xcrun simctl io "$device" screenshot "artifacts/languages/$lang-ios-$variant.png" >/dev/null 2>&1
      fi
    done
    if [[ $platform == android ]]; then adb -s "$device" shell cmd locale set-app-locales "$app_id" --locales en; else xcrun simctl spawn "$device" defaults write "$app_id" AppleLanguages -array en; fi
    exit $status ;;
  *) echo "unknown check: $what" >&2; exit 2 ;;
esac
