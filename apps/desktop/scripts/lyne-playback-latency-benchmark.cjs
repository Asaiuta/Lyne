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
  positiveNumber,
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

const defaultOutDir = path.join(appRoot, "output", "lyne-evidence", "playback-latency");

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.LYNE_AUDIO_SERVER_URL || "",
    token: process.env.LYNE_AUDIO_API_TOKEN || process.env.AUDIO_API_TOKEN || `lyne-playback-latency-${Date.now()}`,
    track: process.env.LYNE_PROBE_TRACK || "",
    nextTrack: process.env.LYNE_PROBE_NEXT_TRACK || "",
    serverPath: path.join(repoRoot, "target", "release", "audio_server.exe"),
    outputDir: defaultOutDir,
    port: positiveInteger(process.env.LYNE_PLAYBACK_LATENCY_PORT || "63904", "LYNE_PLAYBACK_LATENCY_PORT"),
    timeoutMs: 5000,
    serverReadyMs: 30000,
    progressTimeoutMs: 12000,
    seekTimeoutMs: 8000,
    pollMs: 50,
    settleMs: 350,
    trials: 5,
    sampleMs: 250,
    seekFractions: [0.25, 0.5, 0.75],
    skipSeek: false,
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
      case "--next-track":
        options.nextTrack = readPath(arg);
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
      case "--trials":
        options.trials = readInteger(arg);
        break;
      case "--sample-ms":
        options.sampleMs = readInteger(arg);
        break;
      case "--seek-fractions":
        if (!next) throw new Error("--seek-fractions requires a value");
        index += 1;
        options.seekFractions = next.split(",").map((part) => positiveNumber(part.trim(), arg));
        break;
      case "--skip-seek":
        options.skipSeek = true;
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
  if (options.seekFractions.some((fraction) => fraction <= 0 || fraction >= 1)) {
    throw new Error("--seek-fractions values must be between 0 and 1");
  }
  options.baseUrl = normalizeBaseUrl(options.baseUrl || `http://127.0.0.1:${options.port}`);
  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/lyne-playback-latency-benchmark.cjs --track <audio-file> [options]

Measures Lyne's user-visible playback control latency using the native server:
load-to-progress, pause/play resume, seek convergence, and optional next-track
switch latency. By default it starts an isolated audio_server.exe.

Options:
  --track <path>                 Primary local audio file
  --next-track <path>            Optional second audio file for queue/play_next latency
  --base-url <url>               Use an already-running server instead of starting one
  --token <token>                Bearer token if the server requires AUDIO_API_TOKEN
  --server <path>                audio_server.exe path
  --output-dir <dir>             Output directory relative to apps/desktop unless absolute
  --port <port>                  Isolated server port (default: 63904)
  --trials <n>                   Trial count for load/play/seek (default: 5)
  --seek-fractions <csv>         Seek targets as duration fractions (default: 0.25,0.5,0.75)
  --skip-seek                    Skip seek convergence measurements
  --poll-ms <ms>                 State polling interval (default: 50)
  --sample-ms <ms>               Process metric sampling interval (default: 250)
  --keep-server                  Leave the isolated server running after the benchmark
