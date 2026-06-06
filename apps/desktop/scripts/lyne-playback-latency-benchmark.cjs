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
    inWindowSeek: false,
    inWindowPrerollMs: 10000,
    inWindowBackSecs: 6,
    inWindowTrials: null,
    playbackProfile: "default",
    controlToggles: 0,
    stabilitySeconds: 0,
    loopDuringStability: true,
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
      case "--in-window-seek":
        options.inWindowSeek = true;
        break;
      case "--in-window-preroll-ms":
        options.inWindowPrerollMs = readInteger(arg);
        break;
      case "--in-window-back-secs":
        if (!next) throw new Error("--in-window-back-secs requires a value");
        index += 1;
        options.inWindowBackSecs = positiveNumber(next.trim(), arg);
        break;
      case "--in-window-trials":
        options.inWindowTrials = readInteger(arg);
        break;
      case "--playback-profile":
        if (!next) throw new Error("--playback-profile requires a value");
        index += 1;
        options.playbackProfile = next.trim().toLowerCase();
        break;
      case "--control-toggles":
        options.controlToggles = readInteger(arg);
        break;
      case "--stability-seconds":
        if (!next) throw new Error("--stability-seconds requires a value");
        index += 1;
        options.stabilitySeconds = positiveNumber(next.trim(), arg);
        break;
      case "--no-loop":
        options.loopDuringStability = false;
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
  if (options.inWindowTrials === null) {
    options.inWindowTrials = options.trials;
  }
  if (!["default", "bare", "light-dsp"].includes(options.playbackProfile)) {
    throw new Error("--playback-profile must be one of: default, bare, light-dsp");
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
  --in-window-seek               Add the in-window backward-seek scenario (default off).
                                 Plays long enough to fill the behind-playhead retention
                                 ring, then seeks backward into the retained window and
                                 measures that seek's progress_after_convergence_ms.
  --in-window-preroll-ms <ms>    Playback time before the backward seek so the ring fills
                                 (default: 10000)
  --in-window-back-secs <s>      Backward hop distance from the live playhead. Must exceed
                                 the engine prefix gate (~0.26s @96k / ~0.56s @44.1k) and
                                 stay inside the retained behind-window (~40s @96k / ~95s
                                 @44.1k stereo for the 64 MiB ring) (default: 6)
  --in-window-trials <n>         In-window scenario trial count (default: --trials value)
  --playback-profile <name>      Benchmark profile: default, bare, light-dsp (default: default)
  --control-toggles <n>          Toggle native DSP controls while playing and record latency
  --stability-seconds <seconds>  Sample playback diagnostics after latency trials
  --no-loop                      Do not seek near track end during stability sampling
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

const EQ_BAND_GAINS_LIGHT_DSP = {
  "31": 2.5,
  "62": -1.5,
  "125": 2.5,
  "250": -1.5,
  "500": 2.5,
  "1000": -1.5,
  "2000": 2.5,
  "4000": -1.5,
  "8000": 2.5,
  "16000": -1.5
};

const EQ_BAND_GAINS_FLAT = Object.fromEntries(
  Object.keys(EQ_BAND_GAINS_LIGHT_DSP).map((band) => [band, 0])
);

const playbackProfileCommands = (profile) => {
  switch (profile) {
    case "bare":
      return [
        { route: "/configure_normalization", body: { enabled: false, preamp_db: 0 } },
        { route: "/set_dynamic_loudness", body: { enabled: false, strength: 0 } },
        { route: "/set_saturation", body: { enabled: false, drive: 0, mix: 0 } },
        { route: "/set_crossfeed", body: { enabled: false, mix: 0 } },
        { route: "/set_eq", body: { enabled: false, bands: EQ_BAND_GAINS_FLAT } },
        { route: "/configure_optimizations", body: { dither_enabled: false, replaygain_enabled: false } },
        { route: "/volume", body: { volume: 1 } }
      ];
    case "light-dsp":
      return [
        { route: "/configure_normalization", body: { enabled: false, preamp_db: 0 } },
        { route: "/set_dynamic_loudness", body: { enabled: false, strength: 0 } },
        { route: "/set_saturation", body: { enabled: false, drive: 0, mix: 0 } },
        { route: "/set_crossfeed", body: { enabled: false, mix: 0 } },
        { route: "/set_eq", body: { enabled: true, bands: EQ_BAND_GAINS_LIGHT_DSP } },
        { route: "/configure_optimizations", body: { dither_enabled: false, replaygain_enabled: false } },
        { route: "/volume", body: { volume: 0.78 } }
      ];
    case "default":
      return [];
    default:
      throw new Error(`Unknown playback profile: ${profile}`);
  }
};

const applyPlaybackProfile = async (options) => {
  const commands = playbackProfileCommands(options.playbackProfile);
  const applied = [];
  for (const command of commands) {
    const startedAt = performance.now();
    const response = await requestJson(options, "POST", command.route, command.body);
    applied.push({
      route: command.route,
      body: command.body,
      latency_ms: Number(response.latencyMs.toFixed(3)),
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      status: response.json && response.json.status ? response.json.status : null,
      message: response.json && response.json.message ? response.json.message : null
    });
  }
  if (commands.length > 0) {
    await sleep(Math.min(options.settleMs, 100));
  }
  return applied;
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
    "load_error_count",
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

// Plays for at least `prerollMs` while confirming `current_time` keeps advancing,
// so the behind-playhead retention ring fills with consumed audio. Returns the
// last observed live playhead in seconds.
const playUntilRingFills = async (options, prerollMs, label) => {
  const startedAt = performance.now();
  let lastTime = (await readState(options)).state.current_time;
  while (performance.now() - startedAt < prerollMs) {
    await sleep(options.pollMs);
    const snapshot = await readState(options);
    if (typeof snapshot.state.current_time === "number") {
      lastTime = snapshot.state.current_time;
    }
    if (snapshot.state.is_playing !== true) {
      throw new Error(`${label} stalled: playback is not advancing during preroll`);
    }
  }
  return lastTime;
};

const measureInWindowBackwardSeek = async (options, trial, duration) => {
  // Seek to a base position so there is room to hop backward and decoded audio
  // ahead of the playhead, then play long enough to fill the retention ring.
  const baseSecs = Math.max(0.5, Math.min(duration - 1, duration * 0.5));
  await requestStateCommand(options, "/seek", { position: baseSecs });
  await waitForSeekConvergence(options, baseSecs);
  const playheadSecs = await playUntilRingFills(
    options,
    options.inWindowPrerollMs,
    `trial ${trial} in-window preroll`
  );

  // Hop backward into the retained behind-playhead window.
  const targetSecs = Math.max(0.5, playheadSecs - options.inWindowBackSecs);
  const phaseDiagnosticsBeforeCommand = await readPlaybackPhaseDiagnostics(options);
  const command = await requestStateCommand(options, "/seek", { position: targetSecs });
  const convergence = await waitForSeekConvergence(options, targetSecs);
  const progress = await waitForProgressAdvance(
    options,
    convergence.value.state.current_time,
    `trial ${trial} in-window backward seek progress`,
    options.seekTimeoutMs
  );
  const phaseDiagnosticsAtSuccess = await readPlaybackPhaseDiagnostics(options);
  return {
    trial,
    operation: "in_window_backward_seek",
    back_secs: Number(options.inWindowBackSecs.toFixed(3)),
    playhead_before_seek_secs: Number(playheadSecs.toFixed(3)),
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

const DSP_CONTROL_TOGGLE_STEPS = [
  {
    name: "eq_gain_high",
    route: "/set_eq",
    body: { enabled: true, bands: EQ_BAND_GAINS_LIGHT_DSP }
  },
  {
    name: "eq_gain_low",
    route: "/set_eq",
    body: {
      enabled: true,
      bands: Object.fromEntries(Object.entries(EQ_BAND_GAINS_LIGHT_DSP).map(([band, gain]) => [band, -gain]))
    }
  },
  {
    name: "volume_high",
    route: "/volume",
    body: { volume: 0.78 }
  },
  {
    name: "volume_low",
    route: "/volume",
    body: { volume: 0.68 }
  }
];

const measureControlUpdates = async (options) => {
  if (options.controlToggles <= 0) {
    return {
      enabled: false,
      reason: "--control-toggles was not set",
      samples: [],
      latency_ms: summarizeNumeric([]),
      diagnostics_delta: null
    };
  }

  await requestStateCommand(options, "/load", { path: options.track, autoplay: true });
  await waitForProgressAdvance(options, 0, "control update warmup");
  const phaseDiagnosticsBeforeCommand = await readPlaybackPhaseDiagnostics(options);
  const samples = [];
  for (let index = 0; index < options.controlToggles; index += 1) {
    const step = DSP_CONTROL_TOGGLE_STEPS[index % DSP_CONTROL_TOGGLE_STEPS.length];
    const startedAt = performance.now();
    const response = await requestJson(options, "POST", step.route, step.body);
    samples.push({
      index,
      name: step.name,
      route: step.route,
      request_latency_ms: Number(response.latencyMs.toFixed(3)),
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      status: response.json && response.json.status ? response.json.status : null,
      message: response.json && response.json.message ? response.json.message : null
    });
    await sleep(16);
  }
  const phaseDiagnosticsAtSuccess = await readPlaybackPhaseDiagnostics(options);

  return {
    enabled: true,
    samples,
    latency_ms: summarizeNumeric(samples.map((sample) => sample.elapsed_ms)),
    request_latency_ms: summarizeNumeric(samples.map((sample) => sample.request_latency_ms)),
    diagnostics_delta: playbackCounterDelta(
      phaseDiagnosticsBeforeCommand.playback,
      phaseDiagnosticsAtSuccess.playback
    )
  };
};

const collectStabilitySamples = async (options, duration) => {
  if (options.stabilitySeconds <= 0) {
    return {
      enabled: false,
      reason: "--stability-seconds was not set",
      samples: [],
      summary: {
        sample_count: 0,
        diagnostics_latency_ms: summarizeNumeric([]),
        playback_false_samples: 0,
        loading_samples: 0,
        load_error_delta: null,
        recovery_delta: null,
        underrun_delta: null,
        underrun_silence_frames_delta: null,
        streaming_output_shortfall_delta: null,
        streaming_output_shortfall_frames_delta: null,
        current_time_monotonic_resets: null,
        loop_seek_count: 0,
        current_time_delta_ms: summarizeNumeric([])
      }
    };
  }

  await requestStateCommand(options, "/load", { path: options.track, autoplay: true });
  await waitForProgressAdvance(options, 0, "stability warmup");
  const samples = [];
  const startedAt = performance.now();
  let previousTime = null;
  let monotonicResets = 0;
  let loopSeekCount = 0;

  while (performance.now() - startedAt < options.stabilitySeconds * 1000) {
    const sampleStartedAt = performance.now();
    const diagnostics = await readRuntimeDiagnostics(options);
    const playback = diagnostics.snapshot.playback || {};
    const currentTime = playback.current_time_secs;
    if (typeof currentTime === "number" && typeof previousTime === "number" && currentTime + 0.25 < previousTime) {
      monotonicResets += 1;
    }
    samples.push({
      at_ms: Number((performance.now() - startedAt).toFixed(3)),
      latency_ms: Number(diagnostics.latencyMs.toFixed(3)),
      playback: {
        is_playing: playback.is_playing,
        is_loading: playback.is_loading,
        current_time_secs: currentTime,
        duration_secs: playback.duration_secs,
        playback_recovery_count: playback.playback_recovery_count,
        load_error_count: playback.load_error_count,
        underrun_count: playback.underrun_count,
        underrun_silence_frames: playback.underrun_silence_frames,
        streaming_output_shortfall_count: playback.streaming_output_shortfall_count,
        streaming_output_shortfall_frames: playback.streaming_output_shortfall_frames,
        streaming_queue_len: playback.streaming_queue_len,
        streaming_queue_min_len: playback.streaming_queue_min_len,
        streaming_queue_max_len: playback.streaming_queue_max_len,
        active_stream_running: playback.active_stream_running,
        current_time_delta:
          typeof currentTime === "number" && typeof previousTime === "number" ? currentTime - previousTime : null
      }
    });
    previousTime = currentTime;

    if (
      options.loopDuringStability &&
      typeof currentTime === "number" &&
      Number.isFinite(duration) &&
      duration > 10 &&
      currentTime > Math.max(5, duration - 3)
    ) {
      await requestJson(options, "POST", "/seek", { position: 0.5 });
      loopSeekCount += 1;
    }

    const elapsed = performance.now() - sampleStartedAt;
    await sleep(Math.max(0, options.sampleMs - elapsed));
  }

  const first = samples[0] && samples[0].playback;
  const last = samples[samples.length - 1] && samples[samples.length - 1].playback;
  const delta = (field) =>
    first && last && typeof first[field] === "number" && typeof last[field] === "number"
      ? last[field] - first[field]
      : null;

  return {
    enabled: true,
    samples,
    summary: {
      sample_count: samples.length,
      diagnostics_latency_ms: summarizeNumeric(samples.map((sample) => sample.latency_ms)),
      playback_false_samples: samples.filter((sample) => sample.playback.is_playing !== true).length,
      loading_samples: samples.filter((sample) => sample.playback.is_loading === true).length,
      load_error_delta: delta("load_error_count"),
      recovery_delta: delta("playback_recovery_count"),
      underrun_delta: delta("underrun_count"),
      underrun_silence_frames_delta: delta("underrun_silence_frames"),
      streaming_output_shortfall_delta: delta("streaming_output_shortfall_count"),
      streaming_output_shortfall_frames_delta: delta("streaming_output_shortfall_frames"),
      current_time_monotonic_resets: monotonicResets,
      loop_seek_count: loopSeekCount,
      current_time_delta_ms: summarizeNumeric(
        samples
          .map((sample) => sample.playback.current_time_delta)
          .filter((value) => typeof value === "number")
          .map((value) => value * 1000)
      )
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
      progress_after_convergence_ms: summarizeNumeric(rows.map((row) => row.progress_after_convergence_ms)),
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
      skip_seek: options.skipSeek,
      in_window_seek: options.inWindowSeek,
      in_window_preroll_ms: options.inWindowPrerollMs,
      in_window_back_secs: options.inWindowBackSecs,
      in_window_trials: options.inWindowTrials,
      playback_profile: options.playbackProfile,
      control_toggles: options.controlToggles,
      stability_seconds: options.stabilitySeconds,
      loop_during_stability: options.loopDuringStability
    },
    summary: { pass: false },
    server: null,
    diagnostics: {},
    profile_setup: [],
    measurements: [],
    next_track_measurement: null,
    control_updates: null,
    stability: null,
    process_metrics: null,
    limitations: [
      "This benchmark uses /state progress as an audible-playback proxy; it does not capture analog output.",
      "Latency includes HTTP, server handler, decode/load, and state polling resolution.",
      "Native control timing includes HTTP/server handling; WebAudio control timing is in-renderer JavaScript parameter update latency.",
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

    report.profile_setup = await applyPlaybackProfile(options);
    report.diagnostics.before = (await readRuntimeDiagnostics(options)).snapshot;
    const firstLoad = await requestStateCommand(options, "/load", { path: options.track, autoplay: true });
    await waitForProgressAdvance(options, 0, "initial playback warmup");
    const warmState = await readState(options);
    const duration = Number(warmState.state.duration || firstLoad.state?.duration || 0);
    const needsDuration = !options.skipSeek || options.inWindowSeek;
    if (needsDuration && (!Number.isFinite(duration) || duration <= 2)) {
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

    if (options.inWindowSeek) {
      // Ensure the track is loaded and playing before the in-window scenario;
      // earlier trials may have left it stopped/paused.
      await requestStateCommand(options, "/load", { path: options.track, autoplay: true });
      await waitForProgressAdvance(options, 0, "in-window scenario warmup");
      for (let trial = 1; trial <= options.inWindowTrials; trial += 1) {
        report.measurements.push(await measureInWindowBackwardSeek(options, trial, duration));
      }
    }

    report.next_track_measurement = await measureNextTrack(options);
    if (report.next_track_measurement) {
      report.measurements.push(report.next_track_measurement);
    }

    report.control_updates = await measureControlUpdates(options);
    report.stability = await collectStabilitySamples(options, duration);

    report.diagnostics.after = (await readRuntimeDiagnostics(options)).snapshot;
    const stabilitySummary = report.stability ? report.stability.summary : null;
    const stabilityPass =
      !report.stability ||
      report.stability.enabled !== true ||
      (stabilitySummary.playback_false_samples === 0 &&
        stabilitySummary.loading_samples === 0 &&
        stabilitySummary.load_error_delta === 0 &&
        stabilitySummary.recovery_delta === 0 &&
        stabilitySummary.underrun_delta === 0 &&
        stabilitySummary.streaming_output_shortfall_delta === 0 &&
        stabilitySummary.current_time_monotonic_resets === 0);
    const controlUpdatePass =
      !report.control_updates ||
      report.control_updates.enabled !== true ||
      (report.control_updates.samples || []).every((sample) => sample.status === "success");
    report.summary = {
      pass: true,
      stability_pass: stabilityPass,
      control_update_pass: controlUpdatePass,
      total_elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      operations: summarizeOperations(report.measurements),
      diagnostics_delta: null,
      control_update_latency_ms: report.control_updates
        ? report.control_updates.latency_ms
        : summarizeNumeric([]),
      control_update_request_latency_ms: report.control_updates
        ? report.control_updates.request_latency_ms
        : summarizeNumeric([]),
      stability: stabilitySummary
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
      if (summary.progress_after_convergence_ms && summary.progress_after_convergence_ms.count > 0) {
        const pac = summary.progress_after_convergence_ms;
        console.log(
          `[lyne-playback-latency] ${operation} progress_after_convergence p50=${pac.p50}ms p95=${pac.p95}ms max=${pac.max}ms`
        );
      }
    }
  }
  if (report.control_updates && report.control_updates.latency_ms) {
    console.log(
      `[lyne-playback-latency] control enabled=${report.control_updates.enabled} p50=${report.control_updates.latency_ms.p50}ms p95=${report.control_updates.latency_ms.p95}ms`
    );
  }
  if (report.stability && report.stability.summary) {
    const stability = report.stability.summary;
    console.log(
      `[lyne-playback-latency] stability enabled=${report.stability.enabled} samples=${stability.sample_count} underruns=${stability.underrun_delta} recovery=${stability.recovery_delta} shortfall=${stability.streaming_output_shortfall_delta}`
    );
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
