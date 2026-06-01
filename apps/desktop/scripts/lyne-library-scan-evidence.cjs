#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const defaultOutDir = path.join(appRoot, "output", "lyne-evidence");
const supportedExtensions = new Set([
  "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "ape", "wv", "alac", "aiff",
  "aif", "dsf", "dff", "mpc", "tak", "tta", "ac3", "dts", "thd", "truehd", "mka", "mkv",
  "mp4", "m4v", "mov", "webm", "asf", "amr", "au", "ra", "rm", "3gp"
]);

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.LYNE_AUDIO_SERVER_URL || "http://127.0.0.1:63790",
    token: process.env.LYNE_AUDIO_API_TOKEN || process.env.AUDIO_API_TOKEN || "",
    root: process.env.LYNE_SCAN_ROOT || "",
    expected: process.env.LYNE_SCAN_EXPECTED || "",
    outputDir: defaultOutDir,
    timeoutMs: 5000,
    pollMs: 500,
    maxWaitMs: 120000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
    } else if (arg === "--token" && next) {
      options.token = next;
      index += 1;
    } else if (arg === "--root" && next) {
      options.root = path.resolve(next);
      index += 1;
    } else if (arg === "--expected" && next) {
      options.expected = path.resolve(next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      options.outputDir = path.resolve(appRoot, next);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--poll-ms" && next) {
      options.pollMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--max-wait-ms" && next) {
      options.maxWaitMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  for (const key of ["timeoutMs", "pollMs", "maxWaitMs"]) {
    if (!Number.isFinite(options[key]) || options[key] <= 0) {
      throw new Error(`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} must be a positive integer`);
    }
  }
  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/lyne-library-scan-evidence.cjs --root <music-dir> [options]

Options:
  --base-url <url>      Audio server base URL (default: http://127.0.0.1:63790)
  --token <token>       Bearer token if the server requires AUDIO_API_TOKEN
  --root <dir>          Real or fixture local library root to scan
  --expected <json>     Optional expected manifest for accuracy scoring
  --output-dir <dir>    Output directory relative to apps/desktop unless absolute
  --timeout-ms <ms>     Per-request timeout (default: 5000)
  --poll-ms <ms>        Scan task polling interval (default: 500)
  --max-wait-ms <ms>    Max time to wait for scan completion (default: 120000)

Expected manifest shape:
{
  "tracks": [
    {
      "file": "relative/path.flac",
      "title": "Expected title",
      "artist": "Expected artist",
      "album": "Expected album",
      "has_cover_art": true
    }
  ]
}
`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestJson = async (options, method, route, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const startedAt = performance.now();
  try {
    const response = await fetch(`${options.baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const latencyMs = performance.now() - startedAt;
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message =
        json && typeof json === "object" && typeof json.message === "string"
          ? json.message
          : `HTTP ${response.status}`;
      throw new Error(`${method} ${route} failed: ${message}`);
    }
    return { json, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
};

const walk = async (root, files = []) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) {
        await walk(fullPath, files);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (supportedExtensions.has(ext)) {
        const stat = await fs.stat(fullPath);
        files.push({
          path: fullPath,
          relative_path: path.relative(root, fullPath),
          extension: ext,
          size_bytes: stat.size
        });
      }
    }
  }
  return files;
};

const loadExpected = async (expectedPath) => {
  if (!expectedPath) {
    return null;
  }
  const raw = JSON.parse(await fs.readFile(expectedPath, "utf8"));
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tracks)) {
    throw new Error("Expected manifest must contain a tracks array");
  }
  return raw;
};

const stripWindowsExtendedPrefix = (value) => {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("//?/UNC/")) {
    return `//${normalized.slice("//?/UNC/".length)}`;
  }
  if (normalized.startsWith("//?/")) {
    return normalized.slice("//?/".length);
  }
  if (normalized.startsWith("/?/")) {
    return normalized.slice("/?/".length);
  }
  return normalized;
};

const normalizePathKey = (value) => stripWindowsExtendedPrefix(value).toLowerCase();

