# Implementation Plan

## Ordered Work

1. Record dependency baseline, lock hash, dirty files, and target revision.
2. Read backend quality/error/directory specs and inventory all core API uses.
3. Add focused tests for locations, cancellation, metadata, fallible DSP, and
   convolver replacement where existing seams support them.
4. Migrate typed decoder locations, staged sources, HTTP adapters, loudness
   identities, and cancellation tokens.
5. Migrate exports, configuration mapping, metadata access, and fallible setters.
6. Migrate `DspChain`, resampler, noise-shaper, volume, saturation, limiter,
   and sample-rate/error propagation.
7. Migrate convolver control and disposal lifecycle; run callback tests.
8. Refresh resolution to `af5899886939add755217cc72865ed8426e3d9cc` and review
   the lock diff for expected dependency changes only.
9. Run formatting, metadata, clippy, root tests, Tauri checks, and focused
   audio benchmark gates.
10. Run Trellis check, update durable specs if needed, stage only task-owned
    files, and leave commit/archive to the finish-work phase.

## Validation Commands

```text
cargo metadata --locked --no-deps
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked
cargo test --workspace --locked
cargo bench --bench audio_callback_output_path_perf -- --quick --enforce
cargo bench --bench audio_callback_chain_perf -- --quick --enforce
cargo bench --bench audio_resampler_streaming_perf -- --quick --enforce
```

Run the excluded Tauri crate's own fmt, check, and test commands with its
`apps/desktop/src-tauri/Cargo.toml` manifest. Use frontend gates if the
dependency migration changes the desktop integration build.

## Risky Files and Stop Conditions

- `Cargo.toml` / `Cargo.lock`: retain the old revision until compatibility is
  proven and verify lock restoration after temporary overrides.
- Decoder, streaming, server/library scan, config, player, processor, and
  benchmark files can affect remote playback, callback behavior, or evidence.
- Do not bump the lockfile while source errors, focused test failures, or
  unexplained callback regressions remain.
- Do not modify or push `D:\AI\audio-engine-core`.
- Do not claim full integration when local SoXR linking blocks the Rust test
  gate; record the exact missing native dependency.
