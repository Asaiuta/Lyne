"use strict";

const { app, BrowserWindow } = require("electron");
const { mkdir, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const defaultOutDir = path.join(appRoot, "output", "electron-webaudio-baseline");

const parseArgs = (argv) => {
  const options = {
    durationSeconds: 1.5,
    sampleRate: 48_000,
    channels: 2,
    trials: 3,
    warmup: 1,
    outputDir: defaultOutDir
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const readNumber = (name) => {
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      const value = Number(next);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive number`);
      }
      return value;
    };

    switch (arg) {
      case "--duration":
        options.durationSeconds = readNumber(arg);
        break;
      case "--sample-rate":
        options.sampleRate = Math.round(readNumber(arg));
        break;
      case "--channels":
        options.channels = Math.round(readNumber(arg));
        break;
      case "--trials":
        options.trials = Math.round(readNumber(arg));
        break;
      case "--warmup":
        options.warmup = Math.round(readNumber(arg));
        break;
      case "--out":
        if (!next) throw new Error("--out requires a value");
        index += 1;
        options.outputDir = path.resolve(appRoot, next);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const withTimeout = (promise, timeoutMs, label) => {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
};

const rendererHarnessSource = (options) => `
(() => {
  const options = ${JSON.stringify(options)};
  const frequencies = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  const scenarioDefinitions = [
    {
      name: "pass_through_buffer_source",
      description: "AudioBufferSourceNode directly to destination; ordinary player decode/playback proxy."
    },
    {
      name: "gain_biquad_controls",
      description: "GainNode plus one peaking BiquadFilterNode; common WebAudio control surface."
    },
    {
      name: "ten_band_eq_like_chain",
      description: "Ten peaking BiquadFilterNodes chained as a simple EQ-like WebAudio graph."
    },
    {
      name: "compressor_analyser_tap",
      description: "DynamicsCompressorNode plus AnalyserNode; common loudness/visualizer-style graph."
    }
  ];

  const percentile = (values, p) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
    return sorted[index];
  };

  const makeInputBuffer = (context, frames) => {
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

  const connectScenario = (context, source, scenarioName) => {
    switch (scenarioName) {
      case "pass_through_buffer_source":
        source.connect(context.destination);
        return;
      case "gain_biquad_controls": {
        const gain = context.createGain();
        gain.gain.value = 0.82;
        const filter = context.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = 1000;
        filter.Q.value = 0.8;
        filter.gain.value = 3;
        source.connect(gain).connect(filter).connect(context.destination);
        return;
      }
      case "ten_band_eq_like_chain": {
        let previous = source;
        for (let index = 0; index < frequencies.length; index += 1) {
          const filter = context.createBiquadFilter();
          filter.type = "peaking";
          filter.frequency.value = frequencies[index];
          filter.Q.value = 1.1;
          filter.gain.value = index % 2 === 0 ? 2.5 : -1.5;
          previous.connect(filter);
          previous = filter;
        }
        previous.connect(context.destination);
        return;
      }
      case "compressor_analyser_tap": {
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.08;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(compressor).connect(analyser).connect(context.destination);
        return;
      }
      default:
        throw new Error("Unhandled scenario: " + scenarioName);
    }
  };

  const summarizeAudio = (buffer) => {
    const data = buffer.getChannelData(0);
    let peak = 0;
    let squareSum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const value = data[index];
      peak = Math.max(peak, Math.abs(value));
      squareSum += value * value;
    }
    return {
      output_peak: peak,
      output_rms: Math.sqrt(squareSum / Math.max(1, data.length))
    };
  };

  const measureScenario = async (scenario, frames) => {
    console.log("[electron-webaudio:renderer] scenario " + scenario.name);
    const timings = [];
    let audioSummary = null;
    const totalRuns = options.warmup + options.trials;

    for (let run = 0; run < totalRuns; run += 1) {
      const context = new OfflineAudioContext(options.channels, frames, options.sampleRate);
      const source = context.createBufferSource();
      source.buffer = makeInputBuffer(context, frames);
      connectScenario(context, source, scenario.name);
      const start = performance.now();
      source.start(0);
      const rendered = await context.startRendering();
      const elapsed = performance.now() - start;
      if (run >= options.warmup) {
        timings.push(elapsed);
        audioSummary = summarizeAudio(rendered);
      }
    }

    const best = Math.min(...timings);
    const worst = Math.max(...timings);
    const median = percentile(timings, 0.5);
    const realtimeFactor = (options.durationSeconds * 1000) / Math.max(0.001, median);

    return {
      name: scenario.name,
      description: scenario.description,
      trials: options.trials,
      best_render_ms: best,
      median_render_ms: median,
      worst_render_ms: worst,
      realtime_factor_at_median: realtimeFactor,
      ...audioSummary
    };
  };

  const run = async () => {
    if (typeof OfflineAudioContext !== "function") {
      throw new Error("OfflineAudioContext is not available in this Electron renderer");
    }

    const frames = Math.round(options.durationSeconds * options.sampleRate);
    const scenarios = [];
    for (const scenario of scenarioDefinitions) {
      scenarios.push(await measureScenario(scenario, frames));
    }

    return {
      baseline: "electron-webaudio-fixture",
      parameters: {
        duration_seconds: options.durationSeconds,
        sample_rate: options.sampleRate,
        channels: options.channels,
        frames,
        warmup: options.warmup,
        trials: options.trials
      },
      scenarios,
      feature_matrix: {
        playback_graph: "WebAudio AudioBufferSourceNode",
        output_device_selection: "browser mediated; setSinkId availability varies",
        exclusive_output_mode: false,
        explicit_output_bit_depth: false,
        native_callback_budget: false,
        lock_free_native_dsp_params: false,
        soxr_resampling: false,
        webaudio_filter_controls: true,
        analyser_visualizer_tap: true,
        dynamics_compressor_node: true,
        native_loudness_true_peak_pipeline: false,
        dither_noise_shaping_policy: false,
        persistent_product_control_surface: false
      },
      limitations: [
        "OfflineAudioContext measures WebAudio graph render cost, not actual device output latency.",
        "The fixture represents a minimal ordinary Electron/WebAudio player, not a tuned production Electron app.",
        "Audio quality is inferred from available controls and graph behavior; this is not a perceptual listening test.",
        "Compare these results with Lyne native Rust benches, not as a direct nanosecond-to-nanosecond callback substitute."
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
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-gpu");
  app.on("window-all-closed", (event) => {
    event.preventDefault();
  });
  await withTimeout(app.whenReady(), 15_000, "Electron app readiness");

  console.log(
    `[electron-webaudio] Electron ${process.versions.electron}, Chrome ${process.versions.chrome}`
  );

  const window = createHiddenWindow();
  window.webContents.on("console-message", (_event, _level, message) => {
    console.log(message);
  });

  await withTimeout(
    window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><title>Electron WebAudio baseline</title>")}`
    ),
    15_000,
    "Electron fixture page load"
  );

  const rendererTimeoutMs = Math.max(
    30_000,
    Math.round(options.durationSeconds * (options.trials + options.warmup) * 8_000)
  );
  const rendererResult = await withTimeout(
    window.webContents.executeJavaScript(rendererHarnessSource(options), true),
    rendererTimeoutMs,
    "Electron WebAudio renderer harness"
  );

  const report = {
    ...rendererResult,
    generated_at: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      v8: process.versions.v8
    }
  };

  await mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, "baseline.json");
  const tempOutputPath = `${outputPath}.tmp`;
  await writeFile(tempOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(tempOutputPath, outputPath);

  console.log(`[electron-webaudio] wrote ${path.relative(appRoot, outputPath)}`);
  for (const scenario of report.scenarios) {
    console.log(
      `[electron-webaudio] ${scenario.name} median=${scenario.median_render_ms.toFixed(3)}ms realtime=${scenario.realtime_factor_at_median.toFixed(2)}x peak=${scenario.output_peak.toFixed(4)}`
    );
  }

  window.destroy();
};

run()
  .then(() => app.quit())
  .catch((error) => {
    console.error("[electron-webaudio] failed", error);
    app.exit(1);
  });
