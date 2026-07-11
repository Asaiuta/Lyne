const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.join(
  appRoot,
  "output",
  "lyne-evidence",
  "pipeline-v2-fixtures",
  "manifest.json"
);
const DEFAULT_OUTPUT_DIR = path.join(
  appRoot,
  "output",
  "lyne-evidence",
  "pipeline-v2-baseline",
  "playback-matrix"
);
const VALID_OUTPUT_MODES = new Set(["shared", "exclusive"]);

const parseCsv = (value) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const parseArgs = (args) => {
  let manifestPath = DEFAULT_MANIFEST;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let outputModes = ["shared"];
  let fixtureIds = null;
  let inWindowTrials = 1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    const readValue = () => {
      if (!next) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case "--manifest":
        manifestPath = path.resolve(readValue());
        break;
      case "--output-dir": {
        const value = readValue();
        outputDir = path.isAbsolute(value) ? value : path.resolve(appRoot, value);
        break;
      }
      case "--output-modes":
        outputModes = parseCsv(readValue()).map((mode) => mode.toLowerCase());
        break;
      case "--fixture-ids":
        fixtureIds = new Set(parseCsv(readValue()));
        break;
      case "--in-window-trials": {
        const value = Number(readValue());
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`--in-window-trials must be a positive integer, got '${value}'`);
        }
        inWindowTrials = value;
        break;
      }
      case "--help":
      case "-h":
        return { help: true, manifestPath, outputDir, outputModes, fixtureIds, inWindowTrials };
      default:
        throw new Error(`unknown argument '${arg}'`);
    }
  }

  if (outputModes.length === 0 || outputModes.some((mode) => !VALID_OUTPUT_MODES.has(mode))) {
    throw new Error("--output-modes must contain shared and/or exclusive");
  }
  return { help: false, manifestPath, outputDir, outputModes, fixtureIds, inWindowTrials };
};

const printUsage = () => {
  console.log(`Usage: node scripts/pipeline-v2-playback-matrix.cjs [options]

Options:
  --manifest <path>          Generated fixture manifest
  --output-dir <dir>         Matrix evidence directory
  --output-modes <csv>       shared, exclusive, or both (default: shared)
  --fixture-ids <csv>        Restrict the matrix to selected manifest fixture ids
  --in-window-trials <n>     Forward/backward seek trials per row (default: 1)
`);
};

const loadManifest = async (manifestPath) => {
  const raw = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.fixtures) || raw.fixtures.length === 0) {
    throw new Error(`invalid pipeline-v2 fixture manifest '${manifestPath}'`);
  }
  for (const fixture of raw.fixtures) {
    if (
      typeof fixture.id !== "string" ||
      typeof fixture.filePath !== "string" ||
      typeof fixture.sampleRate !== "number" ||
      typeof fixture.channels !== "number"
    ) {
      throw new Error(`manifest fixture has an invalid shape: ${JSON.stringify(fixture)}`);
    }
  }
  return raw;
};

const runProcess = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", (error) => resolve({ exitCode: null, error: error.message }));
    child.on("exit", (exitCode) => resolve({ exitCode, error: null }));
  });

const classifyRow = (report, processResult) => {
  if (report?.summary?.pass) return "passed";
  const stderrHighlights = report?.server?.stderr_highlights || "";
  if (
    report?.parameters?.output_mode === "exclusive" &&
    /no supported exclusive format found at any sample rate/i.test(stderrHighlights)
  ) {
    return "unsupported_output_format";
  }
  return "failed";
};

const findAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve an available IPv4 port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const operationMetric = (report, operation) => {
  const summary = report.summary && report.summary.operations && report.summary.operations[operation];
  if (!summary) return null;
  return {
    count: summary.count,
    request_latency_ms: summary.request_latency_ms,
    convergence_ms: summary.convergence_ms,
    progress_after_convergence_ms: summary.progress_after_convergence_ms,
    first_position_advance_ms: summary.first_position_advance_ms
  };
};

const runMatrixRow = async (options, fixture, outputMode) => {
  const rowOutputDir = path.join(options.outputDir, outputMode, fixture.id);
  await fs.promises.mkdir(rowOutputDir, { recursive: true });
  const port = await findAvailablePort();
  const benchmarkScript = path.join(__dirname, "lyne-playback-latency-benchmark.cjs");
  const args = [
    benchmarkScript,
    "--track",
    fixture.filePath,
    "--output-dir",
    rowOutputDir,
    "--port",
    String(port),
    "--output-mode",
    outputMode,
    "--trials",
    "1",
    "--skip-seek",
    "--in-window-seek",
    "--in-window-forward-seek",
    "--in-window-preroll-ms",
    "1500",
    "--in-window-back-secs",
    "1",
    "--in-window-forward-secs",
    "1",
    "--in-window-trials",
    String(options.inWindowTrials),
    "--poll-ms",
    "10"
  ];
  console.log(
    `[pipeline-v2-matrix] start fixture=${fixture.id} rate=${fixture.sampleRate} ` +
      `channels=${fixture.channels} output_mode=${outputMode}`
  );
  const processResult = await runProcess(process.execPath, args);
  const reportPath = path.join(rowOutputDir, "playback-latency-benchmark.json");
  const report = await fs.promises
    .readFile(reportPath, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  const status = classifyRow(report, processResult);
  const row = {
    fixture_id: fixture.id,
    fixture_sha256: fixture.sha256,
    sample_rate: fixture.sampleRate,
    channels: fixture.channels,
    channel_mask: fixture.channelMask,
    output_mode: outputMode,
    port,
    exit_code: processResult.exitCode,
    process_error: processResult.error,
    report_path: reportPath,
    status,
    pass: status === "passed",
    load_to_progress: report ? operationMetric(report, "load_to_progress") : null,
    in_window_backward_seek: report ? operationMetric(report, "in_window_backward_seek") : null,
    in_window_forward_seek: report ? operationMetric(report, "in_window_forward_seek") : null,
    pipeline_v2_evidence: report ? report.pipeline_v2_evidence || null : null,
    error: report && report.error ? report.error : null
  };
  console.log(
    `[pipeline-v2-matrix] finish fixture=${fixture.id} output_mode=${outputMode} ` +
      `exit=${row.exit_code} pass=${row.pass}`
  );
  return row;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const manifest = await loadManifest(options.manifestPath);
  const fixtures = options.fixtureIds
    ? manifest.fixtures.filter((fixture) => options.fixtureIds.has(fixture.id))
    : manifest.fixtures;
  if (fixtures.length === 0) throw new Error("fixture selection is empty");

  await fs.promises.mkdir(options.outputDir, { recursive: true });
  const rows = [];
  for (const outputMode of options.outputModes) {
    for (const fixture of fixtures) {
      rows.push(await runMatrixRow(options, fixture, outputMode));
    }
  }

  const report = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    fixture_manifest: options.manifestPath,
    output_modes: options.outputModes,
    in_window_trials: options.inWindowTrials,
    summary: {
      rows: rows.length,
      passed: rows.filter((row) => row.status === "passed").length,
      unsupported_output_format: rows.filter(
        (row) => row.status === "unsupported_output_format"
      ).length,
      failed: rows.filter((row) => row.status === "failed").length
    },
    rows
  };
  const reportPath = path.join(options.outputDir, "playback-matrix.json");
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `[pipeline-v2-matrix] report=${reportPath} passed=${report.summary.passed} ` +
      `failed=${report.summary.failed}`
  );
  if (report.summary.failed > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`[pipeline-v2-matrix] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
