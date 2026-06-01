#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toAppPath = (value) => (path.isAbsolute(value) ? value : path.resolve(appRoot, value));

const positiveInteger = (value, name) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

const positiveNumber = (value, name) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
};

const nonNegativeInteger = (value, name) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
};

const normalizeBaseUrl = (baseUrl) => baseUrl.replace(/\/$/, "");

const cappedAppend = (current, chunk, maxLength = 60000) => {
  const next = `${current}${chunk}`;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
};

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
          : text || `HTTP ${response.status}`;
      throw new Error(`${method} ${route} failed: ${message}`);
    }
    return { json, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
};

const readState = async (options) => {
  const { json, latencyMs } = await requestJson(options, "GET", "/state");
  if (!json || typeof json !== "object" || json.status !== "success" || !json.state) {
    throw new Error("Invalid /state response");
  }
  return { state: json.state, latencyMs };
};

const readRuntimeDiagnostics = async (options) => {
  const { json, latencyMs } = await requestJson(options, "GET", "/diagnostics/runtime");
  if (!json || typeof json !== "object" || json.status !== "success" || !json.snapshot) {
    throw new Error("Invalid /diagnostics/runtime response");
  }
  return { snapshot: json.snapshot, latencyMs };
};

const pollUntil = async ({ label, timeoutMs, intervalMs, sample, predicate }) => {
  const startedAt = performance.now();
  let polls = 0;
  let lastValue = null;
  while (performance.now() - startedAt <= timeoutMs) {
    lastValue = await sample();
    polls += 1;
    if (predicate(lastValue)) {
      return {
        value: lastValue,
        polls,
        elapsed_ms: Number((performance.now() - startedAt).toFixed(3))
      };
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out after ${timeoutMs} ms`);
};

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
};

const summarizeNumeric = (values) => {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) {
    return { count: 0, min: null, p50: null, p95: null, max: null, average: null };
  }
  const sum = valid.reduce((total, value) => total + value, 0);
  return {
    count: valid.length,
    min: Number(Math.min(...valid).toFixed(3)),
    p50: Number(percentile(valid, 0.5).toFixed(3)),
    p95: Number(percentile(valid, 0.95).toFixed(3)),
    max: Number(Math.max(...valid).toFixed(3)),
    average: Number((sum / valid.length).toFixed(3))
  };
};

const maxNumeric = (items, field) => {
  const values = items.map((item) => item[field]).filter((value) => typeof value === "number");
  return values.length === 0 ? null : Math.max(...values);
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

const sampleProcess = async (pid, relativeStartedAt = performance.now()) => {
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
  return trimmed
    ? {
        at_ms: Number((performance.now() - relativeStartedAt).toFixed(3)),
        ...JSON.parse(trimmed)
      }
    : null;
};

const createProcessMonitor = (pid, sampleMs) => {
  const samples = [];
  const startedAt = performance.now();
  let timer = null;
  let stopped = false;
  let samplingPromise = null;

  const collect = async () => {
    if (stopped) return;
    if (samplingPromise) return samplingPromise;
    samplingPromise = (async () => {
      try {
        const sample = await sampleProcess(pid, startedAt);
        if (sample) {
          samples.push(sample);
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

const summarizeProcessSamples = (samples) => {
  const valid = samples.filter((sample) => typeof sample.cpu_seconds === "number");
  const logicalCores = Math.max(1, os.cpus().length);
  let peakCpuPercent = null;

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

const ensureFile = async (filePath, label) => {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`);
  }
};

const ensureAudioFile = async (filePath, label = "track") => {
  await ensureFile(filePath, label);
  return filePath;
};

const startAudioServer = async (options) => {
  const serverPath = options.serverPath || path.join(repoRoot, "target", "release", "audio_server.exe");
  await ensureFile(serverPath, "audio_server");
  const runtimeDir =
    options.runtimeDir ||
    path.join(repoRoot, ".tmp-lyne-evidence", `runtime-playback-${options.port}-${Date.now()}`);
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
    ANALYSIS_MAX_CONCURRENCY: String(options.analysisConcurrency || 1),
    ANALYSIS_MAX_BLOCKING_THREADS: String(options.analysisBlockingThreads || 2),
    LIBRARY_SCAN_MAX_WORKERS: String(options.scanWorkers || 2)
  };

  const child = spawn(serverPath, ["--port", String(options.port)], {
    cwd: path.dirname(serverPath),
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

  return {
    child,
    logs,
    runtime: { runtimeDir, dataDir, cacheDir, logsDir },
    serverPath
  };
};

const waitForAudioServer = async (options, child) => {
  const startedAt = performance.now();
  let lastError = null;
  while (performance.now() - startedAt < options.serverReadyMs) {
    if (child.exitCode !== null) {
      throw new Error(`audio_server exited before readiness with code ${child.exitCode}`);
    }
    try {
      const json = await requestJson(options, "GET", "/state");
      if (json.json && json.json.status === "success") {
        return Number((performance.now() - startedAt).toFixed(3));
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for audio_server readiness: ${lastError || "no response"}`);
};

const shutdownAudioServer = async (options, child) => {
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

const writeJsonReport = async (outputDir, fileName, report) => {
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, outputPath);
  return outputPath;
};

module.exports = {
  appRoot,
  repoRoot,
  sleep,
  toAppPath,
  positiveInteger,
  positiveNumber,
  nonNegativeInteger,
  normalizeBaseUrl,
  requestJson,
  readState,
  readRuntimeDiagnostics,
  pollUntil,
  summarizeNumeric,
  createProcessMonitor,
  summarizeProcessSamples,
  ensureAudioFile,
  startAudioServer,
  waitForAudioServer,
  shutdownAudioServer,
  writeJsonReport
};
