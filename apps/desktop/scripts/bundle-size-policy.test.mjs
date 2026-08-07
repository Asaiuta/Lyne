import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KIB,
  TOTAL_RELEASE_RAW_KIB,
  chunkBudgetFor,
  evaluateReleaseInventory
} from "./bundle-size-policy.mjs";

const file = (relativePath, rawBytes, gzipBytes = rawBytes) => ({
  relativePath,
  rawBytes,
  gzipBytes
});

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

test("all release entry points share the gated release-input pipeline", () => {
  assert.equal(
    packageJson.scripts["build:release-input"],
    "npm run build:web && npm run perf:bundle"
  );
  assert.equal(packageJson.scripts.build, "npm run build:release-input");
  assert.match(packageJson.scripts["build:measure"], /^npm run build:release-input(?: &&|$)/);
  assert.match(packageJson.scripts["build:bundle"], /^npm run build:release-input(?: &&|$)/);
});

test("chunk budgets retain their established precedence", () => {
  assert.equal(chunkBudgetFor("assets/index-hash.js").id, "startup-js");
  assert.equal(chunkBudgetFor("assets/NeteasePage-hash.js").id, "large-route-js");
  assert.equal(chunkBudgetFor("assets/helper-hash.js").id, "route-js");
  assert.equal(chunkBudgetFor("assets/main-hash.css").id, "css");
});

test("nested source maps and native debug artifacts are forbidden", () => {
  const result = evaluateReleaseInventory([
    file("index.html", 100),
    file("assets/index-hash.js", 100, 50),
    file("assets/nested/index-hash.js.map", 200),
    file("symbols/audio-desktop.pdb", 300),
    file("symbols/audio-desktop.debug", 300),
    file("symbols/audio-desktop.dwo", 300),
    file("symbols/audio-desktop.dwp", 300),
    file("symbols/Lyne.dSYM/Contents/Resources/DWARF/Lyne", 400)
  ]);

  assert.deepEqual(
    result.forbiddenArtifacts.map((artifact) => artifact.reason),
    [
      "source map",
      "program database",
      "debug symbols",
      "split debug symbols",
      "split debug symbols",
      "debug symbol bundle"
    ]
  );
  assert.equal(result.failureCount, 6);
});

test("every release input contributes to the total budget", () => {
  const result = evaluateReleaseInventory([
    file("index.html", 1),
    file("assets/index-hash.js", 1, 1),
    file("assets/unclassified.bin", TOTAL_RELEASE_RAW_KIB * KIB)
  ]);

  assert.ok(result.totalFailure);
  assert.equal(result.totalRawBytes, TOTAL_RELEASE_RAW_KIB * KIB + 2);
});

test("missing release entry points fail structurally", () => {
  const result = evaluateReleaseInventory([file("images/song.jpg", 100)]);

  assert.deepEqual(result.structuralFailures, [
    "release input is missing index.html",
    "release input contains no JavaScript chunks"
  ]);
});

test("a clean release inventory passes all policies", () => {
  const result = evaluateReleaseInventory([
    file("index.html", 500),
    file("assets/index-hash.js", 400 * KIB, 120 * KIB),
    file("assets/route-hash.js", 40 * KIB, 10 * KIB),
    file("assets/main-hash.css", 200 * KIB, 40 * KIB),
    file("images/song.jpg", 5 * KIB)
  ]);

  assert.equal(result.failureCount, 0);
  assert.equal(result.forbiddenArtifacts.length, 0);
  assert.equal(result.totalFailure, null);
});
