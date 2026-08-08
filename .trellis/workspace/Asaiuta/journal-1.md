# Journal - Asaiuta (Part 1)

> AI development session journal
> Started: 2026-06-03

---



## Session 1: Streaming first-buffer playback kernel

**Date**: 2026-06-03
**Task**: Streaming first-buffer playback kernel
**Branch**: `master`

### Summary

Implemented memory-bounded streaming playback, seek/recovery diagnostics, and stable CPAL recovery parking; validated with cargo check/tests and real FLAC stress evidence.

### Main Changes

- Added `crates/audio-engine-core` as the internal package boundary for decoder, DSP processor, pipeline, and shared core helpers.
- Kept playback control, server routes, app database, WebDAV/NetEase, settings persistence, and runtime path ownership in the root `audio_engine` crate.
- Updated backend directory structure docs and archived the Trellis task after the code commits landed.

### Git Commits

| Hash | Message |
|------|---------|
| `1f9f04d` | (see git log) |

### Testing

- [OK] `cargo test -p audio-engine-core --lib`
- [OK] `cargo check --bin audio_server`
- [OK] `cargo test player::callback --lib`
- [OK] focused rustfmt checks

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Extract audio engine core crate

**Date**: 2026-06-10
**Task**: Extract audio engine core crate
**Branch**: `master`

### Summary

Extracted reusable decoder, DSP, pipeline and core helpers into crates/audio-engine-core; kept app/server concerns in the root crate; validated core tests and audio_server checks.

### Main Changes

- Removed root runtime dependencies that are now owned by `crates/audio-engine-core`: `symphonia`, `soxr`, `rayon`, and `atomic_float`.
- Moved root bench-only direct dependencies `rustfft` and `ebur128` to `[dev-dependencies]`.
- Removed root SoXR build metadata, root build dependencies, and the delegating root `build.rs`.
- Updated backend directory-structure guidance so build-script ownership matches the package boundary.

### Git Commits

| Hash | Message |
|------|---------|
| `91a4707` | (see git log) |
| `aa5b846` | (see git log) |

### Testing

- [OK] `cargo check --bin audio_server`
- [OK] `cargo test -p audio-engine-core --lib` (152 passed)
- [OK] `cargo check --bench audio_convolver_perf --bench audio_quality_measurements`
- [OK] `F:\Python\python.exe .\.trellis\scripts\task.py validate 06-10-audio-engine-core-dependency-ownership`

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Tighten audio engine core dependency ownership

**Date**: 2026-06-10
**Task**: Tighten audio engine core dependency ownership
**Branch**: `master`

### Summary

Removed root runtime/build dependencies now owned by audio-engine-core, kept bench-only deps as dev-dependencies, and synced the Trellis boundary docs.

### Main Changes

- Added `audio-engine-core` Cargo publication metadata: AGPL-3.0-only license, repository/homepage/docs links, README, keywords, and categories.
- Added a crate-specific README covering scope, non-scope, SoXR setup, a small decode/loudness example, realtime notes, and license.
- Replaced rustdoc links to private processor modules with links to public exported processor types.
- Recorded and archived the Trellis release-prep task.

### Git Commits

| Hash | Message |
|------|---------|
| `75058c3` | (see git log) |
| `a84936e` | (see git log) |

### Testing

- [OK] `cargo check -p audio-engine-core`
- [OK] `cargo fmt -p audio-engine-core --check`
- [OK] `cargo doc -p audio-engine-core --no-deps`
- [OK] `cargo test -p audio-engine-core --lib` (152 passed)
- [OK] `cargo package -p audio-engine-core --allow-dirty --list`
- [OK] `cargo package -p audio-engine-core --allow-dirty`
- [OK] `cargo publish -p audio-engine-core --dry-run --allow-dirty`

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Prepare audio-engine-core packaging

**Date**: 2026-06-11
**Task**: Prepare audio-engine-core packaging
**Branch**: `master`

### Summary

