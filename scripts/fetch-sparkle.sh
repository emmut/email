#!/usr/bin/env bash
# Download Sparkle.framework into src-tauri/frameworks/ (macOS only).
# Run automatically by src-tauri/build.rs when the framework is missing.
set -euo pipefail

SPARKLE_VERSION="${SPARKLE_VERSION:-2.8.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/src-tauri/frameworks"

if [ -d "$DEST/Sparkle.framework" ]; then
  exit 0
fi

echo "Downloading Sparkle $SPARKLE_VERSION..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL \
  "https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz" \
  -o "$TMP/sparkle.tar.xz"
tar -xJf "$TMP/sparkle.tar.xz" -C "$TMP" ./Sparkle.framework

mkdir -p "$DEST"
# ditto preserves the framework's symlink structure (cp -R can mangle it)
ditto "$TMP/Sparkle.framework" "$DEST/Sparkle.framework"
echo "Sparkle.framework installed to $DEST"
