#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const defaultOutDir = path.join(appRoot, "output", "splayer-library-baseline");
const supportedExtensions = new Set([
  "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "ape", "wv", "alac", "aiff",
  "aif", "dsf", "dff", "mpc", "tak", "tta", "ac3", "dts", "thd", "truehd", "mka", "mkv",
  "mp4", "m4v", "mov", "webm", "asf", "amr", "au", "ra", "rm", "3gp"
]);

const parseArgs = (argv) => {
  const options = {
    root: process.env.SPLAYER_BENCH_ROOT || process.env.LYNE_REAL_LIBRARY_ROOT || "",
    splayerDir: process.env.SPLAYER_DIR || "",
    toolsNode: process.env.SPLAYER_TOOLS_NODE || "",
    betterSqlite3: process.env.SPLAYER_BETTER_SQLITE3 || "",
    outputDir: defaultOutDir,
    sampleMs: 1000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--root" && next) {
      options.root = path.resolve(next);
      index += 1;
    } else if (arg === "--splayer-dir" && next) {
      options.splayerDir = path.resolve(next);
      index += 1;
    } else if (arg === "--tools-node" && next) {
      options.toolsNode = path.resolve(next);
      index += 1;
    } else if (arg === "--better-sqlite3" && next) {
      options.betterSqlite3 = path.resolve(next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      options.outputDir = path.resolve(appRoot, next);
      index += 1;
    } else if (arg === "--sample-ms" && next) {
      options.sampleMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.sampleMs) || options.sampleMs <= 0) {
    throw new Error("--sample-ms must be a positive integer");
  }

  return resolveSplayerPaths(options);
};

const printHelp = () => {
  console.log(`Usage: node scripts/splayer-library-benchmark.cjs --root <music-dir> [options]

Runs SPlayer's installed native local-library scanner directly against a
read-only music directory and writes aggregate evidence under apps/desktop/output/.
This is a native scanner baseline, not full SPlayer UI automation.

Options:
  --root <dir>            Real local library root to scan
  --splayer-dir <dir>     Installed SPlayer directory, e.g. F:\\SPlayer
  --tools-node <path>     Explicit SPlayer resources/native/tools.node path
  --better-sqlite3 <path> Explicit better-sqlite3 package path from SPlayer install
  --output-dir <dir>      Output directory relative to apps/desktop unless absolute
  --sample-ms <ms>        Process metric sampling interval (default: 1000)
`);
};

const resolveSplayerPaths = (options) => {
  const candidates = [
    options.splayerDir,
    "F:\\SPlayer",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "SPlayer") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "SPlayer") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "SPlayer") : ""
  ].filter(Boolean);

  let splayerDir = options.splayerDir;
  if (!splayerDir) {
    for (const candidate of candidates) {
      try {
        const toolsPath = path.join(candidate, "resources", "native", "tools.node");
        require("node:fs").accessSync(toolsPath);
        splayerDir = candidate;
        break;
      } catch {
        // Continue searching common install locations.
      }
    }
  }

  const betterSqlite3Candidates = [
    options.betterSqlite3,
    splayerDir
      ? path.join(splayerDir, "resources", "app.asar.unpacked", "node_modules", "better-sqlite3")
      : "",
    "D:\\AI\\SPlayer\\node_modules\\better-sqlite3"
  ].filter(Boolean);

  return {
    ...options,
    splayerDir,
    toolsNode:
      options.toolsNode ||
      (splayerDir ? path.join(splayerDir, "resources", "native", "tools.node") : ""),
    betterSqlite3: options.betterSqlite3 || betterSqlite3Candidates[0] || "",
    betterSqlite3Candidates
  };
};

const ensureInputs = async (options) => {
  if (!options.root) {
    throw new Error("--root <music-dir> is required");
  }
  if (!options.splayerDir) {
    throw new Error("SPlayer install directory was not found; pass --splayer-dir or --tools-node");
  }
  const rootStat = await fs.stat(options.root);
  if (!rootStat.isDirectory()) {
    throw new Error(`--root is not a directory: ${options.root}`);
  }
  const toolsStat = await fs.stat(options.toolsNode);
  if (!toolsStat.isFile()) {
    throw new Error(`SPlayer tools.node was not found: ${options.toolsNode}`);
  }
  if (options.betterSqlite3Candidates.length === 0) {
    throw new Error("No better-sqlite3 candidate was found for SPlayer baseline persistence");
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
          extension: ext,
          size_bytes: stat.size
        });
      }
    }
  }
  return files;
};

