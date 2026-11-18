#!/usr/bin/env bash
# Check the complete .app before packaging/publishing a Sparkle update.
# A linker-generated signature on the Mach-O alone does not seal the bundle.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <app-bundle>" >&2
  exit 1
fi

APP="$1"
if [ ! -d "$APP" ]; then
  echo "App bundle does not exist: $APP; retain it with 'tauri build --bundles app,dmg'." >&2
  exit 1
fi
if [ ! -s "$APP/Contents/_CodeSignature/CodeResources" ]; then
  echo "Missing bundle resource signature: $APP; build with a macOS signing identity (ad-hoc '-' is supported)." >&2
  exit 1
fi

# --deep is for verification only: Tauri signs nested code inside-out.
codesign --verify --deep --strict --verbose=2 "$APP"
