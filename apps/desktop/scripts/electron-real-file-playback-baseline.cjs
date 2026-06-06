#!/usr/bin/env node
"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { pathToFileURL } = require("node:url");
const {
  appRoot,
  sleep,
  toAppPath,
  positiveInteger,
  positiveNumber,
  summarizeNumeric,
  createProcessMonitor,
  summarizeProcessSamples,
  ensureAudioFile,
  writeJsonReport
} = require("./perf-utils.cjs");

const defaultOutDir = path.join(appRoot, "output", "electron-real-file-playback-baseline");
const outputFileName = "real-file-playback-baseline.json";
const workerEnvName = "LYNE_ELECTRON_REAL_FILE_WORKER";
const runIdEnvName = "LYNE_ELECTRON_REAL_FILE_RUN_ID";

const parseArgs = (argv) => {
  const options = {
    outputDir: defaultOutDir,
    userDataDir: "",
    track: process.env.LYNE_PROBE_TRACK || "",
    nextTrack: process.env.LYNE_PROBE_NEXT_TRACK || "",
    trials: 3,
    controlToggles: 60,
    stabilitySeconds: 30,
    sampleMs: 500,
    progressTimeoutMs: 15000,
    seekTimeoutMs: 10000,
    pollMs: 25,
    settleMs: 350,
    seekFractions: [0.25, 0.5, 0.75],
    useWebAudio: true,
    useCompressor: true,
    loopDuringStability: true,
    inWindowSeek: false,
    inWindowPrerollMs: 10000,
    inWindowBackSecs: 6,
    inWindowTrials: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const readPath = (name) => {
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      return path.resolve(next);
    };
    const readInteger = (name) => {
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      return positiveInteger(next, name);
    };
    const readNumber = (name) => {
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      return positiveNumber(next, name);
    };

    switch (arg) {
      case "--track":
        options.track = readPath(arg);
        break;
      case "--next-track":
        options.nextTrack = readPath(arg);
        break;
      case "--output-dir":
      case "--out":
        if (!next) throw new Error(`${arg} requires a value`);
        index += 1;
        options.outputDir = toAppPath(next);
        break;
      case "--user-data-dir":
        if (!next) throw new Error("--user-data-dir requires a value");
        index += 1;
        options.userDataDir = toAppPath(next);
        break;
      case "--trials":
        options.trials = readInteger(arg);
        break;
      case "--control-toggles":
        options.controlToggles = readInteger(arg);
        break;
      case "--stability-seconds":
        options.stabilitySeconds = readNumber(arg);
        break;
      case "--sample-ms":
        options.sampleMs = readInteger(arg);
        break;
      case "--progress-timeout-ms":
        options.progressTimeoutMs = readInteger(arg);
        break;
      case "--seek-timeout-ms":
        options.seekTimeoutMs = readInteger(arg);
        break;
      case "--poll-ms":
        options.pollMs = readInteger(arg);
        break;
      case "--settle-ms":
        options.settleMs = readInteger(arg);
        break;
      case "--seek-fractions":
        if (!next) throw new Error("--seek-fractions requires a value");
        index += 1;
        options.seekFractions = next.split(",").map((part) => positiveNumber(part.trim(), arg));
        break;
      case "--in-window-seek":
        options.inWindowSeek = true;
        break;
      case "--in-window-preroll-ms":
        options.inWindowPrerollMs = readInteger(arg);
        break;
      case "--in-window-back-secs":
        options.inWindowBackSecs = readNumber(arg);
        break;
      case "--in-window-trials":
        options.inWindowTrials = readInteger(arg);
        break;
      case "--no-webaudio":
        options.useWebAudio = false;
        break;
      case "--no-compressor":
        options.useCompressor = false;
        break;
      case "--no-loop":
        options.loopDuringStability = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.track) {
    throw new Error("--track <audio-file> is required");
  }
  if (options.seekFractions.some((fraction) => fraction <= 0 || fraction >= 1)) {
    throw new Error("--seek-fractions values must be between 0 and 1");
  }
  if (options.inWindowTrials === null) {
    options.inWindowTrials = options.trials;
  }

  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/electron-real-file-playback-baseline.cjs --track <audio-file> [options]

Measures a plain Electron HTMLMediaElement/WebAudio baseline against real local
audio files. It uses operations comparable to Lyne's playback latency and
stability probes: load-to-progress, pause/play resume, seek convergence, optional
next-track switch, parameter updates while playing, stability samples, and coarse
CPU/RSS process metrics.

Options:
  --track <path>                 Primary local audio file
  --next-track <path>            Optional second audio file for switch latency
  --trials <n>                   Trial count for load/play/seek (default: 3)
  --seek-fractions <csv>         Seek targets as duration fractions (default: 0.25,0.5,0.75)
  --control-toggles <n>          WebAudio parameter update count (default: 60)
  --stability-seconds <seconds>  Wall-clock observation duration (default: 30)
  --progress-timeout-ms <ms>     Playback progress timeout (default: 15000)
  --seek-timeout-ms <ms>         Seek convergence timeout (default: 10000)
  --poll-ms <ms>                 Renderer polling interval (default: 25)
  --sample-ms <ms>               Main-process CPU/RSS sample interval (default: 500)
  --settle-ms <ms>               Delay between operations (default: 350)
  --in-window-seek               Add a backward seek after a playback preroll
  --in-window-preroll-ms <ms>    Playback time before the backward seek (default: 10000)
  --in-window-back-secs <s>      Backward hop distance from live playhead (default: 6)
  --in-window-trials <n>         In-window scenario trial count (default: --trials value)
  --no-webaudio                  Measure plain HTMLAudioElement playback only
  --no-compressor                Keep WebAudio EQ/gain/analyser but skip DynamicsCompressor
  --no-loop                      Do not seek back to start near track end during stability
  --user-data-dir <dir>          Isolated Electron user data dir
  --out <dir>                    Output directory relative to apps/desktop unless absolute
`);
};

const withTimeout = (promise, timeoutMs, label) => {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
};

const toErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const appendCapped = (current, chunk, maxLength = 60000) => {
  const next = `${current}${chunk}`;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
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

const sampleProcessTree = async (rootPid, relativeStartedAt = performance.now()) => {
  if (process.platform !== "win32") {
    return null;
  }

  const command = [
    "$root =",
    String(rootPid),
    ";",
    "$all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId, Name;",
    "$children = @{};",
    "foreach ($proc in $all) {",
    "$parent = [int]$proc.ParentProcessId;",
    "if (-not $children.ContainsKey($parent)) {",
    "$children[$parent] = New-Object System.Collections.Generic.List[int];",
    "}",
    "$children[$parent].Add([int]$proc.ProcessId);",
    "}",
    "$seen = New-Object System.Collections.Generic.HashSet[int];",
    "$queue = New-Object System.Collections.Generic.Queue[int];",
    "$queue.Enqueue([int]$root);",
    "while ($queue.Count -gt 0) {",
    "$id = $queue.Dequeue();",
    "if ($seen.Add($id) -and $children.ContainsKey($id)) {",
    "foreach ($child in $children[$id]) { $queue.Enqueue([int]$child); }",
    "}",
    "}",
    "$ids = @($seen);",
    "$processes = @();",
    "$cpu = 0.0; $ws = 0L; $private = 0L; $handles = 0L; $threads = 0L;",
    "foreach ($p in Get-Process -Id $ids -ErrorAction SilentlyContinue) {",
    "$pCpu = if ($null -eq $p.CPU) { 0.0 } else { [double]$p.CPU };",
    "$pThreads = if ($null -eq $p.Threads) { 0 } else { $p.Threads.Count };",
    "$processes += [pscustomobject]@{",
    "id = $p.Id;",
    "process_name = $p.ProcessName;",
    "cpu_seconds = $pCpu;",
    "working_set_bytes = $p.WorkingSet64;",
    "private_memory_bytes = $p.PrivateMemorySize64;",
    "handles = $p.HandleCount;",
    "threads = $pThreads",
    "};",
    "$cpu += $pCpu; $ws += $p.WorkingSet64; $private += $p.PrivateMemorySize64; $handles += $p.HandleCount; $threads += $pThreads;",
    "}",
    "[pscustomobject]@{",
    "root_pid = $root;",
    "processes = $processes;",
    "aggregate = [pscustomobject]@{",
    "process_count = $processes.Count;",
    "cpu_seconds = $cpu;",
    "working_set_bytes = $ws;",
    "private_memory_bytes = $private;",
    "handles = $handles;",
    "threads = $threads",
    "}",
    "} | ConvertTo-Json -Compress -Depth 5"
  ].join(" ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed);
  const processes = Array.isArray(parsed.processes)
    ? parsed.processes.filter((proc) => proc.process_name === "electron" || proc.process_name === "node")
    : [];
  const aggregate = processes.reduce(
    (total, proc) => ({
      process_count: total.process_count + 1,
      cpu_seconds: total.cpu_seconds + (typeof proc.cpu_seconds === "number" ? proc.cpu_seconds : 0),
      working_set_bytes:
        total.working_set_bytes + (typeof proc.working_set_bytes === "number" ? proc.working_set_bytes : 0),
      private_memory_bytes:
        total.private_memory_bytes + (typeof proc.private_memory_bytes === "number" ? proc.private_memory_bytes : 0),
      handles: total.handles + (typeof proc.handles === "number" ? proc.handles : 0),
      threads: total.threads + (typeof proc.threads === "number" ? proc.threads : 0)
    }),
    {
      process_count: 0,
      cpu_seconds: 0,
      working_set_bytes: 0,
      private_memory_bytes: 0,
      handles: 0,
      threads: 0
    }
  );

  return {
    at_ms: Number((performance.now() - relativeStartedAt).toFixed(3)),
    root_pid: parsed.root_pid,
    processes,
    aggregate
  };
};

const createProcessTreeMonitor = (rootPid, sampleMs) => {
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
        const sample = await sampleProcessTree(rootPid, startedAt);
        if (sample) {
          samples.push(sample);
        }
      } catch (error) {
        samples.push({
          at_ms: Number((performance.now() - startedAt).toFixed(3)),
          error: toErrorMessage(error)
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

const maxAggregate = (samples, field) => {
  const values = samples
    .map((sample) => (sample.aggregate && typeof sample.aggregate[field] === "number" ? sample.aggregate[field] : null))
    .filter((value) => typeof value === "number");
  return values.length === 0 ? null : Math.max(...values);
};

const summarizeProcessTreeSamples = (samples) => {
  const valid = samples.filter(
    (sample) =>
      sample.aggregate &&
      sample.aggregate.process_count > 0 &&
      typeof sample.aggregate.cpu_seconds === "number"
  );
  const logicalCores = Math.max(1, os.cpus().length);
  let peakCpuPercent = null;
  let cpuSecondsConsumed = 0;

  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1];
    const current = valid[index];
    const elapsedSeconds = (current.at_ms - previous.at_ms) / 1000;

    const previousByPid = new Map(previous.processes.map((proc) => [proc.id, proc]));
    let cpuSeconds = 0;
    for (const proc of current.processes) {
      const before = previousByPid.get(proc.id);
      if (!before) continue;
      const delta = proc.cpu_seconds - before.cpu_seconds;
      if (delta >= 0) {
        cpuSeconds += delta;
      }
    }

    if (elapsedSeconds > 0 && cpuSeconds >= 0) {
      cpuSecondsConsumed += cpuSeconds;
      const cpuPercent = (cpuSeconds / (elapsedSeconds * logicalCores)) * 100;
      peakCpuPercent = Math.max(peakCpuPercent || 0, cpuPercent);
    }
  }

  return {
    sample_count: samples.length,
    valid_sample_count: valid.length,
    logical_cores: logicalCores,
    cpu_seconds_consumed: valid.length >= 2 ? Number(cpuSecondsConsumed.toFixed(3)) : null,
    peak_cpu_percent: peakCpuPercent === null ? null : Number(peakCpuPercent.toFixed(3)),
    peak_working_set_bytes: maxAggregate(valid, "working_set_bytes"),
    peak_private_memory_bytes: maxAggregate(valid, "private_memory_bytes"),
    peak_handles: maxAggregate(valid, "handles"),
    peak_threads: maxAggregate(valid, "threads"),
    peak_process_count: maxAggregate(valid, "process_count")
  };
};

const runStage = async (diagnostics, name, action) => {
  const startedAt = performance.now();
  try {
    const value = await action();
    diagnostics.stages.push({
      name,
      status: "passed",
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3))
    });
    return value;
  } catch (error) {
    diagnostics.stages.push({
      name,
      status: "failed",
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      error: toErrorMessage(error)
    });
    throw error;
  }
};

const mimeForPath = (filePath) => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
    case ".oga":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    default:
      return "";
  }
};

const rendererProbeSource = `(() => ({
  ok: 1 + 1 === 2,
  href: window.location.href,
  has_audio_element: typeof HTMLAudioElement === "function",
  has_audio_context: typeof (window.AudioContext || window.webkitAudioContext) === "function",
  user_agent: navigator.userAgent
}))()`;

const createFixturePage = async (options) => {
  await fs.mkdir(options.outputDir, { recursive: true });
  const fixturePath = path.join(options.outputDir, "electron-real-file-playback-fixture.html");
  const html = [
    "<!doctype html>",
    '<meta charset="utf-8">',
    "<title>Electron real file playback baseline</title>",
    "<body></body>"
  ].join("");
  await fs.writeFile(fixturePath, html, "utf8");
  return fixturePath;
};

const loadFixturePage = async (window, options, diagnostics) => {
  diagnostics.page_load_attempts = [];
  const fixturePath = await createFixturePage(options);
  const fixtureUrl = pathToFileURL(fixturePath).toString();
  const startedAt = performance.now();
  try {
    await withTimeout(window.loadURL(fixtureUrl), 15000, "Electron real-file fixture page load");
    diagnostics.page_load_attempts.push({
      mode: "file_url",
      url: fixtureUrl,
      status: "passed",
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3))
    });
    return { mode: "file_url", fixture_path: fixturePath, fixture_url: fixtureUrl };
  } catch (error) {
    diagnostics.page_load_attempts.push({
      mode: "file_url",
      url: fixtureUrl,
      status: "failed",
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      error: toErrorMessage(error)
    });
    throw error;
  }
};

const findElectronInvocation = async () => {
  const cliPath = path.join(appRoot, "node_modules", "electron", "cli.js");
  try {
    await fs.access(cliPath);
    return {
      command: process.execPath,
      argsPrefix: [cliPath]
    };
  } catch {
    return {
      command: process.platform === "win32" ? "electron.cmd" : "electron",
      argsPrefix: []
    };
  }
};

const runSupervisor = async () => {
  const options = parseArgs(process.argv.slice(2));
  const electronInvocation = await findElectronInvocation();
  const runId = `${Date.now()}-${process.pid}`;
  let stdout = "";
  let stderr = "";
  let treeMonitor = null;

  const child = spawn(electronInvocation.command, [...electronInvocation.argsPrefix, __filename, ...process.argv.slice(2)], {
    cwd: appRoot,
    env: {
      ...process.env,
      [workerEnvName]: "1",
      [runIdEnvName]: runId
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  treeMonitor = createProcessTreeMonitor(child.pid, options.sampleMs);
  treeMonitor.start();

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stdout = appendCapped(stdout, text);
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr = appendCapped(stderr, text);
    process.stderr.write(text);
  });

  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
  });
  const processTreeSamples = treeMonitor ? await treeMonitor.stop() : [];

  const outputPath = path.join(options.outputDir, outputFileName);
  let report = null;
  try {
    const text = await fs.readFile(outputPath, "utf8");
    report = JSON.parse(text);
  } catch {
    report = null;
  }

  const workerSucceeded = exit.code === 0 && report && report.summary && report.summary.pass === true;
  if (workerSucceeded) {
    report.process_tree_metrics = {
      summary: summarizeProcessTreeSamples(processTreeSamples),
      samples: processTreeSamples
    };
    await writeJsonReport(options.outputDir, outputFileName, report);
    return;
  }

  const existingReportFromThisRun = report && report.environment && report.environment.run_id === runId;
  const summary = {
    pass: false,
    worker_exit_code: exit.code,
    worker_signal: exit.signal || null
  };
  const supervisorReport = {
    baseline: "electron-real-file-playback",
    generated_at: new Date().toISOString(),
    summary,
    error:
      exit.error instanceof Error
        ? exit.error.message
        : report && report.error
          ? report.error
          : `Electron worker exited before writing a passing report (code=${exit.code}, signal=${exit.signal || "none"})`,
    worker_diagnostics: {
      run_id: runId,
      report_from_worker: existingReportFromThisRun,
      stdout_tail: stdout,
      stderr_tail: stderr
    },
    process_tree_metrics: {
      summary: summarizeProcessTreeSamples(processTreeSamples),
      samples: processTreeSamples
    },
    worker_report: existingReportFromThisRun ? report : null
  };
  const writtenPath = await writeJsonReport(options.outputDir, outputFileName, supervisorReport);
  console.error(`[electron-real-file] supervisor wrote failed report ${path.relative(appRoot, writtenPath)}`);
  process.exitCode = exit.code || 1;
};

const rendererHarnessSource = (options) => `
(() => {
  const options = ${JSON.stringify(options)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frequencies = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  const percentile = (values, p) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
    return sorted[index];
  };

  const summarize = (values) => {
    const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (valid.length === 0) return { count: 0, min: null, p50: null, p95: null, max: null, average: null };
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

  const mediaErrorDetails = (audio) => {
    if (!audio || !audio.error) return null;
    const codeNames = {
      1: "MEDIA_ERR_ABORTED",
      2: "MEDIA_ERR_NETWORK",
      3: "MEDIA_ERR_DECODE",
      4: "MEDIA_ERR_SRC_NOT_SUPPORTED"
    };
    return {
      code: audio.error.code,
      code_name: codeNames[audio.error.code] || "MEDIA_ERR_UNKNOWN",
      message: audio.error.message || "",
      network_state: audio.networkState,
      ready_state: audio.readyState,
      current_src: audio.currentSrc || audio.src || ""
    };
  };

  const mediaState = (audio, context) => ({
    current_time: Number((audio.currentTime || 0).toFixed(6)),
    duration: Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(6)) : null,
    paused: audio.paused,
    ended: audio.ended,
    seeking: audio.seeking,
    ready_state: audio.readyState,
    network_state: audio.networkState,
    current_src: audio.currentSrc || audio.src || "",
    context_state: context ? context.state : null,
    media_error: mediaErrorDetails(audio)
  });

  const waitFor = async ({ label, timeoutMs, predicate, audio, context, rejectOnMediaError = true }) => {
    const startedAt = performance.now();
    let polls = 0;
    let lastState = null;
    while (performance.now() - startedAt <= timeoutMs) {
      lastState = audio ? mediaState(audio, context) : null;
      polls += 1;
      if (predicate()) {
        return {
          elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
          polls,
          state: lastState
        };
      }
      if (rejectOnMediaError && audio && audio.error) {
        const details = mediaErrorDetails(audio);
        const hint =
          details && details.code_name === "MEDIA_ERR_SRC_NOT_SUPPORTED"
            ? "decode_or_media_support"
            : "media_error";
        const error = new Error(label + " failed with " + hint + ": " + JSON.stringify(details));
        error.category = hint;
        error.media_error = details;
        throw error;
      }
      await sleep(options.pollMs);
    }
    throw new Error(label + " timed out after " + timeoutMs + " ms; last_state=" + JSON.stringify(lastState));
  };

  const waitForProgress = async (audio, context, baselineTime, label, timeoutMs = options.progressTimeoutMs) =>
    waitFor({
      label,
      timeoutMs,
      audio,
      context,
      predicate: () =>
        audio.paused === false &&
        audio.ended === false &&
        audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Number.isFinite(audio.currentTime) &&
        audio.currentTime > baselineTime + 0.02
    });

  const buildGraph = async (audio) => {
    if (!options.useWebAudio) {
      return {
        context: null,
        graph: null,
        details: {
          enabled: false,
          reason: "--no-webaudio"
        }
      };
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") {
      throw new Error("AudioContext is not available in this Electron renderer");
    }

    const context = new AudioContextCtor({ latencyHint: "interactive" });
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    gain.gain.value = 0.78;

    const filters = [];
    let previous = source;
    for (let index = 0; index < frequencies.length; index += 1) {
      const filter = context.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequencies[index];
      filter.Q.value = 1.1;
      filter.gain.value = index % 2 === 0 ? 2.5 : -1.5;
      previous.connect(filter);
      previous = filter;
      filters.push(filter);
    }

    const compressor = options.useCompressor ? context.createDynamicsCompressor() : null;
    if (compressor) {
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.08;
    }

    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    if (compressor) {
      previous.connect(compressor).connect(gain).connect(analyser).connect(context.destination);
    } else {
      previous.connect(gain).connect(analyser).connect(context.destination);
    }
    await context.resume();

    return {
      context,
      graph: { source, gain, filters, compressor, analyser },
      details: {
        enabled: true,
        filter_count: filters.length,
        compressor_enabled: Boolean(compressor),
        base_latency_seconds: typeof context.baseLatency === "number" ? context.baseLatency : null,
        output_latency_seconds: typeof context.outputLatency === "number" ? context.outputLatency : null
      }
    };
  };

  const resetMedia = async (audio) => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    await sleep(Math.min(options.settleMs, 100));
  };

  const startTrackAndWait = async ({ audio, context, url, operation, trial = null }) => {
    await resetMedia(audio);
    if (options.settleMs > 0) {
      await sleep(options.settleMs);
    }
    const startedAt = performance.now();
    audio.src = url;
    audio.load();
    if (context && context.state !== "running") {
      await context.resume();
    }
    const playStartedAt = performance.now();
    await audio.play();
    const playPromiseMs = performance.now() - playStartedAt;
    const progress = await waitForProgress(audio, context, 0, operation + " trial " + (trial || 1));
    return {
      trial,
      operation,
      play_promise_ms: Number(playPromiseMs.toFixed(3)),
      time_to_progress_ms: Number((performance.now() - startedAt).toFixed(3)),
      progress_wait_ms: progress.elapsed_ms,
      polls: progress.polls,
      state_at_success: progress.state
    };
  };

  const measurePausePlayResume = async ({ audio, context, trial }) => {
    audio.pause();
    await sleep(options.settleMs);
    const before = mediaState(audio, context);
    const baselineTime = audio.currentTime || 0;
    const startedAt = performance.now();
    if (context && context.state !== "running") {
      await context.resume();
    }
    await audio.play();
    const progress = await waitForProgress(audio, context, baselineTime, "play resume trial " + trial);
    return {
      trial,
      operation: "play_resume_to_progress",
      time_to_progress_ms: Number((performance.now() - startedAt).toFixed(3)),
      progress_wait_ms: progress.elapsed_ms,
      polls: progress.polls,
      state_before_play: before,
      state_at_success: progress.state
    };
  };

  const measureSeek = async ({ audio, context, trial, fraction, duration }) => {
    const targetSecs = Math.max(0.5, Math.min(duration - 1, duration * fraction));
    const startedAt = performance.now();
    audio.currentTime = targetSecs;
    const convergence = await waitFor({
      label: "seek " + targetSecs.toFixed(3) + "s convergence",
      timeoutMs: options.seekTimeoutMs,
      audio,
      context,
      predicate: () =>
        audio.paused === false &&
        audio.ended === false &&
        audio.seeking === false &&
        Number.isFinite(audio.currentTime) &&
        Math.abs(audio.currentTime - targetSecs) < 0.75
    });
    const progress = await waitForProgress(
      audio,
      context,
      audio.currentTime,
      "seek " + fraction + " progress trial " + trial,
      options.seekTimeoutMs
    );
    return {
      trial,
      operation: "seek_convergence",
      fraction,
      target_secs: Number(targetSecs.toFixed(3)),
      convergence_ms: convergence.elapsed_ms,
      operation_elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      progress_after_convergence_ms: progress.elapsed_ms,
      polls: convergence.polls + progress.polls,
      state_at_convergence: convergence.state,
      state_at_progress: progress.state
    };
  };

  const playForPreroll = async ({ audio, context, prerollMs, label }) => {
    const startedAt = performance.now();
    let lastTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    let advancedSamples = 0;

    while (performance.now() - startedAt < prerollMs) {
      await sleep(options.pollMs);
      const state = mediaState(audio, context);
      if (state.paused || state.ended || state.ready_state < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error(label + " stalled during preroll: " + JSON.stringify(state));
      }
      if (typeof state.current_time === "number" && state.current_time > lastTime + 0.005) {
        lastTime = state.current_time;
        advancedSamples += 1;
      }
    }

    if (advancedSamples === 0) {
      throw new Error(label + " did not advance during preroll");
    }
    return lastTime;
  };

  const measureInWindowBackwardSeek = async ({ audio, context, trial, duration }) => {
    const baseSecs = Math.max(0.5, Math.min(duration - 1, duration * 0.5));
    audio.currentTime = baseSecs;
    await waitFor({
      label: "in-window base seek " + baseSecs.toFixed(3) + "s convergence trial " + trial,
      timeoutMs: options.seekTimeoutMs,
      audio,
      context,
      predicate: () =>
        audio.paused === false &&
        audio.ended === false &&
        audio.seeking === false &&
        Number.isFinite(audio.currentTime) &&
        Math.abs(audio.currentTime - baseSecs) < 0.75
    });
    await waitForProgress(
      audio,
      context,
      audio.currentTime,
      "in-window preroll start trial " + trial,
      options.seekTimeoutMs
    );
    const playheadSecs = await playForPreroll({
      audio,
      context,
      prerollMs: options.inWindowPrerollMs,
      label: "in-window preroll trial " + trial
    });

    const targetSecs = Math.max(0.5, Math.min(duration - 1, playheadSecs - options.inWindowBackSecs));
    const startedAt = performance.now();
    audio.currentTime = targetSecs;
    const convergence = await waitFor({
      label: "in-window backward seek " + targetSecs.toFixed(3) + "s convergence trial " + trial,
      timeoutMs: options.seekTimeoutMs,
      audio,
      context,
      predicate: () =>
        audio.paused === false &&
        audio.ended === false &&
        audio.seeking === false &&
        Number.isFinite(audio.currentTime) &&
        Math.abs(audio.currentTime - targetSecs) < 0.75
    });
    const progress = await waitForProgress(
      audio,
      context,
      audio.currentTime,
      "in-window backward seek progress trial " + trial,
      options.seekTimeoutMs
    );

    return {
      trial,
      operation: "in_window_backward_seek",
      back_secs: Number(options.inWindowBackSecs.toFixed(3)),
      playhead_before_seek_secs: Number(playheadSecs.toFixed(3)),
      target_secs: Number(targetSecs.toFixed(3)),
      convergence_ms: convergence.elapsed_ms,
      operation_elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      progress_after_convergence_ms: progress.elapsed_ms,
      polls: convergence.polls + progress.polls,
      state_at_convergence: convergence.state,
      state_at_progress: progress.state
    };
  };

  const measureNextTrack = async ({ audio, context }) => {
    if (!options.nextTrackUrl) return null;
    const startedAt = performance.now();
    audio.pause();
    await sleep(options.settleMs);
    audio.src = options.nextTrackUrl;
    audio.load();
    if (context && context.state !== "running") {
      await context.resume();
    }
    const playStartedAt = performance.now();
    await audio.play();
    const playPromiseMs = performance.now() - playStartedAt;
    const progress = await waitForProgress(audio, context, 0, "next track to progress");
    return {
      operation: "next_track_to_progress",
      play_promise_ms: Number(playPromiseMs.toFixed(3)),
      switch_to_progress_ms: Number((performance.now() - startedAt).toFixed(3)),
      progress_wait_ms: progress.elapsed_ms,
      polls: progress.polls,
      state_at_success: progress.state
    };
  };

  const measureControlUpdates = async ({ context, graph }) => {
    if (!context || !graph) {
      return {
        enabled: false,
        reason: "WebAudio graph disabled",
        samples: [],
        latency_ms: summarize([])
      };
    }

    const samples = [];
    for (let index = 0; index < options.controlToggles; index += 1) {
      const filter = graph.filters[index % graph.filters.length];
      const startedAt = performance.now();
      const now = context.currentTime;
      filter.gain.setTargetAtTime(index % 2 === 0 ? 3 : -2, now, 0.005);
      graph.gain.gain.setTargetAtTime(index % 2 === 0 ? 0.68 : 0.74, now, 0.005);
      if (graph.compressor) {
        graph.compressor.threshold.setTargetAtTime(index % 2 === 0 ? -18 : -22, now, 0.01);
      }
      samples.push({
        index,
        latency_ms: Number((performance.now() - startedAt).toFixed(6))
      });
      await sleep(16);
    }

    return {
      enabled: true,
      samples,
      latency_ms: summarize(samples.map((sample) => sample.latency_ms))
    };
  };

  const collectStabilitySamples = async ({ audio, context }) => {
    const samples = [];
    const startedAt = performance.now();
    let previousTime = audio.currentTime || 0;
    let monotonicResets = 0;
    let loopSeekCount = 0;

    while (performance.now() - startedAt < options.stabilitySeconds * 1000) {
      await sleep(250);
      const currentState = mediaState(audio, context);
      const currentTime = currentState.current_time;
      const duration = currentState.duration;
      if (typeof currentTime === "number" && typeof previousTime === "number" && currentTime + 0.25 < previousTime) {
        monotonicResets += 1;
      }
      if (
        options.loopDuringStability &&
        typeof currentTime === "number" &&
        typeof duration === "number" &&
        duration > 10 &&
        currentTime > Math.max(5, duration - 3)
      ) {
        audio.currentTime = 0.5;
        loopSeekCount += 1;
      }
      samples.push({
        at_ms: Number((performance.now() - startedAt).toFixed(3)),
        ...currentState,
        current_time_delta: Number((currentTime - previousTime).toFixed(6))
      });
      previousTime = currentTime;
    }

    return {
      samples,
      summary: {
        sample_count: samples.length,
        paused_samples: samples.filter((sample) => sample.paused === true).length,
        ended_samples: samples.filter((sample) => sample.ended === true).length,
        low_ready_state_samples: samples.filter((sample) => sample.ready_state < HTMLMediaElement.HAVE_CURRENT_DATA).length,
        media_error_samples: samples.filter((sample) => sample.media_error !== null).length,
        current_time_monotonic_resets: monotonicResets,
        loop_seek_count: loopSeekCount,
        current_time_delta_ms: summarize(samples.map((sample) => sample.current_time_delta * 1000))
      }
    };
  };

  const summarizeOperations = (measurements) => {
    const byOperation = {};
    for (const operation of [...new Set(measurements.map((measurement) => measurement.operation))]) {
      const rows = measurements.filter((measurement) => measurement.operation === operation);
      byOperation[operation] = {
        count: rows.length,
        time_to_progress_ms: summarize(rows.map((row) => row.time_to_progress_ms)),
        convergence_ms: summarize(rows.map((row) => row.convergence_ms)),
        switch_to_progress_ms: summarize(rows.map((row) => row.switch_to_progress_ms)),
        progress_after_convergence_ms: summarize(rows.map((row) => row.progress_after_convergence_ms)),
        play_promise_ms: summarize(rows.map((row) => row.play_promise_ms))
      };
    }
    return byOperation;
  };

  const run = async () => {
    if (typeof HTMLAudioElement !== "function") {
      throw new Error("HTMLAudioElement is not available in this Electron renderer");
    }

    const canPlayType = document.createElement("audio").canPlayType(options.trackMime || "");
    const nextCanPlayType = options.nextTrackMime
      ? document.createElement("audio").canPlayType(options.nextTrackMime)
      : "";
    const audio = new Audio();
    audio.preload = "auto";
    audio.controls = false;
    audio.volume = 0.78;
    document.body.appendChild(audio);

    const graphSetup = await buildGraph(audio);
    const context = graphSetup.context;
    const graph = graphSetup.graph;

    const measurements = [];
    let trackDuration = null;
    for (let trial = 1; trial <= options.trials; trial += 1) {
      measurements.push(
        await startTrackAndWait({
          audio,
          context,
          url: options.trackUrl,
          operation: "load_to_progress",
          trial
        })
      );
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (!Number.isFinite(duration) || duration <= 2) {
        throw new Error("Track duration is too short or unknown for seek benchmark: " + duration);
      }
      trackDuration = duration;
      measurements.push(await measurePausePlayResume({ audio, context, trial }));
      for (const fraction of options.seekFractions) {
        measurements.push(await measureSeek({ audio, context, trial, fraction, duration }));
      }
    }

    if (options.inWindowSeek) {
      await startTrackAndWait({
        audio,
        context,
        url: options.trackUrl,
        operation: "in_window_warmup"
      });
      const duration = Number.isFinite(audio.duration) ? audio.duration : trackDuration || 0;
      if (!Number.isFinite(duration) || duration <= 2) {
        throw new Error("Track duration is too short or unknown for in-window seek benchmark: " + duration);
      }
      for (let trial = 1; trial <= options.inWindowTrials; trial += 1) {
        measurements.push(await measureInWindowBackwardSeek({ audio, context, trial, duration }));
      }
    }

    const nextTrackMeasurement = await measureNextTrack({ audio, context });
    if (nextTrackMeasurement) {
      measurements.push(nextTrackMeasurement);
    }

    const controlUpdates = await measureControlUpdates({ context, graph });
    const stability = await collectStabilitySamples({ audio, context });
    const finalState = mediaState(audio, context);
    audio.pause();
    await resetMedia(audio);
    if (context) {
      await context.close();
    }

    const stabilityPass =
      stability.summary.paused_samples === 0 &&
      stability.summary.ended_samples === 0 &&
      stability.summary.low_ready_state_samples === 0 &&
      stability.summary.media_error_samples === 0;

    return {
      baseline: "electron-real-file-playback",
      parameters: {
        track_path: options.trackPath,
        next_track_path: options.nextTrackPath || null,
        trials: options.trials,
        control_toggles: options.controlToggles,
        stability_seconds: options.stabilitySeconds,
        progress_timeout_ms: options.progressTimeoutMs,
        seek_timeout_ms: options.seekTimeoutMs,
        poll_ms: options.pollMs,
        settle_ms: options.settleMs,
        seek_fractions: options.seekFractions,
        in_window_seek: options.inWindowSeek,
        in_window_preroll_ms: options.inWindowPrerollMs,
        in_window_back_secs: options.inWindowBackSecs,
        in_window_trials: options.inWindowTrials,
        use_webaudio: options.useWebAudio,
        use_compressor: options.useCompressor,
        loop_during_stability: options.loopDuringStability
      },
      media_support: {
        track_mime: options.trackMime || null,
        track_can_play_type: canPlayType || "",
        next_track_mime: options.nextTrackMime || null,
        next_track_can_play_type: nextCanPlayType || ""
      },
      audio_graph: graphSetup.details,
      measurements,
      next_track_measurement: nextTrackMeasurement,
      control_updates: controlUpdates,
      stability,
      final_state: finalState,
      summary: {
        pass: stabilityPass,
        operations: summarizeOperations(measurements),
        stability: stability.summary,
        control_update_latency_ms: controlUpdates.latency_ms
      },
      feature_matrix: {
        html_media_element_playback: true,
        real_local_file_decode: true,
        media_element_source_node: Boolean(context && graph),
        webaudio_filter_controls: Boolean(context && graph),
        analyser_visualizer_tap: Boolean(context && graph),
        dynamics_compressor_node: Boolean(context && graph && graph.compressor),
        output_device_selection: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype,
        exclusive_output_mode: false,
        explicit_output_bit_depth: false,
        native_callback_budget: false,
        lock_free_native_dsp_params: false,
        soxr_resampling: false,
        native_loudness_true_peak_pipeline: false,
        dither_noise_shaping_policy: false
      },
      limitations: [
        "This is a plain hidden Electron HTMLMediaElement/WebAudio fixture, not a tuned production Electron player.",
        "Playback progress uses HTMLMediaElement.currentTime as a proxy; it does not capture analog or loopback output.",
        "Codec support is Chromium/Electron dependent. MEDIA_ERR_SRC_NOT_SUPPORTED is recorded as a baseline limitation, not hidden.",
        "Worker CPU/RSS samples cover the Electron main process only; the Node supervisor also records a coarse Electron process-tree aggregate.",
        "WebAudio parameter timing measures JavaScript control-call latency, not native callback delivery latency."
      ]
    };
  };

  return run();
})()
`;

const createHiddenWindow = () =>
  new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

const run = async () => {
  const options = parseArgs(process.argv.slice(2));
  const userDataDir = options.userDataDir || null;
  const runId = process.env[runIdEnvName] || null;
  const diagnostics = {
    stages: [],
    page_load_attempts: []
  };

  app.disableHardwareAcceleration();
  if (userDataDir) {
    app.setPath("userData", userDataDir);
  }
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-gpu");
  app.on("window-all-closed", (event) => {
    event.preventDefault();
  });

  await ensureAudioFile(options.track, "track");
  if (options.nextTrack) {
    await ensureAudioFile(options.nextTrack, "next-track");
  }

  await runStage(diagnostics, "app_ready", () => withTimeout(app.whenReady(), 15000, "Electron app readiness"));

  let monitor = null;
  const window = await runStage(diagnostics, "window_created", () => Promise.resolve(createHiddenWindow()));
  window.webContents.on("console-message", (_event, _level, message) => {
    console.log(message);
  });

  let report = null;
  try {
    const page = await runStage(diagnostics, "page_loaded", () => loadFixturePage(window, options, diagnostics));
    const rendererProbe = await runStage(diagnostics, "renderer_probe", () =>
      withTimeout(window.webContents.executeJavaScript(rendererProbeSource, true), 5000, "Electron renderer probe")
    );
    if (!rendererProbe || rendererProbe.ok !== true) {
      throw new Error("Electron renderer probe returned an invalid result");
    }

    monitor = createProcessMonitor(process.pid, options.sampleMs);
    monitor.start();

    const rendererOptions = {
      ...options,
      trackPath: options.track,
      nextTrackPath: options.nextTrack || "",
      trackUrl: pathToFileURL(options.track).toString(),
      nextTrackUrl: options.nextTrack ? pathToFileURL(options.nextTrack).toString() : "",
      trackMime: mimeForPath(options.track),
      nextTrackMime: options.nextTrack ? mimeForPath(options.nextTrack) : ""
    };
    const rendererTimeoutMs = Math.max(
      30000,
      Math.round(
        (options.stabilitySeconds +
          options.trials * (options.seekFractions.length + 2) +
          (options.inWindowSeek
            ? options.inWindowTrials * (options.inWindowPrerollMs / 1000 + 2)
            : 0)) *
          6000
      )
    );
    const rendererResult = await runStage(diagnostics, "real_file_harness", () =>
      withTimeout(
        window.webContents.executeJavaScript(rendererHarnessSource(rendererOptions), true),
        rendererTimeoutMs,
        "Electron real-file renderer harness"
      )
    );

    const processSamples = monitor ? await monitor.stop() : [];
    report = {
      ...rendererResult,
      generated_at: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        v8: process.versions.v8,
        user_data_dir: userDataDir,
        page_mode: page.mode,
        fixture_path: page.fixture_path,
        renderer_probe: rendererProbe,
        run_id: runId
      },
      diagnostics,
      process_metrics: {
        summary: summarizeProcessSamples(processSamples),
        samples: processSamples
      }
    };
  } catch (error) {
    const processSamples = monitor ? await monitor.stop() : [];
    report = {
      baseline: "electron-real-file-playback",
      generated_at: new Date().toISOString(),
      summary: { pass: false },
      error: toErrorMessage(error),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        v8: process.versions.v8,
        user_data_dir: userDataDir,
        run_id: runId
      },
      diagnostics,
      process_metrics: {
        summary: summarizeProcessSamples(processSamples),
        samples: processSamples
      },
      limitations: [
        "A failed real-file Electron baseline is still evidence when Chromium cannot decode or start playback for the supplied file."
      ]
    };
  } finally {
    window.destroy();
  }

  report.summary = {
    ...(report.summary || {}),
    pass: report.summary && report.summary.pass === true && !report.error,
    load_to_progress_ms:
      report.summary && report.summary.operations ? report.summary.operations.load_to_progress?.time_to_progress_ms : null,
    play_resume_to_progress_ms:
      report.summary && report.summary.operations
        ? report.summary.operations.play_resume_to_progress?.time_to_progress_ms
        : null,
    seek_convergence_ms:
      report.summary && report.summary.operations ? report.summary.operations.seek_convergence?.convergence_ms : null,
    in_window_backward_seek_ms:
      report.summary && report.summary.operations ? report.summary.operations.in_window_backward_seek?.convergence_ms : null,
    next_track_to_progress_ms:
      report.summary && report.summary.operations ? report.summary.operations.next_track_to_progress?.switch_to_progress_ms : null,
    control_update_latency_ms: report.control_updates ? report.control_updates.latency_ms : null,
    stability: report.stability ? report.stability.summary : report.summary ? report.summary.stability : null
  };

  const outputPath = await writeJsonReport(options.outputDir, outputFileName, report);
  console.log(`[electron-real-file] wrote ${path.relative(appRoot, outputPath)}`);
  console.log(`[electron-real-file] pass=${report.summary.pass}`);
  if (report.summary.operations) {
    for (const [operation, summary] of Object.entries(report.summary.operations)) {
      const metric =
        summary.time_to_progress_ms.count > 0
          ? summary.time_to_progress_ms
          : summary.convergence_ms.count > 0
            ? summary.convergence_ms
            : summary.switch_to_progress_ms;
      console.log(
        `[electron-real-file] ${operation} count=${summary.count} p50=${metric.p50}ms p95=${metric.p95}ms max=${metric.max}ms`
      );
    }
  }
  if (report.control_updates && report.control_updates.latency_ms) {
    console.log(`[electron-real-file] control p95=${report.control_updates.latency_ms.p95}ms`);
  }
  if (report.process_metrics && report.process_metrics.summary) {
    const metrics = report.process_metrics.summary;
    console.log(
      `[electron-real-file] peak_working_set=${metrics.peak_working_set_bytes || 0}B peak_cpu=${metrics.peak_cpu_percent || 0}%`
    );
  }
  if (report.error) {
    console.error(`[electron-real-file] ${report.error}`);
  }
  if (!report.summary.pass) {
    app.exit(1);
  }
};

if (process.env[workerEnvName] === "1") {
  run()
    .then(() => app.quit())
    .catch((error) => {
      console.error("[electron-real-file] failed", error);
      app.exit(1);
    });
} else {
  runSupervisor().catch((error) => {
    console.error("[electron-real-file] supervisor failed", error);
    process.exitCode = 1;
  });
}
