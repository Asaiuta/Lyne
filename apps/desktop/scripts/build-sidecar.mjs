import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const manifestPath = path.join(repoRoot, "Cargo.toml");

const profile = process.argv[2] ?? "dev";

const profileArgs = new Map([
  ["dev", ["build", "--profile", "audio-dev"]],
  ["audio-dev", ["build", "--profile", "audio-dev"]],
  ["release", ["build", "--release"]],
  ["fast", ["build", "--profile", "release-fast"]],
  ["release-fast", ["build", "--profile", "release-fast"]]
]);

const cargoArgs = profileArgs.get(profile);
if (!cargoArgs) {
  console.error(`[build:sidecar] Unknown sidecar profile: ${profile}`);
  console.error("[build:sidecar] Expected one of: dev, audio-dev, release, fast, release-fast");
  process.exit(1);
}

const result = spawnSync(
  "cargo",
  [...cargoArgs, "--manifest-path", manifestPath, "--bin", "audio_server"],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  }
);

if (result.signal) {
  console.error(`[build:sidecar] Cargo terminated by signal ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
