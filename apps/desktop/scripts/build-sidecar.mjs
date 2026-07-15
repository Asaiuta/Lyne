import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const manifestPath = path.join(repoRoot, "Cargo.toml");
const stagerManifestPath = path.join(
  repoRoot,
  "crates",
  "windows-runtime-stage",
  "Cargo.toml"
);

const profile = process.argv[2] ?? "dev";

const profileArgs = new Map([
  ["dev", { cargoArgs: ["build", "--profile", "audio-dev"], outputDir: "audio-dev" }],
  ["audio-dev", { cargoArgs: ["build", "--profile", "audio-dev"], outputDir: "audio-dev" }],
  ["release", { cargoArgs: ["build", "--release"], outputDir: "release" }],
  ["fast", { cargoArgs: ["build", "--profile", "release-fast"], outputDir: "release-fast" }],
  ["release-fast", { cargoArgs: ["build", "--profile", "release-fast"], outputDir: "release-fast" }]
]);

const profileConfig = profileArgs.get(profile);
if (!profileConfig) {
  console.error(`[build:sidecar] Unknown sidecar profile: ${profile}`);
  console.error("[build:sidecar] Expected one of: dev, audio-dev, release, fast, release-fast");
  process.exit(1);
}

const targetDir = process.env.CARGO_TARGET_DIR || path.join(repoRoot, "target");
const cargoEnvironment = {
  ...process.env,
  CARGO_TARGET_DIR: targetDir
};

function runCargo(label, args) {
  const result = spawnSync("cargo", args, {
    cwd: repoRoot,
    env: cargoEnvironment,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(`[build:sidecar] ${label} could not start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`[build:sidecar] ${label} terminated by signal ${result.signal}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[build:sidecar] ${label} failed with exit code ${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }
}

runCargo("sidecar build", [
  ...profileConfig.cargoArgs,
  "--manifest-path",
  manifestPath,
  "--bin",
  "audio_server"
]);

const sidecarPath = path.join(targetDir, profileConfig.outputDir, "audio_server.exe");
runCargo("runtime staging", [
  "run",
  "--quiet",
  "--manifest-path",
  stagerManifestPath,
  "--bin",
  "stage-windows-runtime",
  "--",
  "--target-dir",
  targetDir,
  "--profile",
  profileConfig.outputDir,
  "--root",
  sidecarPath
]);

console.log(`[build:sidecar] Runtime closure verified for ${sidecarPath}`);
