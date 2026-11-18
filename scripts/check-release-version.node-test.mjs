import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMatchingVersions,
  assertNewerThanEveryVersion,
  compareSemver,
} from "./check-release-version.mjs";

test("rejects the alpha version that pacman cannot upgrade to", () => {
  assert.throws(
    () => assertNewerThanEveryVersion("0.0.10-alpha", ["0.1.0"]),
    /must be newer than 0\.1\.0/,
  );
});

test("accepts an alpha release with a newer patch version", () => {
  assert.doesNotThrow(() =>
    assertNewerThanEveryVersion("0.1.1-alpha", ["0.0.10-alpha", "0.1.0"]),
  );
});

test("orders prereleases before their final version", () => {
  assert.equal(compareSemver("0.1.1-alpha", "0.1.1"), -1);
  assert.equal(compareSemver("0.1.1", "0.1.1-alpha"), 1);
  assert.equal(compareSemver("0.1.1-alpha.2", "0.1.1-alpha.1"), 1);
});

test("rejects an unsynchronized app manifest or root lockfile", () => {
  assert.doesNotThrow(() =>
    assertMatchingVersions(Array(5).fill("0.1.5-alpha")),
  );
  assert.throws(
    () =>
      assertMatchingVersions([
        "0.1.5-alpha",
        "0.1.5-alpha",
        "0.1.5-alpha",
        "0.1.4-alpha",
        "0.1.5-alpha",
      ]),
    /versions do not match/,
  );
  assert.throws(
    () => assertMatchingVersions(["0.1.5-alpha", undefined]),
    /not a semver/,
  );
});
