# Current Baseline

## Dependency State

- Consumer: `D:\AI\AudioPlayer`
- Source checkout: `D:\AI\audio-engine-core`
- Current revision: `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`
- Target `main` / `origin/main`: `af5899886939add755217cc72865ed8426e3d9cc`
- Target release: `1.0.1`
- Core checkout is read-only for this task and contains unrelated untracked
  Trellis work.

## Compatibility Probe

A temporary local-path resolution and offline lock refresh were performed
before task creation. The original lockfile was restored and its hash matched.
Compilation against the target exposed about 97 library errors and 156
test-target errors, confirming a source migration is required before retaining
the lock update.

Representative families are removed config/processor exports, typed
`MediaLocation` decoder and loudness inputs, `StreamingDecoder.info()` and
owned cancellation, fallible `DspChain` methods with `u32` rates, new
`ConvolverControl` lifecycle, moved resampler/noise-shaper APIs, private
loudness state, and removed HTTP policy APIs.

## Evidence Limits

The probe establishes compile incompatibility only. It does not establish
runtime playback, device/driver behavior, DAC latency, or end-to-end latency.
