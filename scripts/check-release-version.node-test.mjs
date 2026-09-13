import assert from "node:assert/strict";
import test from "node:test";

import { assertNewerThanEveryVersion, compareSemver } from "./check-release-version.mjs";

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