Added audio-engine-core publication metadata and crate README, fixed rustdoc links, and verified package/publish dry-run.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `388cdde` | (see git log) |
| `3e559e3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: frontend-security

**Date**: 2026-07-02
**Task**: frontend-security
**Branch**: `feat/desktop-lyric`

### Summary

CSP+sidecar-media-file-delete

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9b242c8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

## Session 6: desktop-lyric joint commit

**Date**: 2026-07-04
**Task**: 06-30-system-lyrics-smtc (phase 2) + 07-02-frontend-lyric-fixes
**Branch**: `feat/desktop-lyric`

### Summary

Landed the parked desktop-lyric overlay work as the planned joint commit and closed 07-02-frontend-lyric-fixes.

### Main Changes

- Joint commit `9ba3dcf`: 22 files (+1878/-33) — overlay window (desktop_lyric.rs, capabilities), standalone DesktopLyricApp, useDesktopLyricBridge, settings/i18n, plus all five review fixes (zombie-overlay Destroyed hook, per-frame tick on()+untrack, marquee hoist + rAF idle, monitor clamp, is_open seeding)
- File split audit: excluded parked online/MV work (useNavigationController, HistoryPage, features/online/*), backend src/*, Trellis tooling, junk (docs/test.md, src.zip.backup)
- Spec update: on()+untrack event-emission pattern, Tauri overlay lifecycle contracts, anti-pattern row -> .trellis/spec/frontend/index.md
- 07-02-frontend-lyric-fixes -> completed (commit 9ba3dcf); smtc implement.md warning replaced with committed note

### Git Commits

| Hash | Message |
|------|---------|
| `9ba3dcf` | feat(desktop-lyric): SPlayer-style lyric overlay + lifecycle/perf fixes |

### Testing

- [OK] frontend typecheck green
- [OK] 265/265 unit tests pass
- [OK] src-tauri cargo check clean

### Status

[OK] **Joint commit landed; frontend-lyric-fixes complete; smtc stays in_progress**

### Next Steps

- smtc phase 1: SMTC M1.0 souvlaki spike (data source = bridge push per design.md §3), then M1.1-M1.4
- M3.0 taskbar feasibility research remains

## Session 7: SMTC phase 1 + taskbar feasibility research

**Date**: 2026-07-04
**Task**: 06-30-system-lyrics-smtc (phase 1 + M3.0)
**Branch**: `feat/desktop-lyric`

### Summary

Implemented, checked, and committed Windows SMTC integration (souvlaki, bridge-push model); completed the M3.0 taskbar-lyric feasibility study with a conditional-GO verdict.

### Main Changes

- Commit `93a56c8`: 16 files (+1127/-37) — src-tauri/src/smtc.rs (worker-thread-owned MediaControls, mpsc-driven, shutdown() join; 6 cargo tests), useSmtcBridge.ts (4 effects: registration-follows-setting, metadata on(identity-memo,{defer}), play/pause transition, 5s gated timeline), smtcPolicy.ts pure helpers (15 node tests), smtcEnabled setting (GeneralSection + search catalog), removed stale smtcOpen WIP placeholder from NetworkSection
- Cover contract: SMTC fetches thumbnails headerless -> local URLs keep getCoverArtUrl's ?token= query; normalizeSmtcCoverUrl drops webview-relative fallbacks
- Media keys: souvlaki callback -> emit_to("main","smtc:control",{action,positionSec?}) -> existing playback handlers (seek = absolute seconds)
- Spec update: "System media integration (SMTC)" section (5 contracts) -> .trellis/spec/frontend/index.md
- M3.0 research (retry after a 429-killed first dispatch, empty research/ confirmed): research/m3.0-taskbar-lyric-feasibility.md (249 lines) — SPlayer SetParents its lyric window INTO Shell_TrayWnd (not an overlay); its native layer is already windows-rs Rust (~1693 LOC behind NAPI) so porting into src-tauri deletes the NAPI layer; verdict conditional GO, 9-13 person-days full / 2-3 floating fallback, gated on a 1-day WebView2+SetParent PoC

### Git Commits

| Hash | Message |
|------|---------|
| `93a56c8` | feat(smtc): Windows system media controls via souvlaki |

### Testing

- [OK] frontend typecheck green
- [OK] 280/280 unit tests pass (incl. 15 new smtcPolicy)
- [OK] src-tauri cargo check zero warnings; cargo test smtc 6/6
- [PENDING] Windows media flyout visual smoke test (needs interactive app run — user gate)

### Status

[OK] **Phase 1 committed; M3.0 research complete; task stays in_progress pending manual e2e (phase 4)**

### Next Steps

- User: run the app, verify Windows media flyout (track+cover shown, media keys work)
- Phase 4 wrap: full build + manual e2e (SMTC + overlay) + cross-platform compile check, then finish-work/archive
- M3.1 taskbar implementation: separate task after approval, first gate = 1-day SetParent PoC



## Session 6: Remaining online detail route independence

**Date**: 2026-07-05
**Task**: Remaining online detail route independence
**Branch**: `feat/desktop-lyric`

### Summary

Isolated daily songs, artist, video/MV, and radio detail pages as standalone online routes; validated typecheck, tests, build, and screenshot probe.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f8c3b91` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Content page cleanup

