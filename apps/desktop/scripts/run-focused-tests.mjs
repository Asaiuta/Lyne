import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const outDir = path.resolve(root, "..", "..", ".tmp", `desktop-focused-tests-${process.pid}`);

const findTests = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const tests = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findTests(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [fullPath] : [];
    })
  );
  return tests.flat();
};

await rm(outDir, { recursive: true, force: true });

const testFiles = await findTests(srcDir);
if (testFiles.length === 0) {
  console.log("No focused tests found.");
  process.exit(0);
}

const outfiles = await Promise.all(
  testFiles.map(async (entry, index) => {
    const outfile = path.join(
      outDir,
      `${index}-${path.basename(entry, ".test.ts")}.test.mjs`
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      sourcemap: "inline",
      logLevel: "silent"
    });
    return outfile;
  })
);

const result = spawnSync(process.execPath, ["--test", ...outfiles], {
  cwd: root,
  stdio: "inherit"
});

await rm(outDir, { recursive: true, force: true }).catch((error) => {
  console.warn("[focused-tests] failed to clean temporary output", error);
});

process.exit(result.status ?? 1);
