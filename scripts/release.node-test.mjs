import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("a release pushes matching manifest and lockfile versions without changing dependencies", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "email-release-test-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repo = join(temporary, "repo");
  const remote = join(temporary, "remote.git");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "src-tauri"));
  for (const script of ["release.sh", "check-release-version.mjs"]) {
    cpSync(new URL(script, import.meta.url), join(repo, "scripts", script));
  }
  writeFileSync(join(repo, "package.json"), '{"version": "0.1.4-alpha"}\n');
  writeFileSync(
    join(repo, "src-tauri/tauri.conf.json"),
    '{"version": "0.1.4-alpha"}\n',
  );
  writeFileSync(
    join(repo, "src-tauri/Cargo.toml"),
    '[package]\nname = "email"\nversion = "0.1.4-alpha"\n',
  );
  const dependency = '[[package]]\nname = "dependency"\nversion = "1.2.3"\n';
  writeFileSync(
    join(repo, "src-tauri/Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "email"\nversion = "0.1.2-alpha"\n\n' +
      dependency,
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("push", "-u", "origin", "main");

  execFileSync("bash", ["scripts/release.sh", "0.1.5-alpha"], {
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(
    JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version,
    "0.1.5-alpha",
  );
  assert.equal(
    JSON.parse(readFileSync(join(repo, "src-tauri/tauri.conf.json"), "utf8"))
      .version,
    "0.1.5-alpha",
  );
  assert.match(
    readFileSync(join(repo, "src-tauri/Cargo.toml"), "utf8"),
    /version = "0\.1\.5-alpha"/,
  );
  const lock = readFileSync(join(repo, "src-tauri/Cargo.lock"), "utf8");
  assert.match(lock, /name = "email"\nversion = "0\.1\.5-alpha"/);
  assert.ok(lock.endsWith(dependency));
  assert.equal(git("status", "--porcelain"), "");
  const head = git("rev-parse", "HEAD");
  assert.equal(git("rev-parse", "v0.1.5-alpha"), head);
  assert.equal(
    git("--git-dir=" + remote, "rev-parse", "refs/tags/v0.1.5-alpha"),
    head,
  );
  assert.equal(
    git("--git-dir=" + remote, "rev-parse", "refs/heads/main"),
    head,
  );
});
