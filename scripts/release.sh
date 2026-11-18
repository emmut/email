#!/usr/bin/env bash
# Cut a release: synchronize the app version, commit, tag v<version>, and push
# both. CI builds and publishes from the tag.
# usage: scripts/release.sh <version>   e.g. scripts/release.sh 0.1.1
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: scripts/release.sh <version> (e.g. 0.1.1)}"
VERSION="${VERSION#v}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "not a semver version: $VERSION" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree not clean; commit or stash first" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "tag v$VERSION already exists" >&2
  exit 1
fi

# Refuse downgrades before changing files. This compares against every version
# source so a stale manifest cannot make pacman reject the new package.
node scripts/check-release-version.mjs "$VERSION"

# sed keeps Prettier's formatting where JSON round-tripping would reflow it;
# only the first "version" key is the package version in both files
for file in package.json src-tauri/tauri.conf.json; do
  sed -i '0,/"version":/s/"version": "[^"]*"/"version": "'"$VERSION"'"/' "$file"
  grep -q "\"version\": \"$VERSION\"" "$file" || {
    echo "failed to set version in $file" >&2
    exit 1
  }
done

sed -i '0,/^version = /s/^version = "[^"]*"/version = "'"$VERSION"'"/' src-tauri/Cargo.toml
grep -q '^version = "'"$VERSION"'"$' src-tauri/Cargo.toml || {
  echo "failed to set version in src-tauri/Cargo.toml" >&2
  exit 1
}
# `cargo metadata --no-deps` does not refresh the lockfile's root package
# version. Update that metadata directly without re-resolving dependencies.
node --input-type=module - "$VERSION" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = "src-tauri/Cargo.lock";
const lock = readFileSync(path, "utf8");
const entry = /(\[\[package\]\]\nname = "email"\nversion = ")[^"]+(")/g;
if ([...lock.matchAll(entry)].length !== 1) {
  throw new Error("could not find the email package in Cargo.lock");
}
writeFileSync(path, lock.replace(entry, (_, start, end) => `${start}${process.argv[2]}${end}`));
NODE

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "🔖 v$VERSION"
git tag "v$VERSION"
# branch first: if main rejects the push, stop before publishing the tag —
# a combined push leaves an orphan tag when only the branch ref is refused
git push origin HEAD
git push origin "v$VERSION"
