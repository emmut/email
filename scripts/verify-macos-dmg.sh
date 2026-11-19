#!/usr/bin/env bash
# Verify the app actually shipped to Sparkle, as well as the build directory.
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: $0 <update.dmg>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOUNT_DIR="$(mktemp -d)"
trap 'rmdir "$MOUNT_DIR"' EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_DIR" "$1" >/dev/null
trap 'hdiutil detach "$MOUNT_DIR" >/dev/null; if [ -d "$MOUNT_DIR" ]; then rmdir "$MOUNT_DIR"; fi' EXIT

bash "$SCRIPT_DIR/verify-macos-update.sh" "$MOUNT_DIR/Email.app"
