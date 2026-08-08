"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  PROVENANCE_SCHEMA_VERSION,
  collectProvenance,
  compareProvenance
} = require("./provenance-utils.cjs");

const makeGitDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prov-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "fixture-a.wav"), "fixture-a-bytes");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
  });
  return dir;
};

test("provenance block schema version is 1", () => {
  assert.equal(PROVENANCE_SCHEMA_VERSION, 1);
});

test("collect on the real repo is stable across calls", () => {
  const a = collectProvenance({});
  const b = collectProvenance({});
  assert.ok(a.source.git_head);
  assert.match(a.source.git_head, /^[0-9a-f]{40}$/);
  assert.equal(a.source.dirty_fingerprint, b.source.dirty_fingerprint);
  assert.equal(a.schemaVersion, 1);
});

test("binary and fixture paths are recorded repo-relative (privacy)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const binary = path.join(repoRoot, ".tmp", "provenance-probe.bin");
  fs.writeFileSync(binary, "probe-bytes");
  const fixture = path.join(repoRoot, "tests", "fixtures-probe.wav");
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  fs.writeFileSync(fixture, "probe-fixture");
  try {
    const p = collectProvenance({ binaryPath: binary, fixturePaths: [fixture] });
    const json = JSON.stringify(p);
    assert.ok(!json.includes(binary.replace(/\\/g, "/")), "absolute binary path must not leak");
    assert.ok(!json.includes("probe-bytes"));
    assert.ok(p.build.binary.path.startsWith(".tmp/"), `binary recorded relative: ${p.build.binary.path}`);
    assert.ok(p.fixtures.length >= 1);
    assert.equal(p.fixtures[0].sha256.length, 64);
  } finally {
    fs.rmSync(binary, { force: true });
    fs.rmSync(fixture, { force: true });
  }
});

test("clean tree and dirty tree produce different fingerprints, same head", () => {
  const repoDir = makeGitDir();
  try {
    const clean = collectProvenance({ repoDir });
    assert.equal(clean.source.dirty, false);
    const cleanFp = clean.source.dirty_fingerprint;
    assert.ok(cleanFp);

    // Touch an untracked file to make the tree dirty.
    fs.writeFileSync(path.join(repoDir, "untracked.txt"), "hello");
    const dirty = collectProvenance({ repoDir });
    assert.equal(dirty.source.dirty, true);
    assert.notEqual(dirty.source.dirty_fingerprint, cleanFp);

    const cmp = compareProvenance(clean, dirty);
    assert.equal(cmp.comparable, false);
    assert.ok(cmp.mismatches.includes("dirty-tree-differs"));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("comparison rejects different git heads", () => {
  const repoDir = makeGitDir();
  try {
    const first = collectProvenance({ repoDir });
    fs.appendFileSync(path.join(repoDir, "tracked.txt"), "change");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "second"], {
      cwd: repoDir,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
    });
    const second = collectProvenance({ repoDir });
    const cmp = compareProvenance(first, second);
    assert.equal(cmp.comparable, false);
    assert.ok(cmp.mismatches.some((m) => m.startsWith("git-head")));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("compareProvenance identifies binary and fixture drift", () => {
  const binary = path.join(__dirname, "provenance-utils.cjs");
  const fixture = path.join(__dirname, "provenance-utils.test.cjs");
  const base = collectProvenance({ binaryPath: binary, fixturePaths: [fixture] });
  assert.ok(base.build.binary, "baseline must carry a binary identity");
  assert.equal(base.fixtures.length, 1, "baseline must carry a fixture identity");
  const sameHead = JSON.parse(JSON.stringify(base));
  assert.equal(compareProvenance(base, sameHead).comparable, true);

  const binDiff = JSON.parse(JSON.stringify(sameHead));
  binDiff.build.binary = { path: "x", sha256: "aa".repeat(32) };
  assert.ok(compareProvenance(base, binDiff).mismatches.includes("binary-sha-differs"));

  const oneMissingBin = JSON.parse(JSON.stringify(sameHead));
  oneMissingBin.build.binary = null;
  assert.ok(compareProvenance(base, oneMissingBin).mismatches.includes("binary-identity-missing"));

  const fpDiff = JSON.parse(JSON.stringify(sameHead));
  fpDiff.source.dirty_fingerprint = "bb".repeat(32);
  assert.ok(compareProvenance(base, fpDiff).mismatches.includes("dirty-tree-differs"));

  const fixtureDiff = JSON.parse(JSON.stringify(sameHead));
  fixtureDiff.fixtures = [{ ...base.fixtures[0], sha256: "cc".repeat(32) }];
  assert.ok(compareProvenance(base, fixtureDiff).mismatches.includes("fixture-sha-differs"));
});

test("workload and attribution are recorded verbatim", () => {
  const p = collectProvenance({ profile: "release", attribution: ["no-device"], workload: { mode: "quick", trials: 3 } });
  assert.equal(p.build.profile, "release");
  assert.deepEqual(p.attribution, ["no-device"]);
  assert.deepEqual(p.workload, { mode: "quick", trials: 3 });
});

test("attachReportProvenance is idempotent per report", () => {
  const { attachReportProvenance } = require("./provenance-utils.cjs");
  const report = { summary: { pass: true }, generated_at: "legacy-frozen" };
  attachReportProvenance(report, { attribution: ["a"] });
  const first = report.provenance;
  assert.ok(first.schemaVersion, 1);
  attachReportProvenance(report, { attribution: ["a"] });
  assert.equal(report.provenance, first, "re-attach must not replace the block");
  assert.equal(report.generated_at, "legacy-frozen", "legacy field must stay untouched");
});