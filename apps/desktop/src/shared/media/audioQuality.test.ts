import assert from "node:assert/strict";
import test from "node:test";

import { audioQualityLabelFromMetadata } from "./audioQuality";

test("audioQualityLabelFromMetadata labels high-resolution PCM from sample rate and bit depth", () => {
  assert.equal(
    audioQualityLabelFromMetadata({
      fileName: "track.flac",
      sampleRate: 96_000,
      bitsPerSample: 24,
      bitrateBps: 2_800_000
    }),
    "Hi-Res"
  );
});

test("audioQualityLabelFromMetadata labels CD-quality lossless files as SQ", () => {
  assert.equal(
    audioQualityLabelFromMetadata({
      fileName: "track.flac",
      sampleRate: 44_100,
      bitsPerSample: 16,
      bitrateBps: 900_000
    }),
    "SQ"
  );
});

test("audioQualityLabelFromMetadata uses bitrate bands for lossy files", () => {
  assert.equal(audioQualityLabelFromMetadata({ fileName: "track.mp3", bitrateBps: 320_000 }), "HQ");
  assert.equal(audioQualityLabelFromMetadata({ fileName: "track.mp3", bitrateBps: 192_000 }), "MQ");
  assert.equal(audioQualityLabelFromMetadata({ fileName: "track.mp3", bitrateBps: 128_000 }), "LQ");
});
