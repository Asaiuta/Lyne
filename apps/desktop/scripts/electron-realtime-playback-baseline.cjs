"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const {
  appRoot,
  sleep,
  toAppPath,
  positiveInteger,
  positiveNumber,
  summarizeNumeric,
  createProcessMonitor,
  summarizeProcessSamples,
  writeJsonReport
} = require("./perf-utils.cjs");

const defaultOutDir = path.join(appRoot, "output", "electron-realtime-playback-baseline");
const outputFileName = "realtime-playback-baseline.json";
const workerEnvName = "LYNE_ELECTRON_REALTIME_WORKER";
const runIdEnvName = "LYNE_ELECTRON_REALTIME_RUN_ID";

const parseArgs = (argv) => {
  const options = {
    outputDir: defaultOutDir,
    userDataDir: "",
    sampleRate: 48000,
    channels: 2,
    durationSeconds: 2,
    trials: 10,
    controlToggles: 120,
    stabilitySeconds: 30,
    sampleMs: 500,
    contextAdvanceTimeoutMs: 1500,
    waitForContextAdvance: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
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
      case "--output-dir":
      case "--out":
        if (!next) throw new Error(`${arg} requires a value`);
        index += 1;
        options.outputDir = toAppPath(next);
        break;
      case "--sample-rate":
        options.sampleRate = Math.round(readNumber(arg));
        break;
      case "--channels":
        options.channels = Math.round(readNumber(arg));
        break;
      case "--duration":
        options.durationSeconds = readNumber(arg);
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
      case "--context-advance-timeout-ms":
        options.contextAdvanceTimeoutMs = readInteger(arg);
        break;
      case "--no-context-advance-wait":
        options.waitForContextAdvance = false;
        break;
      case "--user-data-dir":
        if (!next) throw new Error("--user-data-dir requires a value");
        index += 1;
        options.userDataDir = toAppPath(next);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/electron-realtime-playback-baseline.cjs [options]

Measures a plain Electron/WebAudio real-time playback baseline in a hidden
BrowserWindow. This complements electron-webaudio-baseline.cjs, which uses
OfflineAudioContext and does not measure wall-clock playback/control behavior.
The Node entrypoint supervises an Electron worker so Chromium process exits can
still be captured as structured JSON.

Options:
  --duration <seconds>          Generated buffer duration (default: 2)
  --trials <n>                  Start/stop graph rebuild trials (default: 10)
  --control-toggles <n>         Parameter update count during active playback (default: 120)
  --stability-seconds <seconds> Wall-clock playback observation duration (default: 30)
  --sample-rate <hz>            Fixture sample rate (default: 48000)
  --channels <n>                Fixture channels (default: 2)
  --sample-ms <ms>              Main-process CPU/RSS sample interval (default: 500)
  --context-advance-timeout-ms <ms> Wait for AudioContext time advance (default: 1500)
  --no-context-advance-wait     Do not wait for AudioContext time to advance
  --user-data-dir <dir>         Isolated Electron user data dir
  --out <dir>                   Output directory relative to apps/desktop unless absolute
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

const loadFixturePage = async (window, diagnostics) => {
  const fixtureHtml = "<!doctype html><title>Electron realtime playback baseline</title>";
  const attempts = [
    { mode: "data_url", url: `data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml)}` }
  ];
  const failures = [];

  diagnostics.page_load_attempts = [];
  for (const attempt of attempts) {
    const startedAt = performance.now();
    try {
      if (typeof attempt.load === "function") {
        await attempt.load();
      } else {
        await withTimeout(window.loadURL(attempt.url), 15000, `Electron fixture page load (${attempt.mode})`);
      }
      diagnostics.page_load_attempts.push({
        mode: attempt.mode,
        status: "passed",
        elapsed_ms: Number((performance.now() - startedAt).toFixed(3))
      });
      return attempt.mode;
    } catch (error) {
      const message = toErrorMessage(error);
      failures.push(`${attempt.mode}: ${message}`);
      diagnostics.page_load_attempts.push({
        mode: attempt.mode,
        status: "failed",
        elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
        error: message
      });
    }
  }

  throw new Error(`Electron fixture page load failed (${failures.join("; ")})`);
};

const rendererProbeSource = `(() => ({
  ok: 1 + 1 === 2,
  href: window.location.href,
  has_audio_context: typeof (window.AudioContext || window.webkitAudioContext) === "function",
  user_agent: navigator.userAgent
}))()`;

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
    return;
  }

  const existingReportFromThisRun = report && report.environment && report.environment.run_id === runId;
  const summary = {
    pass: false,
    worker_exit_code: exit.code,
    worker_signal: exit.signal || null
  };
  const supervisorReport = {
    baseline: "electron-realtime-webaudio-playback",
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
    worker_report: existingReportFromThisRun ? report : null
  };
  const writtenPath = await writeJsonReport(options.outputDir, outputFileName, supervisorReport);
  console.error(`[electron-realtime] supervisor wrote failed report ${path.relative(appRoot, writtenPath)}`);
  process.exitCode = exit.code || 1;
};

