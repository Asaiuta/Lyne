import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { evaluateReleaseInventory, kib } from "./bundle-size-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const warnOnly = process.env.BUNDLE_BUDGET_WARN_ONLY === "1";

const formatKib = (bytes) => `${kib(bytes).toFixed(2)} KiB`;

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      if (entry.isFile()) return [fullPath];
      throw new Error(`Unsupported release input entry: ${fullPath}`);
    })
  );
  return nested.flat();
};

const readReleaseInventory = async () => {
  const files = await listFiles(distDir);
  return Promise.all(
    files.map(async (fullPath) => {
      const relativePath = path.relative(distDir, fullPath).split(path.sep).join("/");
      const metadata = await stat(fullPath);
      const isChunk = /\.(?:js|css)$/i.test(relativePath);
      const gzipBytes = isChunk ? gzipSync(await readFile(fullPath)).byteLength : undefined;
      return { relativePath, rawBytes: metadata.size, gzipBytes };
    })
  );
};

const inventory = await readReleaseInventory().catch((error) => {
  console.error("[perf:bundle] Failed to read the dist release input.");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Run `npm run build:web` before `npm run perf:bundle`.");
  process.exit(1);
});

const report = evaluateReleaseInventory(inventory);
const typeCounts = new Map();
for (const entry of inventory) {
  const extension = path.extname(entry.relativePath).toLowerCase() || "(none)";
  const current = typeCounts.get(extension) ?? { count: 0, rawBytes: 0 };
  typeCounts.set(extension, {
    count: current.count + 1,
    rawBytes: current.rawBytes + entry.rawBytes
  });
}

console.log("[perf:bundle] complete release-input inventory");
console.log(
  `${inventory.length} file(s), ${formatKib(report.totalRawBytes)} raw ` +
    `(budget ${formatKib(report.totalBudgetBytes)})`
);
for (const [extension, summary] of [...typeCounts].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`- ${extension}: ${summary.count} file(s), ${formatKib(summary.rawBytes)}`);
}
console.log(`forbidden debug artifacts: ${report.forbiddenArtifacts.length}`);

console.log("");
console.log("[perf:bundle] chunk size report");
console.log("asset".padEnd(44), "raw".padStart(12), "gzip".padStart(12), "budget");
for (const chunk of report.chunks) {
  const budget = `${chunk.budget.rawKib} KiB / ${chunk.budget.gzipKib} KiB gzip`;
  console.log(
    chunk.relativePath.padEnd(44),
    formatKib(chunk.rawBytes).padStart(12),
    formatKib(chunk.gzipBytes ?? 0).padStart(12),
    budget
  );
}

if (report.chunkFailures.length > 0) {
  console.error("");
  console.error(`[perf:bundle] ${report.chunkFailures.length} chunk(s) exceeded budgets:`);
  for (const chunk of report.chunkFailures) {
    console.error(
      `- ${chunk.relativePath}: ${formatKib(chunk.rawBytes)} raw, ` +
        `${formatKib(chunk.gzipBytes ?? 0)} gzip ` +
        `(budget ${chunk.budget.rawKib} KiB raw / ${chunk.budget.gzipKib} KiB gzip)`
    );
  }
}

if (report.forbiddenArtifacts.length > 0) {
  console.error("");
  console.error("[perf:bundle] forbidden debug artifacts:");
  for (const artifact of report.forbiddenArtifacts) {
    console.error(`- ${artifact.relativePath}: ${artifact.reason}, ${formatKib(artifact.rawBytes)}`);
  }
}

if (report.totalFailure) {
  console.error("");
  console.error(
    `[perf:bundle] total release input ${formatKib(report.totalFailure.actualBytes)} ` +
      `exceeds ${formatKib(report.totalFailure.budgetBytes)}`
  );
}

if (report.structuralFailures.length > 0) {
  console.error("");
  console.error("[perf:bundle] invalid release-input structure:");
  for (const failure of report.structuralFailures) {
    console.error(`- ${failure}`);
  }
}

if (report.failureCount > 0 && !warnOnly) {
  process.exit(1);
}

console.log(`[perf:bundle] ${report.failureCount === 0 ? "PASS" : "WARN"}`);
