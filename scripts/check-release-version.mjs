#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

function parseSemver(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`not a semver version: ${version}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split(".") ?? [],
  };
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);

  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) {
      return a.core[index] < b.core[index] ? -1 : 1;
    }
  }

  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;

    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) < Number(bPart) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }

  return 0;
}

export function assertNewerThanEveryVersion(candidate, currentVersions) {
  parseSemver(candidate);
  for (const current of currentVersions) {
    if (compareSemver(candidate, current) <= 0) {
      throw new Error(`release ${candidate} must be newer than ${current}`);
    }
  }
}

function projectVersions() {
  const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const tauriVersion = JSON.parse(
    readFileSync("src-tauri/tauri.conf.json", "utf8"),
  ).version;
  const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!cargoVersion) throw new Error("could not read package version from Cargo.toml");
  return [packageVersion, tauriVersion, cargoVersion];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const candidate = process.argv[2];
  if (!candidate) throw new Error("usage: check-release-version.mjs <version>");
  const currentVersions = projectVersions();
  assertNewerThanEveryVersion(candidate, currentVersions);
  console.log(`${candidate} is newer than ${[...new Set(currentVersions)].join(", ")}`);
}
