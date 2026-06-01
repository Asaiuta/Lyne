#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { performance } = require("node:perf_hooks");
const {
  appRoot,
  repoRoot,
  sleep,
  toAppPath,
  positiveInteger,
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
} = require("./perf-utils.cjs");

const defaultOutDir = path.join(appRoot, "output", "lyne-evidence", "playback-stability");

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.LYNE_AUDIO_SERVER_URL || "",
    token: process.env.LYNE_AUDIO_API_TOKEN || process.env.AUDIO_API_TOKEN || `lyne-playback-stability-${Date.now()}`,
    track: process.env.LYNE_PROBE_TRACK || "",
    serverPath: path.join(repoRoot, "target", "release", "audio_server.exe"),
    outputDir: defaultOutDir,
    port: positiveInteger(process.env.LYNE_PLAYBACK_STABILITY_PORT || "63905", "LYNE_PLAYBACK_STABILITY_PORT"),
    timeoutMs: 5000,
    serverReadyMs: 30000,
    warmupMs: 1500,
    durationMs: 300000,
    sampleMs: 1000,
    progressTimeoutMs: 12000,
    pollMs: 100,
    enableDsp: true,
    loopTrack: true,
    keepServer: false
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

    switch (arg) {
      case "--base-url":
        if (!next) throw new Error("--base-url requires a value");
        index += 1;
        options.baseUrl = next;
        break;
      case "--token":
        if (!next) throw new Error("--token requires a value");
        index += 1;
        options.token = next;
        break;
      case "--track":
        options.track = readPath(arg);
        break;
      case "--server":
        options.serverPath = readPath(arg);
        break;
      case "--output-dir":
        if (!next) throw new Error("--output-dir requires a value");
        index += 1;
        options.outputDir = toAppPath(next);
        break;
      case "--port":
        options.port = readInteger(arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = readInteger(arg);
        break;
      case "--server-ready-ms":
        options.serverReadyMs = readInteger(arg);
        break;
      case "--warmup-ms":
        options.warmupMs = readInteger(arg);
        break;
      case "--duration-ms":
        options.durationMs = readInteger(arg);
        break;
      case "--minutes":
        options.durationMs = readInteger(arg) * 60 * 1000;
        break;
      case "--sample-ms":
        options.sampleMs = readInteger(arg);
        break;
      case "--progress-timeout-ms":
        options.progressTimeoutMs = readInteger(arg);
        break;
      case "--poll-ms":
        options.pollMs = readInteger(arg);
        break;
      case "--no-dsp":
        options.enableDsp = false;
        break;
      case "--no-loop":
        options.loopTrack = false;
        break;
      case "--keep-server":
        options.keepServer = true;
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
  options.baseUrl = normalizeBaseUrl(options.baseUrl || `http://127.0.0.1:${options.port}`);
  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/lyne-playback-stability-benchmark.cjs --track <audio-file> [options]

Runs a wall-clock playback stability benchmark with optional DSP enabled. It
polls /diagnostics/runtime and process CPU/RSS while playback is active.

Options:
  --track <path>          Local audio file to play
  --base-url <url>        Use an already-running server instead of starting one
  --token <token>         Bearer token if the server requires AUDIO_API_TOKEN
  --server <path>         audio_server.exe path
  --output-dir <dir>      Output directory relative to apps/desktop unless absolute
  --port <port>           Isolated server port (default: 63905)
  --duration-ms <ms>      Playback observation duration (default: 300000)
  --minutes <n>           Playback observation duration in minutes
  --sample-ms <ms>        Diagnostics/process sample interval (default: 1000)
  --no-dsp                Do not enable the DSP stress profile
  --no-loop               Do not seek back to start near track end
  --keep-server           Leave the isolated server running after the benchmark
`);
};

const waitForPlayback = async (options) =>
  pollUntil({
    label: "playback start",
    timeoutMs: options.progressTimeoutMs,
    intervalMs: options.pollMs,
    sample: () => readState(options),
    predicate: ({ state }) => state.is_playing === true && state.is_loading === false && state.current_time > 0.02
  });

const dspProfile = [
  {
    name: "iir_eq",
    route: "/set_eq",
    body: { enabled: true, bands: { "31": 1.5, "62": -0.5, "1000": -1.0, "4000": 1.25, "16000": 0.75 } }
  },
  {
    name: "crossfeed",
    route: "/set_crossfeed",
    body: { enabled: true, mix: 0.35 }
  },
  {
    name: "saturation",
    route: "/set_saturation",
    body: { enabled: true, drive: 0.42, mix: 0.27 }
  },
  {
    name: "dynamic_loudness",
    route: "/set_dynamic_loudness",
    body: { enabled: true, strength: 0.66 }
  },
  {
    name: "noise_shaping",
    route: "/configure_optimizations",
    body: { dither_enabled: true }
  },
  {
    name: "noise_shaper_curve",
    route: "/set_noise_shaper_curve",
    body: { curve: "FWeighted9" }
  },
  {
    name: "output_bits",
    route: "/configure_output_bits",
    body: { bits: 24 }
  },
  {
    name: "resampling",
    route: "/configure_resampling",
    body: { quality: "uhq", use_cache: true, preemptive_resample: true }
  },
  {
    name: "normalization",
    route: "/configure_normalization",
    body: { enabled: true, mode: "track", target_lufs: -14, preamp_db: -1.5 }
  }
];

const enableDspProfile = async (options) => {
  const steps = [];
  for (const step of dspProfile) {
    const response = await requestJson(options, "POST", step.route, step.body);
    const stateAfter = await readState(options);
    steps.push({
      name: step.name,
      route: step.route,
      request_latency_ms: Number(response.latencyMs.toFixed(3)),
      status: response.json && response.json.status ? response.json.status : null,
      state_sample: {
        eq_type: stateAfter.state.eq_type,
        crossfeed_enabled: stateAfter.state.crossfeed_enabled,
        saturation_enabled: stateAfter.state.saturation_enabled,
        dynamic_loudness_enabled: stateAfter.state.dynamic_loudness_enabled,
        dither_enabled: stateAfter.state.dither_enabled,
        output_bits: stateAfter.state.output_bits,
        noise_shaper_curve: stateAfter.state.noise_shaper_curve,
        resample_quality: stateAfter.state.resample_quality,
        loudness_enabled: stateAfter.state.loudness_enabled
      }
    });
  }
  return steps;
};

const collectDiagnosticsSamples = async (options, report) => {
  const samples = [];
  const startedAt = performance.now();
  let lastCurrentTime = null;
  let lastDuration = null;
  let seekBackCount = 0;

  while (performance.now() - startedAt < options.durationMs) {
    const sampleStartedAt = performance.now();
    const diagnostics = await readRuntimeDiagnostics(options);
    const playback = diagnostics.snapshot.playback || {};
    const websocket = diagnostics.snapshot.websocket || {};
    samples.push({
      at_ms: Number((performance.now() - startedAt).toFixed(3)),
      latency_ms: Number(diagnostics.latencyMs.toFixed(3)),
      playback: {
        is_playing: playback.is_playing,
        is_loading: playback.is_loading,
        current_time_secs: playback.current_time_secs,
        duration_secs: playback.duration_secs,
        underrun_count: playback.underrun_count,
        underrun_silence_frames: playback.underrun_silence_frames,
        load_error_count: playback.load_error_count,
        sample_rate: playback.sample_rate,
        channels: playback.channels
      },
      websocket: {
        spectrum_event_count: websocket.spectrum_event_count,
        position_event_count: websocket.position_event_count
      }
    });

    lastCurrentTime = playback.current_time_secs;
    lastDuration = playback.duration_secs;
    if (
      options.loopTrack &&
      typeof lastCurrentTime === "number" &&
      typeof lastDuration === "number" &&
      lastDuration > 10 &&
      lastCurrentTime > Math.max(5, lastDuration - 3)
    ) {
      await requestJson(options, "POST", "/seek", { position: 0.5 });
      seekBackCount += 1;
    }

    const elapsed = performance.now() - sampleStartedAt;
    await sleep(Math.max(0, options.sampleMs - elapsed));
  }

  report.stability.seek_back_count = seekBackCount;
  return samples;
};

const summarizeDiagnostics = (samples) => {
  if (samples.length === 0) {
    return {
      sample_count: 0,
      underrun_delta: null,
      underrun_silence_frames_delta: null,
      load_error_delta: null,
      playback_false_samples: 0,
      max_state_latency_ms: null,
      current_time_monotonic_resets: null
    };
  }
  const first = samples[0].playback;
  const last = samples[samples.length - 1].playback;
  let resets = 0;
  let previousTime = first.current_time_secs;
  for (const sample of samples.slice(1)) {
    const current = sample.playback.current_time_secs;
    if (typeof current === "number" && typeof previousTime === "number" && current + 0.25 < previousTime) {
      resets += 1;
    }
    previousTime = current;
  }
  return {
    sample_count: samples.length,
    diagnostics_latency_ms: summarizeNumeric(samples.map((sample) => sample.latency_ms)),
    underrun_delta:
      typeof first.underrun_count === "number" && typeof last.underrun_count === "number"
        ? last.underrun_count - first.underrun_count
        : null,
    underrun_silence_frames_delta:
      typeof first.underrun_silence_frames === "number" && typeof last.underrun_silence_frames === "number"
        ? last.underrun_silence_frames - first.underrun_silence_frames
        : null,
    load_error_delta:
      typeof first.load_error_count === "number" && typeof last.load_error_count === "number"
        ? last.load_error_count - first.load_error_count
        : null,
    playback_false_samples: samples.filter((sample) => sample.playback.is_playing !== true).length,
    current_time_monotonic_resets: resets,
    spectrum_events_delta:
      typeof samples[0].websocket.spectrum_event_count === "number" &&
      typeof samples[samples.length - 1].websocket.spectrum_event_count === "number"
        ? samples[samples.length - 1].websocket.spectrum_event_count - samples[0].websocket.spectrum_event_count
        : null,
    position_events_delta:
      typeof samples[0].websocket.position_event_count === "number" &&
      typeof samples[samples.length - 1].websocket.position_event_count === "number"
        ? samples[samples.length - 1].websocket.position_event_count - samples[0].websocket.position_event_count
        : null
  };
};

const runBenchmark = async (options) => {
  const report = {
    probe: "lyne-playback-stability-benchmark",
    generated_at: new Date().toISOString(),
    base_url: options.baseUrl,
    track: options.track,
    parameters: {
      duration_ms: options.durationMs,
      warmup_ms: options.warmupMs,
      sample_ms: options.sampleMs,
      enable_dsp: options.enableDsp,
      loop_track: options.loopTrack
    },
    summary: { pass: false },
    server: null,
    setup: {},
    stability: {
      diagnostics_samples: [],
      seek_back_count: 0
    },
    process_metrics: null,
    limitations: [
      "This benchmark measures runtime stability from diagnostics and state, not analog output capture.",
      "Underrun counters are native callback diagnostics; CPU/RSS samples are coarse process snapshots.",
      "A short run is useful for smoke evidence; use 30-60 minutes for release-grade stability proof."
    ]
  };

  let server = null;
  let monitor = null;
  const startedAt = performance.now();
  try {
    if (!options.baseUrlExplicit) {
      server = await startAudioServer(options);
      report.server = {
        mode: "isolated",
        pid: server.child.pid,
        server_path: server.serverPath,
        runtime: server.runtime,
        ready_ms: await waitForAudioServer(options, server.child)
      };
      monitor = createProcessMonitor(server.child.pid, options.sampleMs);
      monitor.start();
    } else {
      report.server = { mode: "external" };
    }

    const load = await requestJson(options, "POST", "/load", { path: options.track, autoplay: true });
    const playback = await waitForPlayback(options);
    report.setup.load_latency_ms = Number(load.latencyMs.toFixed(3));
    report.setup.time_to_initial_progress_ms = playback.elapsed_ms;
    report.setup.initial_state = {
      current_time: playback.value.state.current_time,
      duration: playback.value.state.duration,
      file_path: playback.value.state.file_path,
      is_playing: playback.value.state.is_playing
    };

    if (options.enableDsp) {
      report.setup.dsp_profile = await enableDspProfile(options);
    }

    await sleep(options.warmupMs);
    report.stability.diagnostics_samples = await collectDiagnosticsSamples(options, report);
    const diagnosticsSummary = summarizeDiagnostics(report.stability.diagnostics_samples);
    report.summary = {
      pass:
        diagnosticsSummary.underrun_delta === 0 &&
        diagnosticsSummary.load_error_delta === 0 &&
        diagnosticsSummary.playback_false_samples === 0,
      total_elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      diagnostics: diagnosticsSummary
    };
  } catch (error) {
    report.summary.pass = false;
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (monitor) {
      const samples = await monitor.stop();
      report.process_metrics = {
        summary: summarizeProcessSamples(samples),
        samples
      };
    }
    if (server) {
      if (!options.keepServer) {
        await shutdownAudioServer(options, server.child);
      }
      report.server = {
        ...(report.server || { mode: "isolated", pid: server.child.pid, runtime: server.runtime }),
        exit_code: server.child.exitCode,
        kept_running: options.keepServer,
        stdout_tail: server.logs.stdout,
        stderr_tail: server.logs.stderr
      };
    }
  }

  return report;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  options.baseUrlExplicit = process.argv.includes("--base-url") || Boolean(process.env.LYNE_AUDIO_SERVER_URL);
  await ensureAudioFile(options.track, "track");
  const report = await runBenchmark(options);
  const outputPath = await writeJsonReport(options.outputDir, "playback-stability-benchmark.json", report);
  console.log(`[lyne-playback-stability] wrote ${path.relative(appRoot, outputPath)}`);
  const diagnostics = report.summary.diagnostics || {};
  console.log(
    `[lyne-playback-stability] pass=${report.summary.pass} samples=${diagnostics.sample_count || 0} underruns=${diagnostics.underrun_delta} silent_frames=${diagnostics.underrun_silence_frames_delta}`
  );
  if (report.process_metrics && report.process_metrics.summary) {
    const metrics = report.process_metrics.summary;
    console.log(
      `[lyne-playback-stability] peak_working_set=${metrics.peak_working_set_bytes || 0}B peak_cpu=${metrics.peak_cpu_percent || 0}%`
    );
  }
  if (report.error) {
    console.error(`[lyne-playback-stability] ${report.error}`);
  }
  if (!report.summary.pass) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
