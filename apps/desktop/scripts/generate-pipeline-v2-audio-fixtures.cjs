const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.join(
  appRoot,
  "output",
  "lyne-evidence",
  "pipeline-v2-fixtures"
);
const DEFAULT_DURATION_SECONDS = 16;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const PCM_SUBFORMAT_GUID = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71
]);

const FIXTURE_SPECS = Object.freeze([
  { id: "pcm-s16-44k1-stereo", sampleRate: 44_100, channels: 2, channelMask: 0x0003 },
  { id: "pcm-s16-48k-stereo", sampleRate: 48_000, channels: 2, channelMask: 0x0003 },
  { id: "pcm-s16-96k-stereo", sampleRate: 96_000, channels: 2, channelMask: 0x0003 },
  { id: "pcm-s16-192k-stereo", sampleRate: 192_000, channels: 2, channelMask: 0x0003 },
  { id: "pcm-s16-48k-5_1", sampleRate: 48_000, channels: 6, channelMask: 0x003f },
  { id: "pcm-s16-48k-7_1", sampleRate: 48_000, channels: 8, channelMask: 0x063f }
]);

const CHANNEL_FREQUENCIES_HZ = Object.freeze([220, 277, 330, 55, 392, 440, 494, 554]);
const FRAMES_PER_WRITE = 4096;

const parsePositiveNumber = (raw, option) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${option} must be a positive number, got '${raw}'`);
  }
  return value;
};

const parseArgs = (args) => {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let durationSeconds = DEFAULT_DURATION_SECONDS;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--output-dir":
        if (!next) throw new Error("--output-dir requires a value");
        outputDir = path.isAbsolute(next) ? next : path.resolve(appRoot, next);
        index += 1;
        break;
      case "--duration-seconds":
        if (!next) throw new Error("--duration-seconds requires a value");
        durationSeconds = parsePositiveNumber(next, "--duration-seconds");
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "--help":
      case "-h":
        return { help: true, outputDir, durationSeconds, force };
      default:
        throw new Error(`unknown argument '${arg}'`);
    }
  }

  return { help: false, outputDir, durationSeconds, force };
};

const printUsage = () => {
  console.log(`Usage: node scripts/generate-pipeline-v2-audio-fixtures.cjs [options]

Options:
  --output-dir <dir>       Fixture directory relative to apps/desktop unless absolute
  --duration-seconds <s>   Duration of every generated fixture (default: 16)
  --force                  Regenerate files even when their exact size already matches
`);
};

const buildWaveHeader = ({ sampleRate, channels, channelMask, totalFrames }) => {
  const blockAlign = channels * PCM_BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = totalFrames * blockAlign;
  const header = Buffer.alloc(68);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(60 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(40, 16);
  header.writeUInt16LE(WAVE_FORMAT_EXTENSIBLE, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.writeUInt16LE(22, 36);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 38);
  header.writeUInt32LE(channelMask, 40);
  PCM_SUBFORMAT_GUID.copy(header, 44);
  header.write("data", 60, "ascii");
  header.writeUInt32LE(dataBytes, 64);
  return header;
};

const expectedFileBytes = (spec, durationSeconds) => {
  const totalFrames = Math.round(spec.sampleRate * durationSeconds);
  return 68 + totalFrames * spec.channels * PCM_BYTES_PER_SAMPLE;
};

const hashFile = async (filePath) => {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
};

const writeFixture = async (outputDir, spec, durationSeconds, force) => {
  const totalFrames = Math.round(spec.sampleRate * durationSeconds);
  const fileName = `${spec.id}-${durationSeconds}s.wav`;
  const filePath = path.join(outputDir, fileName);
  const expectedBytes = expectedFileBytes(spec, durationSeconds);
  const existing = await fs.promises.stat(filePath).catch(() => null);

  if (!force && existing && existing.isFile() && existing.size === expectedBytes) {
    return {
      ...spec,
      durationSeconds,
      totalFrames,
      bitsPerSample: PCM_BITS_PER_SAMPLE,
      format: "wave_format_extensible_pcm_s16",
      fileName,
      filePath,
      bytes: existing.size,
      sha256: await hashFile(filePath),
      reused: true
    };
  }

  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  const handle = await fs.promises.open(temporaryPath, "w");
  const hash = crypto.createHash("sha256");
  try {
    const header = buildWaveHeader({ ...spec, totalFrames });
    await handle.write(header);
    hash.update(header);

    for (let frameStart = 0; frameStart < totalFrames; frameStart += FRAMES_PER_WRITE) {
      const frameCount = Math.min(FRAMES_PER_WRITE, totalFrames - frameStart);
      const chunk = Buffer.allocUnsafe(frameCount * spec.channels * PCM_BYTES_PER_SAMPLE);
      let byteOffset = 0;
      for (let frameOffset = 0; frameOffset < frameCount; frameOffset += 1) {
        const absoluteFrame = frameStart + frameOffset;
        const timeSeconds = absoluteFrame / spec.sampleRate;
        for (let channel = 0; channel < spec.channels; channel += 1) {
          const frequency = CHANNEL_FREQUENCIES_HZ[channel];
          const amplitude = channel === 3 ? 0.12 : 0.2;
          const value = Math.sin(2 * Math.PI * frequency * timeSeconds) * amplitude;
          const sample = Math.round(Math.max(-1, Math.min(1, value)) * 0x7fff);
          chunk.writeInt16LE(sample, byteOffset);
          byteOffset += PCM_BYTES_PER_SAMPLE;
        }
      }
      await handle.write(chunk);
      hash.update(chunk);
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  await fs.promises.rm(filePath, { force: true });
  await fs.promises.rename(temporaryPath, filePath);

  const stat = await fs.promises.stat(filePath);
  if (stat.size !== expectedBytes) {
    throw new Error(`fixture '${filePath}' has ${stat.size} bytes, expected ${expectedBytes}`);
  }
  return {
    ...spec,
    durationSeconds,
    totalFrames,
    bitsPerSample: PCM_BITS_PER_SAMPLE,
    format: "wave_format_extensible_pcm_s16",
    fileName,
    filePath,
    bytes: stat.size,
    sha256: hash.digest("hex"),
    reused: false
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  await fs.promises.mkdir(options.outputDir, { recursive: true });
  const fixtures = [];
  for (const spec of FIXTURE_SPECS) {
    const fixture = await writeFixture(
      options.outputDir,
      spec,
      options.durationSeconds,
      options.force
    );
    fixtures.push(fixture);
    console.log(
      `[pipeline-v2-fixtures] ${fixture.reused ? "reused" : "wrote"} ${fixture.fileName} ` +
        `rate=${fixture.sampleRate} channels=${fixture.channels} bytes=${fixture.bytes}`
    );
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: path.basename(__filename),
    durationSeconds: options.durationSeconds,
    fixtures
  };
  const manifestPath = path.join(options.outputDir, "manifest.json");
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[pipeline-v2-fixtures] manifest=${manifestPath}`);
};

main().catch((error) => {
  console.error(`[pipeline-v2-fixtures] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
