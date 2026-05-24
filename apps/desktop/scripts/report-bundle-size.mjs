import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const assetDir = path.join(distDir, "assets");
const warnOnly = process.env.BUNDLE_BUDGET_WARN_ONLY === "1";

const kib = (bytes) => bytes / 1024;
const formatKib = (bytes) => `${kib(bytes).toFixed(2)} KiB`;

const budgets = [
  { id: "startup-js", pattern: /^index-[^.]+\.js$/, rawKib: 520, gzipKib: 140 },
  { id: "css", pattern: /\.css$/, rawKib: 280, gzipKib: 48 },
  { id: "large-route-js", pattern: /^(NeteasePage|SettingsPage)-.*\.js$/, rawKib: 180, gzipKib: 45 },
  { id: "route-js", pattern: /\.js$/, rawKib: 90, gzipKib: 30 }
];

const budgetFor = (fileName) => {
  const match = budgets.find((budget) => budget.pattern.test(fileName));
  if (!match) {
    throw new Error(`No bundle budget configured for ${fileName}`);
  }
  return match;
};

const readAssets = async () => {
  const files = await readdir(assetDir);
  const assets = await Promise.all(
    files
      .filter((file) => file.endsWith(".js") || file.endsWith(".css"))
      .map(async (fileName) => {
        const fullPath = path.join(assetDir, fileName);
        const [metadata, content] = await Promise.all([stat(fullPath), readFile(fullPath)]);
        const gzipBytes = gzipSync(content).byteLength;
        return {
          fileName,
          rawBytes: metadata.size,
          gzipBytes,
          budget: budgetFor(fileName)
        };
      })
  );
  return assets.sort((a, b) => b.gzipBytes - a.gzipBytes || a.fileName.localeCompare(b.fileName));
};

const assets = await readAssets().catch((error) => {
  console.error("[perf:bundle] Failed to read dist assets.");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Run `npm run build:web` before `npm run perf:bundle`.");
  process.exit(1);
});

const failures = assets.filter((asset) => {
  const rawOver = kib(asset.rawBytes) > asset.budget.rawKib;
  const gzipOver = kib(asset.gzipBytes) > asset.budget.gzipKib;
  return rawOver || gzipOver;
});

console.log("[perf:bundle] chunk size report");
console.log("asset".padEnd(44), "raw".padStart(12), "gzip".padStart(12), "budget");
for (const asset of assets) {
  const budget = `${asset.budget.rawKib} KiB / ${asset.budget.gzipKib} KiB gzip`;
  console.log(
    asset.fileName.padEnd(44),
    formatKib(asset.rawBytes).padStart(12),
    formatKib(asset.gzipBytes).padStart(12),
    budget
  );
}

if (failures.length > 0) {
  console.error("");
  console.error(`[perf:bundle] ${failures.length} chunk(s) exceeded bundle budgets:`);
  for (const asset of failures) {
    console.error(
      `- ${asset.fileName}: ${formatKib(asset.rawBytes)} raw, ${formatKib(asset.gzipBytes)} gzip ` +
        `(budget ${asset.budget.rawKib} KiB raw / ${asset.budget.gzipKib} KiB gzip)`
    );
  }
  if (!warnOnly) {
    process.exit(1);
  }
}

console.log(`[perf:bundle] ${failures.length === 0 ? "PASS" : "WARN"}`);
