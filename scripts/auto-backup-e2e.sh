#!/usr/bin/env bash
# Automatic-backup flows (A7) on THIS app's simulator/emulator: makes a new empty folder, runs auto-backup.yaml,
# makes the folder unreachable WITHOUT deleting anything, runs auto-backup-broken.yaml, then undoes that.
# Android: the folder is moved away (the SAF tree URI then points nowhere). iOS: a security-scoped bookmark FOLLOWS a
# moved folder (that is a feature), so the folder is made read-only instead (chmod), then writable again.
# Usage: scripts/auto-backup-e2e.sh <ios|android>   (Metro must run, like e2e.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: auto-backup-e2e.sh <ios|android>}
folder="MoodRun$(date +%H%M%S)"
device=$(scripts/boot.sh "$platform")
if [[ $platform == android ]]; then
  base=/sdcard/Download
  adb -s "$device" shell mkdir -p "$base/$folder"
  break_it() { adb -s "$device" shell mv "$base/$folder" "$base/$folder-moved"; }
  undo() { adb -s "$device" shell mv "$base/$folder-moved" "$base/$folder"; }
  list() { adb -s "$device" shell ls "$base/$folder" || true; }
else
  # "On My iPhone" of the simulator = the Files app's local storage provider (File Provider Storage).
  base=$(scripts/ios-files-root.sh "$device")
  mkdir -p "$base/$folder"
  break_it() { chmod a-w "$base/$folder"; }
  undo() { chmod u+w "$base/$folder"; }
  list() { ls "$base/$folder" || true; }
fi
echo "auto-backup folder: $folder"
status=0
MAESTRO_ENV="FACE_MATCH=0 FOLDER=$folder" scripts/e2e.sh "$platform" development .maestro/auto-backup.yaml || status=1
echo "files in $folder:"; list
break_it
MAESTRO_ENV="FACE_MATCH=0 FOLDER=$folder" scripts/e2e.sh "$platform" development .maestro/auto-backup-broken.yaml || status=1
undo
exit $status
