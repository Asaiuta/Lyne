#!/usr/bin/env node
"use strict";

/**
 * Performance artifact provenance (PERF-005 remediation).
 *
 * Node mirror of `src/bench_provenance.rs`: one versioned provenance block
 * shared by Electron reports, Lyne benchmarks and Tauri probe artifacts.
 *
 * The block records source identity (git HEAD, a privacy-safe dirty-tree
 * fingerprint, branch), build identity (profile/toolchain/binary SHA-256),
 * host identity (OS / arch / CPU), runtime versions and fixture hashes so
 * artifacts from different dirty trees or binaries can be judged
 * incomparable even when their `gitHead` matches.
 *
 * Privacy contract: `dirtyFingerprint` is a SHA-256 over the *normalized*
 * `git status --porcelain` output — a hash, never an embedded path list.
 * File names are recorded relative to the repo root only; no tokens,
 * credentials or unrestricted user paths enter the block.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROVENANCE_SCHEMA_VERSION = 1;

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const runGit = (args, cwd = repoRoot) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return null;
  }
};

const sha256Hex = (input) => crypto.createHash("sha256").update(input).digest("hex");

const hashFile = (filePath) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
};

const repoRelative = (filePath, cwd = repoRoot) => {
  const root = runGit(["rev-parse", "--show-toplevel"], cwd) || cwd;
  const rel = path.relative(root, path.resolve(filePath));
  return rel && !rel.startsWith("..") ? rel.split(path.sep).join("/") : filePath;
};

/**
 * Collect a provenance block for the current tree.
 *
 * @param {object} [options]
 * @param {string} [options.binaryPath]   Native executable to hash (relative or absolute).
 * @param {string[]} [options.fixturePaths] Input fixtures/artifacts to hash.
 * @param {string} [options.profile]      Build profile ("release", "dev").
 * @param {string[]} [options.attribution] Declared measurement limits, e.g. ["in-process", "no-device"].
 * @param {object} [options.workload]     Workload parameters (mode/trials/percentile...).
 * @param {string} [options.repoDir]      Git root to probe (defaults to repo root; test seam).
 */
const collectProvenance = (options = {}) => {
  const {
    binaryPath,
    fixturePaths = [],
    profile = null,
    attribution = [],
    workload = null,
    repoDir = repoRoot
  } = options;
  const porcelain = runGit(["status", "--porcelain"], repoDir);
  // Windows git emits CRLF; Rust's str::lines() strips the CR, so strip it
  // here too or cross-family fingerprints would never match.
  const porcelainLines = porcelain
    ? porcelain.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean).sort()
    : [];
  const dirtyFingerprint =
    porcelain !== null ? sha256Hex(porcelainLines.join("\n") + "\n") : null;

  const binarySha = binaryPath ? hashFile(binaryPath) : null;
  const binary = binarySha ? { path: repoRelative(binaryPath, repoDir), sha256: binarySha } : null;
  const fixtures = fixturePaths
    .map((p) => {
      const sha256 = hashFile(p);
      return sha256 ? { name: repoRelative(p, repoDir), sha256 } : null;
    })
    .filter(Boolean);

  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      git_head: runGit(["rev-parse", "HEAD"], repoDir),
      dirty: porcelain !== null && porcelainLines.length > 0,
      dirty_fingerprint: dirtyFingerprint,
      branch: runGit(["branch", "--show-current"], repoDir)
    },
    build: {
      profile,
      toolchain: process.versions && process.versions.node ? `node ${process.versions.node}` : null,
      binary
    },
    runtime: {
      node: process.versions?.node || null,
      electron: process.versions?.electron || null,
      chrome: process.versions?.chrome || null,
      v8: process.versions?.v8 || null
    },
    host: {
      os: process.platform,
      arch: process.arch,
      cpu_class: os.cpus()[0]?.model || null
    },
    fixtures,
    workload: workload || null,
    attribution
  };
};

/**
 * Attach the provenance block to a report object (idempotent).
 * Keeps the legacy `generated_at` field untouched for back-compat.
 */
const attachReportProvenance = (report, options) => {
  if (!report.provenance) {
    report.provenance = collectProvenance(options);
  }
  return report;
};

/**
 * Compare two provenance blocks for comparison eligibility.
 * Pure: no I/O, no process probes.
 */
const compareProvenance = (left, right) => {
  const mismatches = [];
  if (left.schemaVersion !== right.schemaVersion) {
    mismatches.push(`schema-version ${left.schemaVersion} != ${right.schemaVersion}`);
  }
  if (left.source.git_head !== right.source.git_head) {
    mismatches.push(`git-head ${left.source.git_head} != ${right.source.git_head}`);
  }
  if (left.source.dirty_fingerprint && right.source.dirty_fingerprint) {
    if (left.source.dirty_fingerprint !== right.source.dirty_fingerprint) {
      mismatches.push("dirty-tree-differs");
    }
  } else {
    mismatches.push("missing-dirty-fingerprint");
  }
  if (left.build?.binary?.sha256 && right.build?.binary?.sha256) {
    if (left.build.binary.sha256 !== right.build.binary.sha256) {
      mismatches.push("binary-sha-differs");
    }
  } else if (Boolean(left.build?.binary) !== Boolean(right.build?.binary)) {
    mismatches.push("binary-identity-missing");
  }
  if (left.host.os !== right.host.os || left.host.arch !== right.host.arch) {
    mismatches.push(`host-identity ${left.host.os} ${left.host.arch} != ${right.host.os} ${right.host.arch}`);
  }
  const leftFixtures = left.fixtures || [];
  const rightFixtures = right.fixtures || [];
  for (const lf of leftFixtures) {
    const rf = rightFixtures.find((f) => f.name === lf.name);
    if (rf && rf.sha256 !== lf.sha256) {
      mismatches.push("fixture-sha-differs");
      break;
    }
  }
  return { comparable: mismatches.length === 0, mismatches };
};

module.exports = {
  PROVENANCE_SCHEMA_VERSION,
  collectProvenance,
  attachReportProvenance,
  compareProvenance,
  repoRelative,
  hashFile
};

// CLI seam for non-Node callers (e.g. restart-tauri-cdp.ps1) that need the
// exact same git identity fields without duplicating the algorithm.
if (require.main === module && process.argv.includes("--emit-git-fields")) {
  const prov = collectProvenance({ profile: "tauri-launch-meta" });
  process.stdout.write(
    JSON.stringify({
      git_head: prov.source.git_head,
      dirty: prov.source.dirty,
      dirty_fingerprint: prov.source.dirty_fingerprint,
      branch: prov.source.branch,
      schema_version: prov.schemaVersion
    })
  );
}