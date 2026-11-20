#!/usr/bin/env bash
# App Store screenshots, iPhone 6.9" (1320 x 2868): Home, entry editor, Stats, activity detail, calendar month - in English, then in
# German - captured by Maestro (.maestro/screenshots/shots.yaml) on the PRODUCTION Release build installed on a 6.9-inch simulator,
# with a clean status bar (9:41, full battery and signal). Ported from loyalty-cards/scripts/screenshots.sh (which uses preview).
# Usage: scripts/screenshots.sh
#   Build first (once): IOS_SIMULATOR="Mood Shots iPhone" IOS_DEVICE_TYPE="iPhone 17 Pro Max" IOS_RUNTIME=27.0 scripts/native.sh ios production
#   Photograph on iOS 26.5, NOT 27.0: on the 27.0 simulator the Release build draws no react-native-svg charts (Stats, 2026-11-06).
#   A production build has no seed route (debug/* is dev-only), so scripts/store-demo.py writes the fictional journal straight into
#   the simulator's app.db while the app is stopped (language per run: the app's AppleLanguages preference, then restored).
# Output: artifacts/screenshots/ios/{en,de}/0N-<name>.png (the folders scripts/asc-submit.py `shots` reads) and a copy under
#   artifacts/screenshots/ios-6.9in/{en-US,de-DE}/. PNGs are converted to RGB without alpha. artifacts/ is git-ignored.
# Nothing leaves the Mac. Status-bar override and app language are reset at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

export IOS_SIMULATOR="${SCREENSHOT_IOS_SIM:-Mood Shots iPhone 26.5}"
export IOS_DEVICE_TYPE="${IOS_DEVICE_TYPE:-iPhone 17 Pro Max}"
export IOS_RUNTIME="${SCREENSHOT_IOS_RUNTIME:-26.5}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-400000}"
app_id=com.plainapps.moodjournal
scheme=moodjournal
dest="artifacts/screenshots/ios"
run="artifacts/maestro/ios-production-screenshots-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest/en" "$dest/de" "artifacts/screenshots/ios-6.9in/en-US" "artifacts/screenshots/ios-6.9in/de-DE" "$run"

device=$(scripts/boot.sh ios)
# Always the newest Release build of the production app (Mood.app), so a stale copy is never photographed.
app=$(ls -dt "$HOME/Library/Developer/Xcode/DerivedData/Mood-"*/Build/Products/Release-iphonesimulator/Mood.app 2>/dev/null | head -1 || true)
[[ -n $app ]] || { echo "No Mood.app Release build found. Run: scripts/native.sh ios production" >&2; exit 1; }
echo "Installing $app on $IOS_SIMULATOR"
xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
xcrun simctl install "$device" "$app"
xcrun simctl ui "$device" appearance light >/dev/null 2>&1 || true
xcrun simctl status_bar "$device" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100
cleanup() {
  xcrun simctl status_bar "$device" clear >/dev/null 2>&1 || true
  xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
  xcrun simctl spawn "$device" defaults delete "$app_id" AppleLanguages >/dev/null 2>&1 || true
  xcrun simctl spawn "$device" defaults delete "$app_id" AppleLocale >/dev/null 2>&1 || true
}
trap cleanup EXIT

# One start so the app creates app.db (schema + defaults), then stop it.
xcrun simctl launch "$device" "$app_id" >/dev/null
container=$(xcrun simctl get_app_container "$device" "$app_id" data)
db="$container/Documents/SQLite/app.db"
for _ in $(seq 1 60); do [[ -f $db ]] && break; sleep 3; done   # a loaded Mac needs a while for the first start
sleep 10 # let the migrations and the defaults finish
xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
[[ -f $db ]] || { echo "app.db not found at $db" >&2; exit 1; }

status=0
for lang in ${SHOT_LANGS:-en de}; do
  case $lang in en) loc=en_US ;; de) loc=de_DE ;; esac
  xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
  xcrun simctl spawn "$device" defaults write "$app_id" AppleLanguages -array "$lang"
  xcrun simctl spawn "$device" defaults write "$app_id" AppleLocale -string "$loc"
  python3 -I scripts/store-demo.py "$db" "$lang"
  # The first Maestro start on a loaded Mac often hits "iOS driver not ready in time": one rerun, alone, before judging.
  for attempt in 1 2; do
    if maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" -e SHOTS="$lang" \
      --test-output-dir "$run" .maestro/screenshots/shots.yaml; then break; fi
    [[ $attempt == 2 ]] && status=1
    sleep 20
  done
done

# Maestro 2.x files each takeScreenshot under <output>/<run>/<flow>/takeScreenshot/. Strip the alpha channel via BMP.
count=0
for lang in ${SHOT_LANGS:-en de}; do
  [[ $lang == en ]] && loc=en-US || loc=de-DE
  for name in 01-home 02-editor 03-stats 04-activity 05-calendar; do
    shot=$(find "$run" -name "$lang-$name.png" | head -1)
    if [[ -z $shot ]]; then echo "MISSING: $lang-$name" >&2; status=1; continue; fi
    sips -s format bmp "$shot" --out "$run/$lang-$name.bmp" >/dev/null
    sips -s format png "$run/$lang-$name.bmp" --out "$dest/$lang/$name.png" >/dev/null
    cp "$dest/$lang/$name.png" "artifacts/screenshots/ios-6.9in/$loc/$name.png"
    count=$((count + 1))
  done
done
echo "Screenshots: $count of 10 in $dest (Maestro run: $run)"
for f in "$dest"/en/0*.png "$dest"/de/0*.png; do [[ -f $f ]] && sips -g pixelWidth -g pixelHeight -g hasAlpha "$f" | awk -v f="$f" '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} /hasAlpha/ {a=$2} END {print "  " f ": " w " x " h " alpha=" a}'; done
exit "$status"
