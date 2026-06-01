#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const defaultOutDir = path.join(appRoot, "output", "lyne-evidence", "real-library");

const parseArgs = (argv) => {
  const options = {
    root: process.env.LYNE_REAL_LIBRARY_ROOT || "",
    serverPath: path.join(repoRoot, "target", "release", "audio_server.exe"),
    outputDir: defaultOutDir,
    port: Number.parseInt(process.env.LYNE_REAL_LIBRARY_PORT || "63894", 10),
    token: process.env.LYNE_AUDIO_API_TOKEN || `lyne-real-library-${Date.now()}`,
    timeoutMs: 5000,
    pollMs: 1000,
    maxWaitMs: 900000,
    serverReadyMs: 30000,
    sampleMs: 1000,
    scanWorkers: 2,
    analysisConcurrency: 1,
    analysisBlockingThreads: 2
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const readInteger = (name) => {
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      const value = Number.parseInt(next, 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
      return value;
    };

    if (arg === "--root" && next) {
      options.root = path.resolve(next);
      index += 1;
    } else if (arg === "--server" && next) {
      options.serverPath = path.resolve(next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      options.outputDir = path.resolve(appRoot, next);
      index += 1;
    } else if (arg === "--port") {
      options.port = readInteger(arg);
    } else if (arg === "--token" && next) {
      options.token = next;
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = readInteger(arg);
    } else if (arg === "--poll-ms") {
      options.pollMs = readInteger(arg);
    } else if (arg === "--max-wait-ms") {
      options.maxWaitMs = readInteger(arg);
    } else if (arg === "--server-ready-ms") {
      options.serverReadyMs = readInteger(arg);
    } else if (arg === "--sample-ms") {
      options.sampleMs = readInteger(arg);
    } else if (arg === "--scan-workers") {
      options.scanWorkers = readInteger(arg);
    } else if (arg === "--analysis-concurrency") {
      options.analysisConcurrency = readInteger(arg);
    } else if (arg === "--analysis-blocking-threads") {
      options.analysisBlockingThreads = readInteger(arg);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/lyne-real-library-benchmark.cjs --root <music-dir> [options]

Starts an isolated audio_server.exe, runs the library scan evidence probe, samples
the server process, writes generated reports under apps/desktop/output/, and
then shuts the server down.

Options:
  --root <dir>                    Real local library root to scan
  --server <path>                 audio_server.exe path (default: target/release/audio_server.exe)
  --output-dir <dir>              Output directory relative to apps/desktop unless absolute
  --port <port>                   Isolated server port (default: 63894)
  --token <token>                 Bearer token for the isolated server
  --timeout-ms <ms>               Per-request timeout (default: 5000)
  --poll-ms <ms>                  Scan polling interval (default: 1000)
  --max-wait-ms <ms>              Max wait for scan completion (default: 900000)
  --server-ready-ms <ms>          Max wait for /state readiness (default: 30000)
  --sample-ms <ms>                Process metric sampling interval (default: 1000)
  --scan-workers <n>              LIBRARY_SCAN_MAX_WORKERS (default: 2, matches app default)
  --analysis-concurrency <n>      ANALYSIS_MAX_CONCURRENCY (default: 1)
  --analysis-blocking-threads <n> ANALYSIS_MAX_BLOCKING_THREADS (default: 2)
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

  try {
    const response = await fetch(`http://127.0.0.1:${options.port}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${method} ${route} failed with HTTP ${response.status}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
};

const ensureInputs = async (options) => {
  const rootStat = await fs.stat(options.root);
  if (!rootStat.isDirectory()) {
    throw new Error(`--root is not a directory: ${options.root}`);
  }
  const serverStat = await fs.stat(options.serverPath);
  if (!serverStat.isFile()) {
    throw new Error(`--server is not a file: ${options.serverPath}`);
  }
};

const cappedAppend = (current, chunk, maxLength = 60000) => {
  const next = `${current}${chunk}`;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
};

const startServer = async (options, runtimeDir) => {
  const dataDir = path.join(runtimeDir, "data");
  const cacheDir = path.join(runtimeDir, "cache");
  const logsDir = path.join(runtimeDir, "logs");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  const env = {
    ...process.env,
    AUDIO_API_TOKEN: options.token,
    AUDIO_APP_DATA_DIR: dataDir,
    APP_DATA: dataDir,
    APPDATA: dataDir,
    AUDIO_CACHE_DIR: cacheDir,
    AUDIO_LOG_DIR: logsDir,
    AUDIO_SETTINGS_PATH: path.join(runtimeDir, "audio_settings.json"),
    LOUDNESS_DB_PATH: path.join(runtimeDir, "loudness_cache.db"),
    AUDIO_APP_DB_PATH: path.join(runtimeDir, "app_state.db"),
    AUDIO_ALLOWED_ORIGINS: "*",
    ANALYSIS_MAX_CONCURRENCY: String(options.analysisConcurrency),
    ANALYSIS_MAX_BLOCKING_THREADS: String(options.analysisBlockingThreads),
    LIBRARY_SCAN_MAX_WORKERS: String(options.scanWorkers)
  };

  const child = spawn(options.serverPath, ["--port", String(options.port)], {
    cwd: path.dirname(options.serverPath),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => {
    logs.stdout = cappedAppend(logs.stdout, chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    logs.stderr = cappedAppend(logs.stderr, chunk.toString("utf8"));
  });

  return { child, logs, runtime: { runtimeDir, dataDir, cacheDir, logsDir } };
};

const waitForServer = async (options, child) => {
  const startedAt = performance.now();
  let lastError = null;
  while (performance.now() - startedAt < options.serverReadyMs) {
    if (child.exitCode !== null) {
      throw new Error(`audio_server exited before readiness with code ${child.exitCode}`);
    }
    try {
      const json = await requestJson(options, "GET", "/state");
      if (json && json.status === "success") {
        return Number((performance.now() - startedAt).toFixed(3));
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for audio_server readiness: ${lastError || "no response"}`);
};

const execFileAsync = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

const sampleProcess = async (pid) => {
  if (process.platform !== "win32") {
    return null;
  }

  const command = [
    "$p = Get-Process -Id",
    String(pid),
    "-ErrorAction SilentlyContinue;",
    "if ($p) {",
    "[pscustomobject]@{",
    "id = $p.Id;",
    "cpu_seconds = $p.CPU;",
    "working_set_bytes = $p.WorkingSet64;",
    "private_memory_bytes = $p.PrivateMemorySize64;",
    "peak_working_set_bytes = $p.PeakWorkingSet64;",
    "handles = $p.HandleCount;",
    "threads = $p.Threads.Count",
    "} | ConvertTo-Json -Compress",
    "}"
  ].join(" ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
};

const createMonitor = (pid, sampleMs) => {
  const samples = [];
  let timer = null;
  let stopped = false;
  let samplingPromise = null;

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
            at_ms: Number(performance.now().toFixed(3)),
            ...sample
          });
        }
      } catch (error) {
        samples.push({
          at_ms: Number(performance.now().toFixed(3)),
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

const maxNumeric = (items, field) => {
  const values = items.map((item) => item[field]).filter((value) => typeof value === "number");
  return values.length === 0 ? null : Math.max(...values);
};

const runScanProbe = (options) =>
  new Promise((resolve, reject) => {
    const scriptPath = path.join(appRoot, "scripts", "lyne-library-scan-evidence.cjs");
    const args = [
      scriptPath,
      "--base-url",
      `http://127.0.0.1:${options.port}`,
      "--token",
      options.token,
      "--root",
      options.root,
      "--output-dir",
      options.outputDir,
      "--timeout-ms",
      String(options.timeoutMs),
      "--poll-ms",
      String(options.pollMs),
      "--max-wait-ms",
      String(options.maxWaitMs)
    ];
    const child = spawn(process.execPath, args, {
      cwd: appRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout = cappedAppend(stdout, text);
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = cappedAppend(stderr, text);
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`library scan evidence probe exited with code ${code}`));
      }
    });
  });

const shutdownServer = async (options, child) => {
  try {
    await requestJson(options, "POST", "/shutdown");
  } catch {
    // A failed shutdown request is followed by a process kill below.
  }

  const exited = await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!exited && child.exitCode === null) {
    child.kill();
  }
};

const readJsonIfExists = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const writeReport = async (options, report) => {
  await fs.mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, "real-library-benchmark.json");
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, outputPath);
  return outputPath;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.root) {
    throw new Error("--root <music-dir> is required");
  }
  await ensureInputs(options);
  await fs.mkdir(options.outputDir, { recursive: true });

  const runtimeDir = path.join(repoRoot, ".tmp-lyne-evidence", `runtime-real-${options.port}-${Date.now()}`);
  const report = {
    probe: "lyne-real-library-benchmark",
    generated_at: new Date().toISOString(),
    root: options.root,
    server_path: options.serverPath,
    port: options.port,
    output_dir: options.outputDir,
    parameters: {
      timeout_ms: options.timeoutMs,
      poll_ms: options.pollMs,
      max_wait_ms: options.maxWaitMs,
      sample_ms: options.sampleMs,
      scan_workers: options.scanWorkers,
      analysis_concurrency: options.analysisConcurrency,
      analysis_blocking_threads: options.analysisBlockingThreads
    },
    summary: { pass: false },
    server: null,
    scan_probe: null,
    process_metrics: null,
    limitations: [
      "This benchmark treats the supplied music directory as read-only and records aggregate scan metrics only.",
      "CPU and memory samples are process-level Windows Get-Process snapshots, not a full profiler trace.",
      "The benchmark proves Lyne server scan behavior; it does not automatically operate SPlayer's UI or import flow."
    ]
  };

  let server = null;
  let monitor = null;
  const startedAt = performance.now();
  try {
    server = await startServer(options, runtimeDir);
    monitor = createMonitor(server.child.pid, options.sampleMs);
    monitor.start();
    const readyMs = await waitForServer(options, server.child);
    report.server = {
      pid: server.child.pid,
      ready_ms: readyMs,
      runtime: server.runtime
    };

    const scanStartedAt = performance.now();
    report.scan_probe = await runScanProbe(options);
    report.scan_probe.elapsed_ms = Number((performance.now() - scanStartedAt).toFixed(3));

    const scanReportPath = path.join(options.outputDir, "library-scan-evidence.json");
    report.scan_report = await readJsonIfExists(scanReportPath);
    report.summary.pass = Boolean(report.scan_report && report.scan_report.summary && report.scan_report.summary.pass);
  } catch (error) {
    report.summary.pass = false;
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (monitor) {
      const samples = await monitor.stop();
      report.process_metrics = {
        summary: summarizeSamples(samples),
        samples
      };
    }
    if (server) {
      await shutdownServer(options, server.child);
      report.server = {
        ...(report.server || { pid: server.child.pid, runtime: server.runtime }),
        exit_code: server.child.exitCode,
        stdout_tail: server.logs.stdout,
        stderr_tail: server.logs.stderr
      };
    }
    report.summary.total_elapsed_ms = Number((performance.now() - startedAt).toFixed(3));
  }

  const outputPath = await writeReport(options, report);
  console.log(`[lyne-real-library] wrote ${path.relative(appRoot, outputPath)}`);
  if (report.scan_report && report.scan_report.summary) {
    const library = report.scan_report.library_summary || {};
    const scan = report.scan_report.scan || {};
    console.log(
      `[lyne-real-library] pass=${report.summary.pass} status=${report.scan_report.summary.status} media=${library.track_count || 0} elapsed=${scan.elapsed_ms || 0}ms`
    );
  } else {
    console.log(`[lyne-real-library] pass=${report.summary.pass}`);
  }
  if (report.process_metrics && report.process_metrics.summary) {
    const metrics = report.process_metrics.summary;
    console.log(
      `[lyne-real-library] peak_working_set=${metrics.peak_working_set_bytes || 0}B peak_cpu=${metrics.peak_cpu_percent || 0}%`
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
