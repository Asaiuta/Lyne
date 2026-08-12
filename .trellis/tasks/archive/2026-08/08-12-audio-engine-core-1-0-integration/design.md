# Technical Design

## Boundaries

AudioPlayer remains the owner of playback state, device output, server routes,
media-library persistence, and remote-fetch policy. `audio-engine-core` owns
typed media locations, decoding, resampling, loudness, DSP processors,
callback-safe parameters, and streaming processing. This task changes the
adapter between those boundaries; it does not move application policy into the
core.

The root workspace and the excluded Tauri crate are checked separately. The
git dependency is validated against a temporary local path first, and the
committed revision is updated only after source compatibility is clean.

## Data Flow

1. Application paths and URLs enter decoder and loudness boundaries.
2. Those boundaries construct validated `MediaLocation` values and use
   `LoudnessSourceIdentity` for cache/persistence keys.
3. Decoder metadata is observed through `info()` and is not mutated by the app.
4. Control-thread settings publish through fallible playback or atomic APIs.
5. The callback owns prepared, fixed-capacity processor state without
   allocation or blocking.
6. Convolver replacement follows the control/retirement contract so old
   kernels are reclaimed by a non-callback producer path.

## Migration Map

| Current surface | Target contract | Treatment |
| --- | --- | --- |
| Path/string decoder opens | `MediaLocation` | Centralize conversion at source boundaries. |
| `DecodeCancelToken::new(flag)` | `new()` / `from_flag()` | Use owned cancellation unless shared adoption is required. |
| Mutable `decoder.info` | `info()` | Replace reads and remove mutation assumptions. |
| Legacy config and processor exports | Current playback/parameter types | Map settings explicitly and preserve errors. |
| Infallible `DspChain` calls | `Result` plus `u32` rates | Propagate construction and processing errors. |
| Old resampler/noise-shaper APIs | `StreamingProcessor` | Preserve frame-domain sizing and drain/reset behavior. |
| `ConvolverProcessor::new(config)` | `ConvolverControl` | Keep preparation and retirement explicit. |
| Public loudness fields | Accessors/snapshots | Preserve persistence semantics. |
| `open_with_http_policy` | Typed locations plus app policy | Keep SSRF, redirect, and cookie controls in AudioPlayer. |

## Error Strategy

- Treat each compile-error family as an ownership boundary, not a global
  search-and-replace.
- Preserve structured core errors at application boundaries and add existing
  AudioPlayer context only where needed.
- Keep settings adapters explicit; rejected core values surface as a settings
  error or are rejected before publication.
- For temporary verification, isolate Cargo resolution and restore the lockfile
  hash afterward. Retain only the target git revision in the final patch.

## Rollback

The rollback point is the current revision
`5389c32f66c52c2d0b870acdeae4b20cf9c9de47`. If source migration or focused
validation fails, do not update the pin or hide incompatibilities behind local
compatibility code. Restore only task-owned edits while preserving unrelated
worktree changes.

## Quality Gates

Run existing callback allocation and processing tests, focused decoder and
streaming tests, then the full root workspace and independent Tauri checks.
Run callback/output, resampler, convolver, and decoder benchmarks where their
fixtures and native dependencies are available. Device and end-to-end latency
require integration evidence and are not inferred from library benchmarks.