`);
};

const requestStateCommand = async (options, route, body) => {
  const requestStartedAt = performance.now();
  const response = await requestJson(options, "POST", route, body);
  const elapsedMs = performance.now() - requestStartedAt;
  return {
    response,
    elapsed_ms: Number(elapsedMs.toFixed(3)),
    state: response.json && response.json.state ? response.json.state : null
  };
};

const readQueueStatus = async (options) => {
  const { json, latencyMs } = await requestJson(options, "GET", "/queue_status");
  if (!json || typeof json !== "object" || json.status !== "success" || !json.queue) {
    throw new Error("Invalid /queue_status response");
  }
  return { queue: json.queue, latencyMs: Number(latencyMs.toFixed(3)) };
};

const comparablePath = (value) => {
  if (typeof value !== "string") return "";
  const withoutExtendedPrefix = value.startsWith("\\\\?\\") ? value.slice(4) : value;
  return path.normalize(withoutExtendedPrefix).toLowerCase();
};

const waitForProgressAdvance = async (options, baselineTime, label, timeoutMs = options.progressTimeoutMs) =>
  pollUntil({
    label,
    timeoutMs,
    intervalMs: options.pollMs,
    sample: () => readState(options),
    predicate: ({ state }) =>
      state.is_playing === true &&
      state.is_loading === false &&
      typeof state.current_time === "number" &&
      state.current_time > baselineTime + 0.02
  });

const waitForSeekConvergence = async (options, targetSecs) =>
  pollUntil({
    label: `seek ${targetSecs.toFixed(3)}s convergence`,
    timeoutMs: options.seekTimeoutMs,
    intervalMs: options.pollMs,
    sample: () => readState(options),
    predicate: ({ state }) =>
      state.is_playing === true &&
      state.is_loading === false &&
      Math.abs(state.current_time - targetSecs) < 0.75
  });

const waitForTrackSwitch = async (options, expectedPath) =>
  pollUntil({
    label: "next track switch",
    timeoutMs: options.progressTimeoutMs,
    intervalMs: options.pollMs,
    sample: () => readState(options),
    predicate: ({ state }) =>
      state.is_playing === true &&
      typeof state.file_path === "string" &&
      comparablePath(state.file_path) === comparablePath(expectedPath) &&
      state.current_time > 0.02
  });

const playbackPhasesFromSnapshot = (snapshot) =>
  snapshot && snapshot.playback_phases ? snapshot.playback_phases : null;

const playbackCountersFromSnapshot = (snapshot) => {
  const playback = snapshot && snapshot.playback ? snapshot.playback : {};
  const fields = [
    "playback_recovery_count",
    "parked_output_stream_count",
    "parked_output_stream_release_count",
    "audio_command_received_count",
    "audio_command_completed_count",
    "underrun_count",
    "underrun_silence_frames",
    "audio_buffer_output_shortfall_count",
    "audio_buffer_output_shortfall_frames",
    "streaming_output_shortfall_count",
    "streaming_output_shortfall_frames",
    "stream_play_generation",
    "playback_progress_generation",
    "streaming_queue_chunks_pushed_count",
    "streaming_queue_chunks_popped_count",
    "streaming_queue_empty_during_decode_count",
    "streaming_queue_empty_during_decode_frames",
    "streaming_queue_producer_full_count",
    "streaming_queue_producer_backpressure_count",
    "streaming_queue_dropped_count",
    "output_callback_activity_count",
    "output_callback_silenced_inactive_count",
    "output_callback_silenced_loading_count",
    "output_callback_silenced_stream_mismatch_count"
  ];
  return Object.fromEntries(
    fields.map((field) => [field, typeof playback[field] === "number" ? playback[field] : null])
  );
};

const playbackQueueFromSnapshot = (snapshot) => {
  const playback = snapshot && snapshot.playback ? snapshot.playback : {};
  const fields = [
    "streaming_queue_len",
    "streaming_queue_window_generation",
    "streaming_queue_min_len",
    "streaming_queue_max_len"
  ];
  return Object.fromEntries(
    fields.map((field) => [
      field,
      typeof playback[field] === "number" || playback[field] === null ? playback[field] : null
    ])
  );
};

const playbackCounterDelta = (before, after) => {
  const delta = {};
  for (const [field, beforeValue] of Object.entries(before || {})) {
    const afterValue = after ? after[field] : null;
    delta[field] =
      typeof beforeValue === "number" && typeof afterValue === "number" ? afterValue - beforeValue : null;
  }
  return delta;
};

const readPlaybackPhaseDiagnostics = async (options) => {
  const diagnostics = await readRuntimeDiagnostics(options);
  return {
    latency_ms: Number(diagnostics.latencyMs.toFixed(3)),
    playback: playbackCountersFromSnapshot(diagnostics.snapshot),
    playback_queue: playbackQueueFromSnapshot(diagnostics.snapshot),
    playback_phases: playbackPhasesFromSnapshot(diagnostics.snapshot)
  };
};

const measureLoadToProgress = async (options, trial) => {
  await requestJson(options, "POST", "/stop");
  await sleep(options.settleMs);
  const phaseDiagnosticsBeforeCommand = await readPlaybackPhaseDiagnostics(options);
  const command = await requestStateCommand(options, "/load", { path: options.track, autoplay: true });
  const phaseDiagnosticsAfterCommand = await readPlaybackPhaseDiagnostics(options);
  const baselineTime = command.state && typeof command.state.current_time === "number" ? command.state.current_time : 0;
  const progress = await waitForProgressAdvance(options, baselineTime, `trial ${trial} load-to-progress`);
  const phaseDiagnosticsAtSuccess = await readPlaybackPhaseDiagnostics(options);
  return {
    trial,
    operation: "load_to_progress",
    request_latency_ms: Number(command.response.latencyMs.toFixed(3)),
    request_elapsed_ms: command.elapsed_ms,
    time_to_progress_ms: progress.elapsed_ms,
    polls: progress.polls,
    state_at_success: {
      current_time: progress.value.state.current_time,
      duration: progress.value.state.duration,
      is_playing: progress.value.state.is_playing,
      file_path: progress.value.state.file_path
    },
    playback_diagnostics_delta: playbackCounterDelta(
      phaseDiagnosticsBeforeCommand.playback,
      phaseDiagnosticsAtSuccess.playback
    ),
    phase_diagnostics_before_command: phaseDiagnosticsBeforeCommand,
    phase_diagnostics_after_command: phaseDiagnosticsAfterCommand,
    phase_diagnostics_at_success: phaseDiagnosticsAtSuccess
  };
};

const measurePausePlayResume = async (options, trial) => {
  await requestJson(options, "POST", "/pause");
  await sleep(options.settleMs);
  const before = await readState(options);
  const phaseDiagnosticsBeforeCommand = await readPlaybackPhaseDiagnostics(options);
  const command = await requestStateCommand(options, "/play");
  const progress = await waitForProgressAdvance(
    options,
    before.state.current_time,
    `trial ${trial} play-resume-to-progress`
  );
  const phaseDiagnosticsAtSuccess = await readPlaybackPhaseDiagnostics(options);
  return {
    trial,
    operation: "play_resume_to_progress",
    request_latency_ms: Number(command.response.latencyMs.toFixed(3)),
    request_elapsed_ms: command.elapsed_ms,
    time_to_progress_ms: progress.elapsed_ms,
    polls: progress.polls,
    current_time_before_play: before.state.current_time,
    current_time_at_success: progress.value.state.current_time,
    playback_diagnostics_delta: playbackCounterDelta(
      phaseDiagnosticsBeforeCommand.playback,
      phaseDiagnosticsAtSuccess.playback
    ),
    phase_diagnostics_before_command: phaseDiagnosticsBeforeCommand,
    phase_diagnostics_at_success: phaseDiagnosticsAtSuccess
  };
};

const measureSeek = async (options, trial, fraction, duration) => {
  const targetSecs = Math.max(0.5, Math.min(duration - 1, duration * fraction));
  const phaseDiagnosticsBeforeCommand = await readPlaybackPhaseDiagnostics(options);
  const command = await requestStateCommand(options, "/seek", { position: targetSecs });
  const convergence = await waitForSeekConvergence(options, targetSecs);
  const progress = await waitForProgressAdvance(
    options,
    convergence.value.state.current_time,
    `trial ${trial} seek ${fraction} progress`,
    options.seekTimeoutMs
  );
  const phaseDiagnosticsAtSuccess = await readPlaybackPhaseDiagnostics(options);
  return {
    trial,
    operation: "seek_convergence",
    fraction,
    target_secs: Number(targetSecs.toFixed(3)),
    request_latency_ms: Number(command.response.latencyMs.toFixed(3)),
    request_elapsed_ms: command.elapsed_ms,
    convergence_ms: convergence.elapsed_ms,
    progress_after_convergence_ms: progress.elapsed_ms,
    polls: convergence.polls + progress.polls,
    current_time_at_convergence: convergence.value.state.current_time,
    current_time_at_progress: progress.value.state.current_time,
    playback_diagnostics_delta: playbackCounterDelta(
      phaseDiagnosticsBeforeCommand.playback,
      phaseDiagnosticsAtSuccess.playback
    ),
    phase_diagnostics_before_command: phaseDiagnosticsBeforeCommand,
    phase_diagnostics_at_success: phaseDiagnosticsAtSuccess
  };
};

const measureNextTrack = async (options) => {
  if (!options.nextTrack) return null;

  await requestJson(options, "POST", "/domain/queue", { paths: [options.track, options.nextTrack] });
  await sleep(options.settleMs);
  await requestStateCommand(options, "/domain/queue/play", { source_path: options.track });
  await waitForProgressAdvance(options, 0, "queue first track playback");
  await requestJson(options, "POST", "/queue_next", { path: options.nextTrack });
  await sleep(options.settleMs);
  const queueStatusBeforePlayNext = await readQueueStatus(options);
  const command = await requestStateCommand(options, "/domain/queue/play_next");
  const queueStatusAfterCommand = await readQueueStatus(options);
  const switched = await waitForTrackSwitch(options, options.nextTrack);
  return {
    operation: "queue_play_next_to_progress",
    request_latency_ms: Number(command.response.latencyMs.toFixed(3)),
    request_elapsed_ms: command.elapsed_ms,
    command_message: command.response.json && command.response.json.message,
    queue_status_before_play_next: queueStatusBeforePlayNext,
    queue_status_after_command: queueStatusAfterCommand,
    switch_to_progress_ms: switched.elapsed_ms,
    polls: switched.polls,
    state_at_success: {
      current_time: switched.value.state.current_time,
      duration: switched.value.state.duration,
      file_path: switched.value.state.file_path,
      is_playing: switched.value.state.is_playing
    }
  };
};

const summarizeOperations = (measurements) => {
  const byOperation = {};
  for (const operation of new Set(measurements.map((measurement) => measurement.operation))) {
    const rows = measurements.filter((measurement) => measurement.operation === operation);
    byOperation[operation] = {
      count: rows.length,
      request_latency_ms: summarizeNumeric(rows.map((row) => row.request_latency_ms)),
      time_to_progress_ms: summarizeNumeric(rows.map((row) => row.time_to_progress_ms)),
      convergence_ms: summarizeNumeric(rows.map((row) => row.convergence_ms)),
      switch_to_progress_ms: summarizeNumeric(rows.map((row) => row.switch_to_progress_ms)),
      diagnostics_delta: summarizeOperationDiagnosticDeltas(rows)
    };
  }
  return byOperation;
};

const summarizeOperationDiagnosticDeltas = (measurements) => {
  const fields = new Set();
  for (const measurement of measurements) {
    for (const field of Object.keys(measurement.playback_diagnostics_delta || {})) {
      fields.add(field);
    }
  }

  const summary = {};
  for (const field of fields) {
    const values = measurements
      .map((measurement) => measurement.playback_diagnostics_delta && measurement.playback_diagnostics_delta[field])
      .filter((value) => typeof value === "number");
    summary[field] = {
      sum: values.reduce((total, value) => total + value, 0),
      max: values.length > 0 ? Math.max(...values) : null,
      non_zero_count: values.filter((value) => value !== 0).length
    };
  }
  return summary;
};

const runBenchmark = async (options) => {
  const report = {
    probe: "lyne-playback-latency-benchmark",
    generated_at: new Date().toISOString(),
    base_url: options.baseUrl,
    track: options.track,
    next_track: options.nextTrack || null,
    parameters: {
      trials: options.trials,
      timeout_ms: options.timeoutMs,
      progress_timeout_ms: options.progressTimeoutMs,
      seek_timeout_ms: options.seekTimeoutMs,
      poll_ms: options.pollMs,
      settle_ms: options.settleMs,
      sample_ms: options.sampleMs,
      seek_fractions: options.seekFractions,
      skip_seek: options.skipSeek
    },
    summary: { pass: false },
    server: null,
    diagnostics: {},
    measurements: [],
    next_track_measurement: null,
    process_metrics: null,
    limitations: [
      "This benchmark uses /state progress as an audible-playback proxy; it does not capture analog output.",
      "Latency includes HTTP, server handler, decode/load, and state polling resolution.",
      "Process CPU/RSS sampling is coarse Windows Get-Process data, not a profiler trace."
    ]
  };

  let server = null;
  let monitor = null;
  const startedAt = performance.now();
  try {
    if (!process.env.LYNE_AUDIO_SERVER_URL && !options.baseUrlExplicit) {
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

    report.diagnostics.before = (await readRuntimeDiagnostics(options)).snapshot;
    const firstLoad = await requestStateCommand(options, "/load", { path: options.track, autoplay: true });
    await waitForProgressAdvance(options, 0, "initial playback warmup");
    const warmState = await readState(options);
    const duration = Number(warmState.state.duration || firstLoad.state?.duration || 0);
    if (!options.skipSeek && (!Number.isFinite(duration) || duration <= 2)) {
      throw new Error(`Track duration is too short or unknown for seek benchmark: ${duration}`);
    }

    for (let trial = 1; trial <= options.trials; trial += 1) {
      report.measurements.push(await measureLoadToProgress(options, trial));
      report.measurements.push(await measurePausePlayResume(options, trial));
      if (!options.skipSeek) {
        for (const fraction of options.seekFractions) {
          report.measurements.push(await measureSeek(options, trial, fraction, duration));
        }
      }
    }

    report.next_track_measurement = await measureNextTrack(options);
    if (report.next_track_measurement) {
      report.measurements.push(report.next_track_measurement);
    }

    report.diagnostics.after = (await readRuntimeDiagnostics(options)).snapshot;
    report.summary = {
      pass: true,
      total_elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      operations: summarizeOperations(report.measurements),
      diagnostics_delta: null
    };
    report.summary.playback_phase_latest = playbackPhasesFromSnapshot(report.diagnostics.after);
    report.summary.playback_queue_latest = playbackQueueFromSnapshot(report.diagnostics.after);
    report.summary.diagnostics_delta = playbackCounterDelta(
      playbackCountersFromSnapshot(report.diagnostics.before),
      playbackCountersFromSnapshot(report.diagnostics.after)
    );
  } catch (error) {
    report.summary.pass = false;
    report.error = error instanceof Error ? error.message : String(error);
    try {
      report.diagnostics.error_state = (await readState(options)).state;
    } catch (stateError) {
      report.diagnostics.error_state_error =
        stateError instanceof Error ? stateError.message : String(stateError);
    }
    try {
      report.diagnostics.error_runtime = (await readRuntimeDiagnostics(options)).snapshot;
    } catch (diagnosticsError) {
      report.diagnostics.error_runtime_error =
        diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError);
    }
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
  if (options.nextTrack) {
    await ensureAudioFile(options.nextTrack, "next-track");
  }
  const report = await runBenchmark(options);
  const outputPath = await writeJsonReport(options.outputDir, "playback-latency-benchmark.json", report);
  console.log(`[lyne-playback-latency] wrote ${path.relative(appRoot, outputPath)}`);
  console.log(
    `[lyne-playback-latency] pass=${report.summary.pass} elapsed=${report.summary.total_elapsed_ms || 0}ms measurements=${report.measurements.length}`
  );
  if (report.summary.operations) {
    for (const [operation, summary] of Object.entries(report.summary.operations)) {
      const key =
        summary.time_to_progress_ms.count > 0
          ? "time_to_progress_ms"
          : summary.convergence_ms.count > 0
            ? "convergence_ms"
            : "switch_to_progress_ms";
      const metric = summary[key];
      console.log(
        `[lyne-playback-latency] ${operation} count=${summary.count} p50=${metric.p50}ms p95=${metric.p95}ms max=${metric.max}ms`
      );
    }
  }
  if (report.error) {
    console.error(`[lyne-playback-latency] ${report.error}`);
  }
  if (!report.summary.pass) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
