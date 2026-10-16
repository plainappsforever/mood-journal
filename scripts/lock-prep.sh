#!/usr/bin/env bash
# Lock flow precondition on THIS app's Android emulator: a screen-lock PIN (1234), so the app lock can ask for the
# device credential. Usage: scripts/lock-prep.sh [set|clear]
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
serial=$(scripts/boot.sh android)
if [[ ${1:-set} == clear ]]; then
  adb -s "$serial" shell locksettings clear --old 1234 >/dev/null
else
  adb -s "$serial" shell locksettings set-pin 1234 >/dev/null
fi
echo "lock ${1:-set} on $serial"