**Date**: 2026-07-05
**Task**: Content page cleanup
**Branch**: `feat/desktop-lyric`

### Summary

Removed content-page account/debug surfaces, hid Discover MV tab, normalized legacy Discover tab state, and verified with typecheck/tests/build/Playwright.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `671d050` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: SPlayer UI parity Trellis progress correction

**Date**: 2026-07-09
**Task**: `07-04-splayer-ui-parity`
**Branch**: `feat/desktop-lyric`

### Summary

Updated Trellis to match actual UI parity progress. The parent task is now `in_progress` instead of stale `planning`; visual audit remains `in_progress` because S1 detail/player/streaming gaps and motion evidence are still open.

### Evidence

- `output/playwright/discover-neutral-hover/results.json`
- `output/playwright/discover-neutral-hover/01-playlists-hover.png`
- `output/playwright/discover-neutral-hover/02-category-modal-hover.png`
- `output/playwright/discover-neutral-hover/03-new-filter-active-hover.png`
- `output/playwright/discover-neutral-hover/04-toplist-hover.png`

### Status

[OK] **Trellis markers caught up to current discover control evidence; task not complete**

### Next Steps

- Continue S1 detail pages
- Capture active player/queue/full-player evidence
- Capture route/card/full-player motion evidence


## Session 9: Complete streaming playback pipeline v2

**Date**: 2026-07-12
**Task**: `07-02-streaming-playback-pipeline-v2`
**Branch**: `feat/desktop-lyric`

### Summary

Replaced the legacy streaming transport with a persistent preallocated PCM window, completed resident and source seek behavior, finalized Ready/EOF and duration publication, and archived the task with environment-specific residual gates documented.

### Main Changes

- Added the absolute-frame PCM window, exact decoded-memory ledger, persistent producer/decoder/source session, and nested v2 diagnostics.
- Added O(1) forward/backward resident seek and persistent out-of-window source seek with latest-wins control.
- Removed the old chunk queue, retention ring, replay prefix, queue renderer, memory promotion, deferred seek path, and legacy diagnostics/tests.
- Corrected task acceptance markers and recorded the Windows benchmark/runtime and output-device limitations without weakening the single-transport design.

### Git Commits

| Hash | Message |
|------|---------|
| `6dc2e9b` | feat(player): replace streaming transport with pcm window |
| `f5336db` | test(player): cover streaming session duration |

### Testing

- [OK] `cargo fmt --all -- --check`, `cargo check --lib --benches`, `cargo test --lib`, and `cargo test`
- [OK] `cargo clippy --workspace --all-targets` (warnings remain; strict `-D warnings` is repository-wide residual work)
- [OK] PCM-window and resident-seek enforcement benchmarks, including zero post-warmup v2 allocations
- [OK] Native 48 kHz CPAL and Electron real-file playback latency gates

