#!/usr/bin/env bash
# Runs the lock flow on THIS app's iOS simulator: enrols simulated Face ID, then serves http://localhost:8213/match —
# the flow calls it (runScript, .maestro/scripts/face-match.js) exactly when a Face ID sheet is up, and this posts the
# simulator's Face ID "match". Usage: scripts/lock-ios.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
udid=$(scripts/boot.sh ios)
xcrun simctl spawn "$udid" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit.enrollmentChanged
node -e '
  const { execFileSync } = require("node:child_process");
  require("node:http").createServer((req, res) => {
    if (req.url === "/match") execFileSync("xcrun", ["simctl", "spawn", process.argv[1], "notifyutil", "-p", "com.apple.BiometricKit_Sim.pearl.match"]);
    res.end("ok");
  }).listen(8213, "127.0.0.1");' "$udid" &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 1
MAESTRO_ENV="FACE_MATCH=1" scripts/e2e.sh ios development .maestro/lock.yaml
