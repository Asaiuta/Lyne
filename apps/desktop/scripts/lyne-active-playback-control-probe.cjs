#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const defaultOutDir = path.join(appRoot, "output", "lyne-evidence");

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.LYNE_AUDIO_SERVER_URL || "http://127.0.0.1:63790",
    token: process.env.LYNE_AUDIO_API_TOKEN || process.env.AUDIO_API_TOKEN || "",
    track: process.env.LYNE_PROBE_TRACK || "",
    outputDir: defaultOutDir,
    timeoutMs: 5000,
    settleMs: 350,
    requirePlayback: false
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
    } else if (arg === "--track" && next) {
      options.track = path.resolve(next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      options.outputDir = path.resolve(appRoot, next);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--settle-ms" && next) {
      options.settleMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--require-playback") {
      options.requirePlayback = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  if (!Number.isFinite(options.settleMs) || options.settleMs < 0) {
    throw new Error("--settle-ms must be a non-negative integer");
  }
  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/lyne-active-playback-control-probe.cjs [options]

Options:
  --base-url <url>      Audio server base URL (default: http://127.0.0.1:63790)
  --token <token>       Bearer token if the server requires AUDIO_API_TOKEN
  --track <path>        Local audio file to load before probing active playback
  --output-dir <dir>    Output directory relative to apps/desktop unless absolute
  --timeout-ms <ms>     Per-request timeout (default: 5000)
  --settle-ms <ms>      Delay after load/play and between controls (default: 350)
  --require-playback    Fail if no --track is supplied or playback cannot start
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

const readState = async (options) => {
  const { json, latencyMs } = await requestJson(options, "GET", "/state");
  if (!json || typeof json !== "object" || json.status !== "success" || !json.state) {
    throw new Error("Invalid /state response");
  }
  return { state: json.state, latencyMs };
};

const fieldEquals = (actual, expected) => {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) < 0.0001;
  }
  return actual === expected;
};

const runStep = async (options, step) => {
  const startedAt = performance.now();
  const request = await requestJson(options, step.method, step.route, step.body);
  if (options.settleMs > 0) {
    await sleep(options.settleMs);
  }
  const stateRead = await readState(options);
  const assertions = step.expectState.map((expectation) => {
    const actual = stateRead.state[expectation.field];
    return {
      field: expectation.field,
      expected: expectation.value,
      actual,
      pass: fieldEquals(actual, expectation.value)
    };
  });
  return {
    name: step.name,
    route: step.route,
    method: step.method,
    request_latency_ms: Number(request.latencyMs.toFixed(3)),
    state_latency_ms: Number(stateRead.latencyMs.toFixed(3)),
    elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
    response_status: request.json && request.json.status ? request.json.status : null,
    response_message: request.json && request.json.message ? request.json.message : null,
    assertions,
    pass: assertions.every((assertion) => assertion.pass)
  };
};

const controlSteps = [
  {
    name: "enable_iir_eq_call",
    method: "POST",
    route: "/set_eq",
    body: { enabled: true, bands: { "31": 1.5, "1000": -1.0, "16000": 0.75 } },
    expectState: [{ field: "eq_type", value: "IIR" }]
  },
  {
    name: "enable_crossfeed",
    method: "POST",
    route: "/set_crossfeed",
    body: { enabled: true, mix: 0.35 },
    expectState: [
      { field: "crossfeed_enabled", value: true },
      { field: "crossfeed_mix", value: 0.35 }
    ]
  },
  {
    name: "enable_saturation",
    method: "POST",
    route: "/set_saturation",
    body: { enabled: true, drive: 0.42, mix: 0.27 },
    expectState: [
      { field: "saturation_enabled", value: true },
      { field: "saturation_drive", value: 0.42 },
      { field: "saturation_mix", value: 0.27 }
    ]
  },
  {
    name: "enable_dynamic_loudness",
    method: "POST",
    route: "/set_dynamic_loudness",
    body: { enabled: true, strength: 0.66 },
    expectState: [
      { field: "dynamic_loudness_enabled", value: true },
      { field: "dynamic_loudness_strength", value: 0.66 }
    ]
  },
  {
    name: "enable_noise_shaping",
    method: "POST",
    route: "/configure_optimizations",
    body: { dither_enabled: true },
    expectState: [{ field: "dither_enabled", value: true }]
  },
  {
    name: "set_noise_shaper_curve",
    method: "POST",
    route: "/set_noise_shaper_curve",
    body: { curve: "FWeighted9" },
    expectState: [{ field: "noise_shaper_curve", value: "FWeighted9" }]
  },
  {
    name: "set_output_bits",
    method: "POST",
    route: "/configure_output_bits",
    body: { bits: 24 },
    expectState: [{ field: "output_bits", value: 24 }]
  },
  {
    name: "set_resampling",
    method: "POST",
    route: "/configure_resampling",
    body: { quality: "uhq", use_cache: true, preemptive_resample: true },
    expectState: [
      { field: "resample_quality", value: "uhq" },
      { field: "use_cache", value: true },
      { field: "preemptive_resample", value: true }
    ]
  },
  {
    name: "set_loudness_normalization",
    method: "POST",
    route: "/configure_normalization",
    body: { enabled: true, mode: "track", target_lufs: -14, preamp_db: -1.5 },
    expectState: [
      { field: "loudness_enabled", value: true },
      { field: "loudness_mode", value: "track" },
      { field: "target_lufs", value: -14 },
      { field: "preamp_db", value: -1.5 }
    ]
  }
];

const maybeLoadAndPlay = async (options, report) => {
  if (!options.track) {
    report.playback_mode = "state_only_no_track";
    report.limitations.push("No --track was supplied, so the probe verifies control state transitions but not active audio output.");
    if (options.requirePlayback) {
      throw new Error("--require-playback needs --track <audio-file>");
    }
    return;
  }

  await fs.access(options.track);
  const load = await requestJson(options, "POST", "/load", {
    path: options.track,
    autoplay: true
  });
  report.load = {
    track: options.track,
    latency_ms: Number(load.latencyMs.toFixed(3)),
    status: load.json && load.json.status ? load.json.status : null,
    message: load.json && load.json.message ? load.json.message : null
  };
  await sleep(Math.max(options.settleMs, 500));
  const state = await readState(options);
  report.initial_state = {
    is_playing: state.state.is_playing,
    is_loading: state.state.is_loading,
    duration: state.state.duration,
    file_path: state.state.file_path,
    sample: {
      title: state.state.title,
      artist: state.state.artist,
      sample_rate: state.state.target_samplerate,
      output_bits: state.state.output_bits
    }
  };
  report.playback_mode = state.state.is_playing ? "active_playback" : "loaded_not_playing";
  if (options.requirePlayback && !state.state.is_playing) {
    throw new Error("Track loaded but server did not report active playback");
  }
};

const writeReport = async (options, report) => {
  await fs.mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, "active-playback-control-probe.json");
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, outputPath);
  return outputPath;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    probe: "lyne-active-playback-control-probe",
    generated_at: new Date().toISOString(),
    base_url: options.baseUrl,
    playback_mode: "unknown",
    summary: {
      pass: false,
      steps_total: controlSteps.length,
      steps_passed: 0,
      failed_steps: []
    },
    setup: {},
    steps: [],
    limitations: [
      "This probe verifies HTTP control responses and reflected player state, not analog output quality.",
      "EQ band gains are accepted by /set_eq, but /state does not expose per-band gains for direct readback."
    ]
  };

  try {
    const health = await readState(options);
    report.setup.health_state_latency_ms = Number(health.latencyMs.toFixed(3));
    report.setup.server_reachable = true;
    await maybeLoadAndPlay(options, report);

    for (const step of controlSteps) {
      const result = await runStep(options, step);
      report.steps.push(result);
      if (!result.pass) {
        report.summary.failed_steps.push(result.name);
      }
    }

    report.summary.steps_passed = report.steps.filter((step) => step.pass).length;
    report.summary.pass = report.summary.steps_passed === report.summary.steps_total;
  } catch (error) {
    report.summary.pass = false;
    report.error = error instanceof Error ? error.message : String(error);
  }

  const outputPath = await writeReport(options, report);
  console.log(`[lyne-control-probe] wrote ${path.relative(appRoot, outputPath)}`);
  console.log(
    `[lyne-control-probe] pass=${report.summary.pass} playback=${report.playback_mode} steps=${report.summary.steps_passed}/${report.summary.steps_total}`
  );
  if (report.error) {
    console.error(`[lyne-control-probe] ${report.error}`);
    process.exitCode = 1;
  } else if (!report.summary.pass) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
