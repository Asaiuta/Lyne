# Current Evidence

Date: 2026-06-01

## Local Library Scan

Evidence already in the repo:

- `src/server/playback/library_scan.rs` implements a bounded local scan pipeline with canonical local paths, worker count limits, cancellation checks, scan task persistence, and batched writer behavior.
- `src/app_database/media_items.rs` owns scan-specific batch metadata writes and safe fallback behavior for legacy path identity conflicts.
- `.trellis/spec/backend/database-guidelines.md` documents the scan batch contract, including fallback count reporting and file-backed cover-art rows.
- `.trellis/tasks/05-30-backend-performance-benchmark-gates/research/benchmark-results.md` records passing benchmark gates for scan, event fan-out, and playback load budgets.

Strong evidence:

- Existing benchmark gates show synthetic local scan and DB write paths are fast after the 05-30/05-31 work.
- The latest recorded benchmark notes show 10k synthetic scan runs around hundreds of milliseconds, batch DB writes as the dominant win, and zero fast-path fallbacks in the synthetic canonical-path case.
- Cancellation is covered by deterministic benchmark probes with low post-cancel processing counts.
- File-backed cover references materially reduce the SQLite hot path for large cover payloads.
- Fresh local scans now avoid per-file `canonicalize()` calls on the worker hot
  path and only fall back to canonicalization when needed to match an existing
  snapshot entry. This preserved legacy canonical snapshot compatibility while
  reducing filesystem calls on fresh scans.
- The user-supplied real-library warm-cache worker matrix shows the default
  2-worker setting as the best speed/resource balance: 1.180 s for 593 indexed
  tracks, about 33 MB peak RSS, and modest sampled CPU.
- `jwalk` research data suggests a follow-up could improve traversal if Lyne accepts SPlayer-like hidden-file semantics.

Limitations:

- The older synthetic benchmark explicitly excludes real audio decode, real user libraries, WebDAV/network sources, and actual WebSocket I/O.
- Synthetic metadata cannot prove tag accuracy across malformed ID3/FLAC/Vorbis/MP4/APE files.
- The new real-library harness records aggregate outcomes and one redacted hash for the skipped zero-byte file, but it is not a full anonymized per-file accuracy matrix.
- There is no corpus-level accuracy report for cover selection precedence, stale cover recovery, or lyric matching false positives.
- A later runtime probe added a deterministic one-track fixture scan. It proves one WAV plus sidecar cover through the running HTTP scan path, but does not replace a broad corpus-level report.

Current verdict for the claim:

- Fast and stable scanning: real-library pass for the supplied 594-file corpus;
  after the hot-path fix, Lyne is faster than the rerun SPlayer native scanner
  on this warm-cache corpus while using less sampled memory and CPU. This is
  still not a broad corpus, cold-cache, or WebDAV proof.
- Cover art accuracy: cover presence is strong on the supplied corpus (590 / 593), but actual cover correctness is not human/corpus-proven.
- Lyrics accuracy: partial; common local and NCM paths exist, but parity gaps and false-match risk remain.

## Lyrics

Implemented paths found in current source:

- `/domain/current_lyrics` resolves local override lyrics by song id first.
- `read_current_local_lyrics()` reads sidecar lyrics before embedded runtime/metadata lyrics.
- `read_local_override_lyrics()` scans configured lyric directories recursively for SPlayer-style `songId` filenames, with `ttml` preferred over `lrc`.
- Local sidecar scanning recognizes `ttml`, `yrc`, `lrc`, `qrc`, `lys`, `eslrc`, `srt`, `ass`, and `ssa`.
- `fetch_online_lyrics_for_metadata()` searches NCM by title/artist and fetches `lyric_new`, then caches normalized lines for local tracks without local lyrics.
- Online NCM playback supplement fetches detail, `lyric_new`, and optional dynamic cover in parallel.

Known gaps from prior parity notes and current inspection:

- No verified QQ Music fallback path.
- No user-selectable lyric source priority comparable to `qm` / `official` / `ttml` / `auto`.
- No proven cleanup/filtering matrix for source-specific lyric noise.
- No proven Chinese variant conversion behavior.
- NCM metadata-search fallback can produce false positives without a committed real corpus result.

Current verdict for the claim:

- Lyric availability is better than a basic player, but "accurate" is not achieved as a blanket claim yet.

## Playback Quality And DSP

Implemented paths found in current source:

- `src/processor` exposes SoXR resampling, EQ/FIR-related processors, saturation, crossfeed, loudness/true-peak, noise shaping, lock-free parameter state, and `DspChain`.
- `src/player/callback.rs` and callback-related benchmarks exist for the real-time path.
- `src/server/effects.rs` exposes backend DSP endpoints for EQ, EQ type, optimizations, crossfeed, saturation, dynamic loudness, noise shaper curve, and output bits.
- `apps/desktop/src/shared/api/effects.ts` exposes typed frontend calls for the DSP endpoints.
- `apps/desktop/src/features/settings/sections/AudioEngineSection.tsx` surfaces device, exclusive mode, output bits, noise shaper, dither, loudness, resample quality, saturation, crossfeed, dynamic loudness, cache, and preemptive resample controls.

Strong evidence:

- Existing tests/benchmarks cover pieces of callback, processor, resampler, true-peak, and playback load budgets.
- Backend quality spec forbids callback allocations, locks, I/O, and logging, and requires callback capacity tests to stay green.
- The app has deeper audio controls than a basic Electron/WebAudio player.
- A later runtime probe starts active playback from a local WAV fixture and
  verifies nine DSP/output controls through HTTP calls plus `/state` readback.

Limitations:

- A minimal Electron/WebAudio baseline and a Lyne runtime control probe now exist.
- Callback and DSP benchmarks do not include the full user-visible path: decode, output device, OS mixer/exclusive mode, UI commands, and underrun reporting.
- Feature presence alone does not prove the experience is "meaningfully stronger."
- Controls now have one active-playback state-readback pass, but still need UI-driven,
  packaged-release, and long-session proof.

Current verdict for the claim:

- Technically capable and controllable at the backend/runtime level, but the
  "clearly better than ordinary Electron players" claim is not product-proven yet.

## Commands Already Reported In This Thread

These were reported before this PRD seed and should be rerun or copied into durable task results if they become acceptance evidence:

- `cargo test library_scan --lib` - 9 passed.
- `cargo test player::callback --lib` - 13 passed.
- `cargo test processor:: --lib` - 135 passed.
- `cargo bench --bench backend_library_scan_perf -- --quick --enforce` - passed after release build completed.

Treat those as useful leads until this task records fresh command output or explicitly references the existing benchmark-results file.
