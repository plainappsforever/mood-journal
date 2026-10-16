#!/usr/bin/env bash
# Prints the Mac path of "On My iPhone" (Files app local storage) of a simulator. Usage: scripts/ios-files-root.sh <udid>
set -euo pipefail
udid=${1:?Usage: ios-files-root.sh <udid>}
group=$(xcrun simctl get_app_container "$udid" com.apple.DocumentsApp groups | awk -F'\t' '$1 == "group.com.apple.FileProvider.LocalStorage" { print $2 }')
[[ -n $group ]] || { echo "no Files local storage on $udid" >&2; exit 1; }
echo "$group/File Provider Storage"