const normalizeAbsolutePathKey = (value) => normalizePathKey(path.resolve(value)).replace(/\/+$/, "");

const isPathUnderRoot = (sourcePath, root) => {
  const sourceKey = normalizeAbsolutePathKey(sourcePath);
  const rootKey = normalizeAbsolutePathKey(root);
  return sourceKey === rootKey || sourceKey.startsWith(`${rootKey}/`);
};

const relativePathKey = (root, sourcePath) => {
  const sourceKey = normalizeAbsolutePathKey(sourcePath);
  const rootKey = normalizeAbsolutePathKey(root);
  if (sourceKey === rootKey) {
    return "";
  }
  if (sourceKey.startsWith(`${rootKey}/`)) {
    return sourceKey.slice(rootKey.length + 1);
  }
  return normalizePathKey(path.relative(root, sourcePath));
};

const scoreExpected = (root, mediaItems, expected) => {
  if (!expected) {
    return null;
  }
  const byRelativePath = new Map();
  for (const item of mediaItems) {
    if (typeof item.source_path !== "string") {
      continue;
    }
    byRelativePath.set(relativePathKey(root, item.source_path), item);
  }

  const checks = [];
  for (const expectedTrack of expected.tracks) {
    const key = normalizePathKey(expectedTrack.file || "");
    const actual = byRelativePath.get(key) || null;
    const fields = [];
    for (const field of ["title", "artist", "album", "has_cover_art"]) {
      if (Object.prototype.hasOwnProperty.call(expectedTrack, field)) {
        fields.push({
          field,
          expected: expectedTrack[field],
          actual: actual ? actual[field] : null,
          pass: actual ? actual[field] === expectedTrack[field] : false
        });
      }
    }
    checks.push({
      file: expectedTrack.file,
      found: actual !== null,
      media_id: actual ? actual.media_id : null,
      fields,
      pass: actual !== null && fields.every((field) => field.pass)
    });
  }

  return {
    tracks_expected: expected.tracks.length,
    tracks_found: checks.filter((check) => check.found).length,
    tracks_passed: checks.filter((check) => check.pass).length,
    checks
  };
};

const summarizeMedia = (items) => {
  const byExtension = {};
  let withCover = 0;
  let withExternalArtwork = 0;
  let withTitle = 0;
  let withArtist = 0;
  let withAlbum = 0;
  let withDuration = 0;
  let totalSizeBytes = 0;

  for (const item of items) {
    const ext = path.extname(item.source_path || "").slice(1).toLowerCase() || "(none)";
    byExtension[ext] = (byExtension[ext] || 0) + 1;
    if (item.has_cover_art) withCover += 1;
    if (item.external_artwork_url) withExternalArtwork += 1;
    if (item.title) withTitle += 1;
    if (item.artist) withArtist += 1;
    if (item.album) withAlbum += 1;
    if (typeof item.duration_secs === "number") withDuration += 1;
    if (typeof item.size_bytes === "number") totalSizeBytes += item.size_bytes;
  }

  return {
    track_count: items.length,
    total_size_bytes: totalSizeBytes,
    by_extension: byExtension,
    metadata_presence: {
      title: withTitle,
      artist: withArtist,
      album: withAlbum,
      duration: withDuration
    },
    cover_presence: {
      has_cover_art: withCover,
      external_artwork_url: withExternalArtwork,
      missing: items.length - withCover - withExternalArtwork
    }
  };
};

const waitForScan = async (options, taskId) => {
  const startedAt = performance.now();
  const samples = [];
  while (performance.now() - startedAt < options.maxWaitMs) {
    const { json, latencyMs } = await requestJson(options, "GET", `/domain/library/scan_tasks/${taskId}`);
    const task = json && typeof json === "object" ? json.task : null;
    if (!task || typeof task.status !== "string") {
      throw new Error("Invalid scan task response");
    }
    samples.push({
      at_ms: Number((performance.now() - startedAt).toFixed(3)),
      latency_ms: Number(latencyMs.toFixed(3)),
      status: task.status,
      result: task.result || null,
      error: task.error || null
    });
    if (task.status === "success" || task.status === "error" || task.status === "canceled") {
      return { task, samples, elapsedMs: performance.now() - startedAt };
    }
    await sleep(options.pollMs);
  }
  throw new Error(`Timed out waiting for scan task ${taskId}`);
};