const createDatabase = (Database, dbPath) => {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT,
      artist TEXT,
      album TEXT,
      duration REAL,
      cover TEXT,
      mtime REAL,
      size INTEGER,
      bitrate REAL,
      track_number INTEGER
    );
    CREATE TABLE IF NOT EXISTS audio_analysis (
      path TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      mtime REAL,
      size INTEGER
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks (album);
  `);
  return db;
};

const createInserter = (db) => {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO tracks (
      id, path, title, artist, album, duration, cover, mtime, size, bitrate, track_number
    ) VALUES (
      @id, @path, @title, @artist, @album, @duration, @cover, @mtime, @size, @bitrate, @track_number
    )
  `);

  return db.transaction((tracks) => {
    for (const track of tracks) {
      insert.run({
        id: track.id,
        path: track.path,
        title: track.title || null,
        artist: track.artist || null,
        album: track.album || null,
        duration: typeof track.duration === "number" ? track.duration : null,
        cover: track.cover || null,
        mtime: typeof track.mtime === "number" ? track.mtime : null,
        size: typeof track.size === "number" ? track.size : null,
        bitrate: typeof track.bitrate === "number" ? track.bitrate : null,
        track_number:
          typeof track.trackNumber === "number"
            ? track.trackNumber
            : typeof track.track_number === "number"
              ? track.track_number
              : null
      });
    }
  });
};

const summarizeDatabase = (db) => {
  const count = db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count;
  const size = db.prepare("SELECT COALESCE(SUM(size), 0) AS size FROM tracks").get().size;
  const paths = db.prepare("SELECT path FROM tracks").all();
  const byExtension = paths.reduce((acc, row) => {
    const ext = path.extname(row.path || "").slice(1).toLowerCase() || "(none)";
    acc[ext] = (acc[ext] || 0) + 1;
    return acc;
  }, {});
  const presence = db
    .prepare(
      `SELECT
        SUM(CASE WHEN title IS NOT NULL AND title != '' THEN 1 ELSE 0 END) AS title,
        SUM(CASE WHEN artist IS NOT NULL AND artist != '' THEN 1 ELSE 0 END) AS artist,
        SUM(CASE WHEN album IS NOT NULL AND album != '' THEN 1 ELSE 0 END) AS album,
        SUM(CASE WHEN duration IS NOT NULL THEN 1 ELSE 0 END) AS duration,
        SUM(CASE WHEN cover IS NOT NULL AND cover != '' THEN 1 ELSE 0 END) AS cover
      FROM tracks`
    )
    .get();

  return {
    track_count: count,
    total_size_bytes: size,
    by_extension: byExtension,
    metadata_presence: {
      title: presence.title || 0,
      artist: presence.artist || 0,
      album: presence.album || 0,
      duration: presence.duration || 0
    },
    cover_presence: {
      has_cover_art: presence.cover || 0,
      missing: count - (presence.cover || 0)
    }
  };
};

const sampleProcess = async (pid) => {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    id: pid,
    cpu_seconds: (cpu.user + cpu.system) / 1_000_000,
    working_set_bytes: memory.rss,
    private_memory_bytes: memory.heapTotal + memory.external + memory.arrayBuffers,
    peak_working_set_bytes: null,
    handles: null,
    threads: null
  };
};

const createMonitor = (pid, sampleMs) => {
  const samples = [];
  let timer = null;
  let stopped = false;
  let samplingPromise = null;
  const startedAt = performance.now();

  const collect = async () => {
    if (stopped) return;
    if (samplingPromise) {
      return samplingPromise;
    }
    samplingPromise = (async () => {
      try {
        const sample = await sampleProcess(pid);
        if (sample) {
          samples.push({
            at_ms: Number((performance.now() - startedAt).toFixed(3)),
            ...sample
          });
        }
      } catch (error) {
        samples.push({
          at_ms: Number((performance.now() - startedAt).toFixed(3)),
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        samplingPromise = null;
      }
    })();
    return samplingPromise;
  };

  return {
    start() {
      void collect();
      timer = setInterval(() => {
        void collect();
      }, sampleMs);
    },
    async stop() {
      if (timer !== null) {
        clearInterval(timer);
      }
      if (samplingPromise) {
        await samplingPromise;
      }
      await collect();
      stopped = true;
      return samples;
    }
  };
};

const maxNumeric = (items, field) => {
  const values = items.map((item) => item[field]).filter((value) => typeof value === "number");
  return values.length === 0 ? null : Math.max(...values);
};

const summarizeSamples = (samples) => {
  const valid = samples.filter((sample) => typeof sample.cpu_seconds === "number");
  let peakCpuPercent = null;
  const logicalCores = Math.max(1, os.cpus().length);
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1];
    const current = valid[index];
    const elapsedSeconds = (current.at_ms - previous.at_ms) / 1000;
    const cpuSeconds = current.cpu_seconds - previous.cpu_seconds;
    if (elapsedSeconds > 0 && cpuSeconds >= 0) {
      const cpuPercent = (cpuSeconds / (elapsedSeconds * logicalCores)) * 100;
      peakCpuPercent = Math.max(peakCpuPercent || 0, cpuPercent);
    }
  }

  return {
    sample_count: samples.length,
    valid_sample_count: valid.length,
    logical_cores: logicalCores,
    cpu_seconds_consumed:
      valid.length >= 2 ? Number((valid[valid.length - 1].cpu_seconds - valid[0].cpu_seconds).toFixed(3)) : null,
    peak_cpu_percent: peakCpuPercent === null ? null : Number(peakCpuPercent.toFixed(3)),
    peak_working_set_bytes: maxNumeric(valid, "working_set_bytes"),
    peak_private_memory_bytes: maxNumeric(valid, "private_memory_bytes"),
    peak_reported_working_set_bytes: maxNumeric(valid, "peak_working_set_bytes"),
    peak_handles: maxNumeric(valid, "handles"),
    peak_threads: maxNumeric(valid, "threads")
  };
};

