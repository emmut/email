#!/usr/bin/env bash
# Cut a release: set the version in tauri.conf.json and package.json, commit,
# tag v<version>, and push both. CI builds and publishes from the tag.
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

# sed keeps Prettier's formatting where JSON round-tripping would reflow it;
# only the first "version" key is the package version in both files
for file in package.json src-tauri/tauri.conf.json; do
  sed -i '0,/"version":/s/"version": "[^"]*"/"version": "'"$VERSION"'"/' "$file"
  grep -q "\"version\": \"$VERSION\"" "$file" || {
    echo "failed to set version in $file" >&2
    exit 1
  }
done

git add package.json src-tauri/tauri.conf.json
git commit -m "🔖 v$VERSION"
git tag "v$VERSION"
# branch first: if main rejects the push, stop before publishing the tag —
# a combined push leaves an orphan tag when only the branch ref is refused
git push origin HEAD
git push origin "v$VERSION"
