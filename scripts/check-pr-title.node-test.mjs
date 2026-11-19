import assert from "node:assert/strict";
import test from "node:test";
import { assertConventionalTitle } from "./check-pr-title.mjs";

test("accepts scoped, breaking, and release PR titles", () => {
  for (const title of [
    "fix: handle account switches",
    "feat(mail): add rules",
    "feat!: change the API",
    "refactor(mail)!: change the message format",
    "chore(main): release 0.1.5-alpha",
    "ci: validate workflow files",
  ]) {
    assert.doesNotThrow(() => assertConventionalTitle(title));
  }
});

test("rejects titles that cannot drive commit-based release versions", () => {
  for (const title of [
    undefined,
    "",
    "Fix account switches",
    "fix:no space",
    "fix: ",
    "fix(): empty scope",
    "feat: rules\nfix: unrelated",
  ]) {
    assert.throws(() => assertConventionalTitle(title), /Conventional Commit/);
  }
});
