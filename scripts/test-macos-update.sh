#!/usr/bin/env bash
# Exercise real Apple signing and disk images without compiling the app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

expect_rejection() {
  if "$@"; then
    echo "Expected verification to reject: $*" >&2
    exit 1
  fi
}

expect_rejection bash "$SCRIPT_DIR/verify-macos-update.sh" "$TEST_DIR/Missing.app"

APP="$TEST_DIR/image/Email.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp /bin/echo "$APP/Contents/MacOS/Email"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Email</string>
  <key>CFBundleIdentifier</key><string>com.emiljansson.email.signing-test</string>
  <key>CFBundleName</key><string>Email</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
echo original > "$APP/Contents/Resources/test.txt"
expect_rejection bash "$SCRIPT_DIR/verify-macos-update.sh" "$APP"
codesign --force --sign - "$APP"
bash "$SCRIPT_DIR/verify-macos-update.sh" "$APP"

ditto "$APP" "$TEST_DIR/Tampered.app"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Tampered' "$TEST_DIR/Tampered.app/Contents/Info.plist"
expect_rejection bash "$SCRIPT_DIR/verify-macos-update.sh" "$TEST_DIR/Tampered.app"

# Paths with spaces also exercise mounting and cleanup.
hdiutil create -quiet -volname Email -srcfolder "$TEST_DIR/image" "$TEST_DIR/Valid update.dmg"
bash "$SCRIPT_DIR/verify-macos-dmg.sh" "$TEST_DIR/Valid update.dmg"

echo modified > "$APP/Contents/Resources/test.txt"
expect_rejection bash "$SCRIPT_DIR/verify-macos-update.sh" "$APP"
hdiutil create -quiet -volname Email -srcfolder "$TEST_DIR/image" "$TEST_DIR/Tampered update.dmg"
expect_rejection bash "$SCRIPT_DIR/verify-macos-dmg.sh" "$TEST_DIR/Tampered update.dmg"

echo 'macOS update signing checks passed'
