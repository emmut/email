#!/usr/bin/env bash
# Recompile the Liquid Glass app icon (src-tauri/icons/mail.icon) into
# src-tauri/icons/Assets.car, bundled via tauri.conf.json (bundle.macOS.files)
# with CFBundleIconName=mail set in src-tauri/Info.plist.
# Requires Xcode 26+ (actool with .icon support).
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

actool src-tauri/icons/mail.icon \
  --compile "$out" \
  --platform macosx \
  --minimum-deployment-target 26.0 \
  --app-icon mail \
  --output-partial-info-plist "$out/partial.plist" >/dev/null

cp "$out/Assets.car" src-tauri/icons/Assets.car
echo "Updated src-tauri/icons/Assets.car"
echo "Note: flat fallback icons (icns/ico/pngs) are generated separately via 'pnpm tauri icon <1024px png>'."
