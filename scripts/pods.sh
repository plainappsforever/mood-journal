#!/usr/bin/env bash
# Installs the iOS pods after a prebuild (called by native.sh and ios-archive.sh; D92, D95).
# `pod install` refuses to continue when an Expo/React Native package from node_modules changed its podspec version (after an
# `npx expo install` patch update): "You should run `pod update X --no-repo-update`". This runs exactly the updates CocoaPods
# names (local podspecs only, no spec-repo update) and then installs. Prints only on failure. See finish() for the
# React Native prebuilt-core marker.
set -euo pipefail
cd "$(dirname "$0")/../ios"
log=$(mktemp -t moodjournal-pods)
# React Native's prebuilt core keeps one flavour (Debug or Release) in Pods/React-Core-prebuilt and swaps it in a build
# phase by comparing the configuration with the marker file below. `pod install` after a Release build recreated the folder
# without the marker but with the Release framework, so the next Debug build linked it and failed (RCTPackagerConnection
# missing, 2026-10-14). An "unknown" marker makes the next build of either configuration install the right flavour.
# Expo's precompiled modules (Pods/<Pod>/<Product>.xcframework, ExpoModulesCore, ExpoModulesWorklets, ExpoImage, ...) use the
# same scheme with Pods/<Pod>/artifacts/.last_build_configuration, but `pod install` WRITES that marker ("debug") when it
# recreates artifacts/ and keeps the xcframework already there. After a Release build, the next development build therefore
# linked the Release ExpoModulesCore against the Debug React core: SIGBUS in facebook::react::Props::Props() inside
# AppContext.registerNativeViews as soon as the dev app loaded its bundle (2026-10-16; the "dev client dies" of 2026-10-14/15).
# "unknown" makes the next build of either configuration extract the matching flavour.
finish() {
  local marker=Pods/React-Core-prebuilt/.last_build_configuration
  if [[ -d Pods/React-Core-prebuilt && ! -f $marker ]]; then printf unknown >"$marker"; fi
  for marker in Pods/*/artifacts/.last_build_configuration; do
    if [[ -f $marker ]]; then printf unknown >"$marker"; fi
  done
  exit 0
}
update=()
for _ in $(seq 1 15); do
  if pod install >"$log" 2>&1; then finish; fi
  name=$(grep -oE "pod update [A-Za-z0-9_+-]+ --no-repo-update" "$log" | awk '{print $3}' | head -1 || true)
  if [[ -z $name ]]; then cat "$log" >&2; exit 1; fi
  update+=("$name")
  pod update "${update[@]}" --no-repo-update >"$log" 2>&1 || true
done
cat "$log" >&2
exit 1