const writeReport = async (options, report) => {
  await fs.mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, "library-scan-evidence.json");
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, outputPath);
  return outputPath;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    probe: "lyne-library-scan-evidence",
    generated_at: new Date().toISOString(),
    base_url: options.baseUrl,
    root: options.root,
    summary: {
      pass: false,
      status: "not_started"
    },
    input_inventory: null,
    scan: null,
    library_summary: null,
    expected_score: null,
    limitations: [
      "This report measures the running server's local scan path and database results; it does not inspect private audio content.",
      "Lyric accuracy is only scoreable when a separate expected manifest or playback lyrics probe is provided."
    ]
  };

  try {
    if (!options.root) {
      throw new Error("--root <music-dir> is required");
    }
    const rootStat = await fs.stat(options.root);
    if (!rootStat.isDirectory()) {
      throw new Error(`--root is not a directory: ${options.root}`);
    }
    const files = await walk(options.root);
    report.input_inventory = {
      supported_files: files.length,
      total_size_bytes: files.reduce((sum, file) => sum + file.size_bytes, 0),
      by_extension: files.reduce((acc, file) => {
        acc[file.extension] = (acc[file.extension] || 0) + 1;
        return acc;
      }, {})
    };
    const expected = await loadExpected(options.expected);
    const scanStart = performance.now();
    const scanStartResponse = await requestJson(options, "POST", "/domain/library/scan", {
      path: options.root,
      display_name: `Evidence ${path.basename(options.root)}`
    });
    const scanResult = scanStartResponse.json;
    if (!scanResult || typeof scanResult !== "object" || scanResult.status !== "success") {
      throw new Error("Invalid scan start response");
    }
    const taskId = scanResult.task_id;
    const finished = await waitForScan(options, taskId);
    const elapsedMs = performance.now() - scanStart;
    report.scan = {
      task_id: taskId,
      root_id: scanResult.root_id,
      start_latency_ms: Number(scanStartResponse.latencyMs.toFixed(3)),
      elapsed_ms: Number(elapsedMs.toFixed(3)),
      task_elapsed_ms: Number(finished.elapsedMs.toFixed(3)),
      status: finished.task.status,
      result: finished.task.result || null,
      error: finished.task.error || null,
      samples: finished.samples
    };

    const mediaResponse = await requestJson(options, "GET", "/domain/media_items?all=true");
    const mediaItems =
      mediaResponse.json && typeof mediaResponse.json === "object" && Array.isArray(mediaResponse.json.media_items)
        ? mediaResponse.json.media_items.filter((item) => {
            if (!item || typeof item !== "object" || typeof item.source_path !== "string") return false;
            return isPathUnderRoot(item.source_path, options.root);
          })
        : [];
    report.library_summary = summarizeMedia(mediaItems);
    report.expected_score = scoreExpected(options.root, mediaItems, expected);
    report.summary.status = finished.task.status;
    report.summary.media_items_found = mediaItems.length;
    report.summary.expected_pass = report.expected_score
      ? report.expected_score.tracks_passed === report.expected_score.tracks_expected
      : null;
    report.summary.pass = finished.task.status === "success" && report.summary.expected_pass !== false;
  } catch (error) {
    report.summary.pass = false;
    report.summary.status = "error";
    report.error = error instanceof Error ? error.message : String(error);
  }

  const outputPath = await writeReport(options, report);
  console.log(`[lyne-scan-evidence] wrote ${path.relative(appRoot, outputPath)}`);
  console.log(
    `[lyne-scan-evidence] pass=${report.summary.pass} status=${report.summary.status} files=${report.input_inventory ? report.input_inventory.supported_files : 0}`
  );
  if (report.error) {
    console.error(`[lyne-scan-evidence] ${report.error}`);
    process.exitCode = 1;
  } else if (!report.summary.pass) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