const rendererHarnessSource = (options) => `
(() => {
  const options = ${JSON.stringify(options)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const makeInputBuffer = (context) => {
    const frames = Math.round(options.durationSeconds * options.sampleRate);
    const buffer = context.createBuffer(options.channels, frames, options.sampleRate);
    for (let channel = 0; channel < options.channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      const phaseOffset = channel * 0.17;
      for (let frame = 0; frame < frames; frame += 1) {
        const t = frame / options.sampleRate;
        data[frame] =
          0.18 * Math.sin(2 * Math.PI * 220 * t + phaseOffset) +
          0.12 * Math.sin(2 * Math.PI * 997 * t) +
          0.05 * Math.sin(2 * Math.PI * 5321 * t);
      }
    }
    return buffer;
  };

  const buildGraph = (context, buffer) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = context.createGain();
    gain.gain.value = 0.7;

    const filters = [];
    const frequencies = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
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

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.08;

    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    previous.connect(compressor).connect(gain).connect(analyser).connect(context.destination);

    return { source, gain, filters, compressor, analyser };
  };

  const waitForContextTimeAdvance = async (context, previousTime, timeoutMs) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt <= timeoutMs) {
      if (context.currentTime > previousTime + 0.02) {
        return performance.now() - startedAt;
      }
      await sleep(8);
    }
    throw new Error("AudioContext currentTime did not advance");
  };

  const run = async () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") {
      throw new Error("AudioContext is not available in this Electron renderer");
    }

    const context = new AudioContextCtor({
      sampleRate: options.sampleRate,
      latencyHint: "interactive"
    });
    await context.resume();
    const baseLatency = typeof context.baseLatency === "number" ? context.baseLatency : null;
    const outputLatency = typeof context.outputLatency === "number" ? context.outputLatency : null;
    const buffer = makeInputBuffer(context);

    const startTrials = [];
    for (let trial = 1; trial <= options.trials; trial += 1) {
      const before = context.currentTime;
      const graph = buildGraph(context, buffer);
      const startedAt = performance.now();
      graph.source.start();
      const timeAdvanceMs = options.waitForContextAdvance
        ? await waitForContextTimeAdvance(context, before, options.contextAdvanceTimeoutMs)
        : null;
      const startCallToAdvanceMs = performance.now() - startedAt;
      graph.source.stop();
      graph.source.disconnect();
      await sleep(25);
      startTrials.push({
        trial,
        time_advance_ms: timeAdvanceMs === null ? null : Number(timeAdvanceMs.toFixed(3)),
        start_call_to_advance_ms: Number(startCallToAdvanceMs.toFixed(3))
      });
    }

    const activeGraph = buildGraph(context, buffer);
    activeGraph.source.start();
    if (options.waitForContextAdvance) {
      await waitForContextTimeAdvance(context, context.currentTime, options.contextAdvanceTimeoutMs);
    } else {
      await sleep(50);
    }

    const controlLatencies = [];
    for (let index = 0; index < options.controlToggles; index += 1) {
      const filter = activeGraph.filters[index % activeGraph.filters.length];
      const startedAt = performance.now();
      filter.gain.setTargetAtTime(index % 2 === 0 ? 3 : -2, context.currentTime, 0.005);
      activeGraph.gain.gain.setTargetAtTime(index % 2 === 0 ? 0.68 : 0.74, context.currentTime, 0.005);
      controlLatencies.push(performance.now() - startedAt);
      await sleep(16);
    }

    const stabilitySamples = [];
    const stabilityStartedAt = performance.now();
    let previousContextTime = context.currentTime;
    while (performance.now() - stabilityStartedAt < options.stabilitySeconds * 1000) {
      await sleep(250);
      const currentTime = context.currentTime;
      stabilitySamples.push({
        at_ms: Number((performance.now() - stabilityStartedAt).toFixed(3)),
        context_time: Number(currentTime.toFixed(6)),
        context_time_delta: Number((currentTime - previousContextTime).toFixed(6)),
        state: context.state
      });
      previousContextTime = currentTime;
    }

    activeGraph.source.stop();
    activeGraph.source.disconnect();
    await context.close();

    return {
      baseline: "electron-realtime-webaudio-playback",
      parameters: {
        sample_rate: options.sampleRate,
        channels: options.channels,
        duration_seconds: options.durationSeconds,
        trials: options.trials,
        control_toggles: options.controlToggles,
        stability_seconds: options.stabilitySeconds,
        wait_for_context_advance: options.waitForContextAdvance,
        context_advance_timeout_ms: options.contextAdvanceTimeoutMs
      },
      audio_context: {
        base_latency_seconds: baseLatency,
        output_latency_seconds: outputLatency,
        state_after_close: context.state
      },
      start_trials: {
        samples: startTrials,
        time_advance_ms: summarize(startTrials.map((trial) => trial.time_advance_ms)),
        start_call_to_advance_ms: summarize(startTrials.map((trial) => trial.start_call_to_advance_ms))
      },
      control_updates: {
        samples: controlLatencies.map((latency, index) => ({
          index,
          latency_ms: Number(latency.toFixed(6))
        })),
        latency_ms: summarize(controlLatencies)
      },
      stability: {
        samples: stabilitySamples,
        suspended_samples: stabilitySamples.filter((sample) => sample.state !== "running").length,
        context_time_delta_ms: summarize(stabilitySamples.map((sample) => sample.context_time_delta * 1000))
      },
      feature_matrix: {
        realtime_audio_context: true,
        output_device_selection: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype,
        exclusive_output_mode: false,
        explicit_output_bit_depth: false,
        native_callback_budget: false,
        lock_free_native_dsp_params: false,
        soxr_resampling: false,
        webaudio_filter_controls: true,
        analyser_visualizer_tap: true,
        dynamics_compressor_node: true,
        native_loudness_true_peak_pipeline: false,
        dither_noise_shaping_policy: false
      },
      limitations: [
        "This is a plain hidden Electron/WebAudio fixture, not a tuned production Electron player.",
        "AudioContext currentTime advancement is a playback-start proxy, not microphone-loopback output capture.",
        "When --no-context-advance-wait is used, start metrics measure graph start call behavior rather than confirmed real-time advancement.",
        "WebAudio exposes coarse output latency and browser-mediated device behavior; it does not provide WASAPI exclusive or explicit bit-depth control."
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
  await runStage(diagnostics, "app_ready", () => withTimeout(app.whenReady(), 15000, "Electron app readiness"));

  let monitor = null;
  const window = await runStage(diagnostics, "window_created", () => Promise.resolve(createHiddenWindow()));
  window.webContents.on("console-message", (_event, _level, message) => {
    console.log(message);
  });

  let report = null;
  try {
    const pageMode = await runStage(diagnostics, "page_loaded", () => loadFixturePage(window, diagnostics));
    const rendererProbe = await runStage(diagnostics, "renderer_probe", () =>
      withTimeout(window.webContents.executeJavaScript(rendererProbeSource, true), 5000, "Electron renderer probe")
    );
    if (!rendererProbe || rendererProbe.ok !== true) {
      throw new Error("Electron renderer probe returned an invalid result");
    }
    monitor = createProcessMonitor(process.pid, options.sampleMs);
    monitor.start();

    const rendererTimeoutMs = Math.max(30000, Math.round((options.stabilitySeconds + options.trials * 0.2) * 4000));
    const rendererResult = await runStage(diagnostics, "realtime_harness", () =>
      withTimeout(
        window.webContents.executeJavaScript(rendererHarnessSource(options), true),
        rendererTimeoutMs,
        "Electron realtime renderer harness"
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
        page_mode: pageMode,
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
      baseline: "electron-realtime-webaudio-playback",
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
      }
    };
  } finally {
    window.destroy();
  }

  report.summary = {
    ...(report.summary || {}),
    pass: !report.error,
    start_time_advance_ms: report.start_trials ? report.start_trials.time_advance_ms : null,
    control_update_latency_ms: report.control_updates ? report.control_updates.latency_ms : null,
    suspended_samples: report.stability ? report.stability.suspended_samples : null
  };

  const outputPath = await writeJsonReport(options.outputDir, outputFileName, report);
  console.log(`[electron-realtime] wrote ${path.relative(appRoot, outputPath)}`);
  if (report.start_trials) {
    console.log(
      `[electron-realtime] start p50=${report.start_trials.time_advance_ms.p50}ms p95=${report.start_trials.time_advance_ms.p95}ms control p95=${report.control_updates.latency_ms.p95}ms`
    );
  }
  if (report.process_metrics && report.process_metrics.summary) {
    const metrics = report.process_metrics.summary;
    console.log(
      `[electron-realtime] peak_working_set=${metrics.peak_working_set_bytes || 0}B peak_cpu=${metrics.peak_cpu_percent || 0}%`
    );
  }
  if (report.error) {
    console.error(`[electron-realtime] ${report.error}`);
    app.exit(1);
    return;
  }
};

if (process.env[workerEnvName] === "1") {
  run()
    .then(() => app.quit())
    .catch((error) => {
      console.error("[electron-realtime] failed", error);
      app.exit(1);
    });
} else {
  runSupervisor().catch((error) => {
    console.error("[electron-realtime] supervisor failed", error);
    process.exitCode = 1;
  });
}