### Status

[OK] **Completed and archived**

### Next Steps

- Track the strict workspace warning cleanup, isolated Cargo benchmark DLL launch, and repeated 44.1 -> 48 kHz device fallback stall outside this completed task.


## Session 10: Discover route performance root-cause follow-up

**Date**: 2026-07-23
**Task**: `07-12-frontend-tauri-performance-trace`
**Branch**: `feat/desktop-lyric`

### Summary

Removed the false playlists branch when Discover restores the persisted
toplists tab, then reused the existing session cache for public Discover
categories and toplists across route remounts. No visual or motion parameters
changed.

### Evidence

- Wrong initial playlists request removed; renderer bytes fell from 80,141 to
  38,248 in the directional trace comparison.
- Controlled remount requests fell from four to two: only the first load
  fetched categories and toplists; two later remounts added no requests.
- Cache-hit trace contained no Discover backend Fetch and only 144 bytes of
  renderer-visible SMTC IPC.
- Residual `66.971 ms` renderer task remains attributable to keyed content
  mount plus style/layout/paint, not the eliminated network work.
- Full record: `research/tauri-perf/discover-route-optimization-20260723.md`.

### Testing

- [OK] Frontend focused tests: 501 passed
- [OK] `npm run typecheck`
- [OK] `npm run build`
- [OK] Probe unit tests: 18 passed
- [OK] Probe syntax: 8 Node modules and 2 PowerShell scripts passed
- [OK] Discover artifact audit: 53 files, 0 sensitive hits, 0 read errors
- [OK] Real Tauri cache-hit route screenshot and endpoint audit

### Status

[OK] **Network/remount lifetime hotspot fixed; residual visual mount cost kept open**

### Next Steps

- Do not trade card count, motion, or layout fidelity for the residual mount
  task without a repeatable, pixel-equivalent candidate.
- Run the full task quality gate before proposing a commit.


## Session 10: Bench gate contract implemented and archived

**Date**: 2026-08-08
**Task**: Bench gate contract implemented and archived
**Branch**: `feat/desktop-lyric`

### Summary

Completed 08-07-realtime-benchmark-gate-contract (PERF-001+PERF-004): shared src/bench_gate.rs with report/--check/--gate + --gate-self-test, machine-readable gate-specs for 4 canonical benches, Lyne summary.pass folding stability/control sub-gates with failure_reasons + pipeline matrix guard, docs/spec updated. Verified: cargo test 387, frontend 520, lyne-subgates 5/5, all bench gates green. Archived realtime-benchmark-gate-contract, 07-15-audio-settings-single-writer, 07-18-fix-orphaned-local-library-media.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `60d1f34` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: Performance artifact provenance implemented and archived

**Date**: 2026-08-08
**Task**: Performance artifact provenance implemented and archived
**Branch**: `feat/desktop-lyric`

### Summary

PERF-005: shared provenance blocks. Rust src/bench_provenance.rs (collect + compare, 9 tests) wired into audio_callback_output_path_perf + pcm_window_perf JSON (additive, schema stable). Node provenance-utils.cjs mirror with attachReportProvenance (idempotent) + CRLF-normalized porcelain matching Rust cross-family fingerprints; 8 tests incl. redaction + temp-repo clean/dirty. All 10 report writers attach provenance; restart-tauri-cdp.ps1 merges --emit-git-fields into launch-meta. Spec PERF-005 contract + docs artifact identity. Suites: cargo 396, npm 539, typecheck, clippy clean for new code.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `c0c64a8` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: Source-seek benchmark hardened with gate contract (PERF-002)

**Date**: 2026-08-08
**Task**: Source-seek benchmark hardened with gate contract (PERF-002)
**Branch**: `feat/desktop-lyric`

### Summary

Session summary was not supplied.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `18beb4d` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