const writeReport = async (options, report) => {
  await fs.mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, "splayer-library-benchmark.json");
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, outputPath);
  return outputPath;
};

const loadBetterSqlite3 = (options) => {
  const errors = [];
  for (const candidate of options.betterSqlite3Candidates) {
    try {
      const Database = require(candidate);
      const probe = new Database(":memory:");
      probe.close();
      return { Database, path: candidate };
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Failed to load better-sqlite3 for SPlayer baseline:\n${errors.join("\n")}`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await ensureInputs(options);
  await fs.mkdir(options.outputDir, { recursive: true });

  const dbPath = path.join(options.outputDir, "splayer-library.db");
  const coverDir = path.join(options.outputDir, "covers");
  await fs.rm(dbPath, { force: true });
  await fs.rm(`${dbPath}-wal`, { force: true });
  await fs.rm(`${dbPath}-shm`, { force: true });
  await fs.rm(coverDir, { recursive: true, force: true });
  await fs.mkdir(coverDir, { recursive: true });

  const inputFiles = await walk(options.root);
  const sqlite = loadBetterSqlite3(options);
  const tools = require(options.toolsNode);
  const db = createDatabase(sqlite.Database, dbPath);
  const insertTracks = createInserter(db);
  const monitor = createMonitor(process.pid, options.sampleMs);
  const progressSamples = [];
  let callbackError = null;
  let receivedTracks = 0;
  let endSeen = false;

  const report = {
    probe: "splayer-library-benchmark",
    baseline: "SPlayer native tools.node scanMusicLibrary",
    generated_at: new Date().toISOString(),
    root: options.root,
    splayer_dir: options.splayerDir,
    tools_node: options.toolsNode,
    output_dir: options.outputDir,
    better_sqlite3_path: sqlite.path,
    summary: { pass: false },
    input_inventory: {
      supported_files: inputFiles.length,
      total_size_bytes: inputFiles.reduce((sum, file) => sum + file.size_bytes, 0),
      by_extension: inputFiles.reduce((acc, file) => {
        acc[file.extension] = (acc[file.extension] || 0) + 1;
        return acc;
      }, {})
    },
    scan: null,
    library_summary: null,
    process_metrics: null,
    limitations: [
      "This calls SPlayer's installed native scanner directly and does not automate the full Electron UI.",
      "The benchmark uses SPlayer's SQLite schema and batch insert behavior, but omits renderer/store update overhead.",
      "SPlayer's scanner intentionally skips files smaller than 1024 bytes and files whose tags cannot be read by lofty."
    ]
  };

  const startedAt = performance.now();
  monitor.start();
  try {
    await tools.scanMusicLibrary(dbPath, [options.root], coverDir, (err, event) => {
      if (err) {
        callbackError = err instanceof Error ? err : new Error(String(err));
        return;
      }
      if (!event || typeof event.event !== "string") {
        return;
      }
      if (event.event === "progress" && event.progress) {
        progressSamples.push({
          at_ms: Number((performance.now() - startedAt).toFixed(3)),
          current: event.progress.current,
          total: event.progress.total
        });
      } else if (event.event === "batch" && Array.isArray(event.tracks) && event.tracks.length > 0) {
        insertTracks(event.tracks);
        receivedTracks += event.tracks.length;
      } else if (event.event === "end") {
        endSeen = true;
        report.deleted_paths = Array.isArray(event.deletedPaths) ? event.deletedPaths.length : 0;
      }
    });

    if (callbackError) {
      throw callbackError;
    }
    report.library_summary = summarizeDatabase(db);
    report.scan = {
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      status: endSeen ? "success" : "finished_without_end_event",
      received_tracks: receivedTracks,
      progress_samples: progressSamples
    };
    report.summary.pass = endSeen;
  } catch (error) {
    report.summary.pass = false;
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    const samples = await monitor.stop();
    report.process_metrics = {
      summary: summarizeSamples(samples),
      samples
    };
    db.close();
  }

  const outputPath = await writeReport(options, report);
  console.log(`[splayer-library] wrote ${path.relative(appRoot, outputPath)}`);
  console.log(
    `[splayer-library] pass=${report.summary.pass} status=${report.scan ? report.scan.status : "error"} media=${report.library_summary ? report.library_summary.track_count : 0} elapsed=${report.scan ? report.scan.elapsed_ms : 0}ms`
  );
  if (report.process_metrics && report.process_metrics.summary) {
    const metrics = report.process_metrics.summary;
    console.log(
      `[splayer-library] peak_working_set=${metrics.peak_working_set_bytes || 0}B peak_cpu=${metrics.peak_cpu_percent || 0}%`
    );
  }
  if (!report.summary.pass) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
