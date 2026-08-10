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

---

## 2026-08-08 — Task metadata archive-integrity repair (08-08-task-metadata-archive-integrity)

### Problem

- Three archived performance tasks (08-07-performance-artifact-provenance, 08-07-realtime-benchmark-gate-contract, 08-07-source-seek-benchmark-hardening) archived with all PRD acceptance boxes unchecked despite completed validation evidence.
- `task.py validate` failed on `08-07-performance-artifact-provenance/implement.jsonl:4`: it referenced `.trellis/tasks/08-07-realtime-benchmark-gate-contract/design.md`, which moved to archive when the sibling task was archived.
- Full-repo scan found 17 dangling JSONL references across 6 archived tasks (self- and sibling-references), all caused by `task.py archive` moving directories without rewriting manifests; 19 more legacy archived tasks had no per-criterion acceptance evidence at all.

### Fix

- Checked PRD boxes with evidence: 3 performance tasks (all criteria, mapping to validation-evidence.md), 07-18-fix-orphaned-local-library-media (9/10; the frontend-empty-state criterion left unchecked with an explicit note — no archived evidence).
- Rewrote all 17 dangling JSONL references to their archive locations (lossless; all targets verified to exist).
- Added honest "归档一致性注记 (2026-08-08)" notes to 19 legacy archived PRDs whose boxes remain unchecked (no evidence → no fabricated acceptance).
- Hardened `task.py`:
  - `validate` (common/task_context.py): archive-aware resolution — `.trellis/tasks/<name>/...` missing → resolves through `archive/<YYYY-MM>/<name>/...`, prints "resolved via archive".
  - `archive` (common/task_store.py): after the move, rewrites all JSONL entries pointing at the old active-task path to the archive path (staged in the same archive commit), and warns on unchecked PRD acceptance boxes.
  - workflow.md: documented the new archive/validate behavior.

### Verification

- `task.py validate` across all 134 task dirs (active + archive): 0 failures.
- Archive-fallback path exercised: reverted one reference to the stale active path → validate passes with "resolved via archive".
- End-to-end regression: created a throwaway task with self-reference context, archived it → reference auto-rewritten, unchecked-box warning emitted, validate passed; probe removed afterwards.
- No product code, bench, or runtime behavior touched; metadata + tooling only.

### Notes

- `.trellis/` is gitignored; only a subset is force-tracked. Commit stages the affected tracked files plus force-adds the scripts and repaired task metadata (same practice as prior archive commits). workflow.md remains untracked (Trellis-managed).
- Legacy 2026-06/07-era tasks keep unchecked boxes + note; reconstructing evidence for them is a separate decision.

## 2026-08-08 — Archive acceptance evidence reconstruction (08-08-legacy-archive-evidence-reconstruction)

**问题**：上一轮给 19 个 2026-06/07 归档任务写入模板式"归档一致性注记"，未判定验收点。
**处理**：S1（任务内记录）→ S2（git 提交）→ S3（现行代码/测试/产物）三级证据重建。
实测基准：typecheck、npm test 520+6+8+5、cargo test --lib 401、clippy（66 既有无新增）、npm build PASS、src-tauri cargo check。

**结果（119 条未勾选 → 102 达成 / 11 部分 / 6 未达成）**：
- 达成 102：逐条附【证据：S1/S2 hash/S3 复核】；未勾选 17 条附【判定：理由】。
- 关键 S1：07-05-pass2 (result.md + 31 张截图)、seek-race bench 后测；S2：0f55d47/f51e9c5/e03103b/adfbb29/628dfabe/8003f62/43d143a/22d48de/9ba3dcf/9b242c8/b962568/eda3c20/2bd2de8/283807e/b8e60db/4f3147e/f8c3b91/05d589c 等。
- 不可重建/未达成 6：madge 脚本缺失、SSRF resolved-IP（移交 07-02-server-fetch-hardening）、detail-routes 截图、color 截图、07-13 TBD 占位、07-18 前端空状态。
- 部分 11：运行时验证缺失类（返回路径 6 条、overlay 运行时 2 条、no_alloc 断言、peer color 静态复核、06-03 单测）。

**预防复发**：今后归档任务必须逐条记录验证证据（测试输出/commit/截图）后再 archive；`task.py archive` 的未勾选框警告即为此服务。

**附带**：git 跟踪面回滚（aca5240，26 个旧归档文件移出 git，磁盘元数据保留）。

## 2026-08-08 — Memory footprint & leak audit (08-08-memory-footprint-audit)

**实测**：release 重建后启动真实应用，31 分钟进程树采样（WMI + 内建 /diagnostics/runtime）。
- 整树空闲 ≈ 495–505 MB WS / ~298 MB private（WebView 树 ~420 MB 占 85%，壳 36 MB，sidecar 40 MB）。
- 31 min 无泄漏：WS 斜率 −0.29 MB/min、PB −2.04 MB/min，净变化 −16.3/−24.8 MB；WebView 进程数恒定 6。
- 播放场景（独立实例）：10×切歌循环账本 22–29 MB 交替、峰值 51 MB、释放路径完善；240s 曲目整曲缓冲 176 MB PCM → sidecar 单进程 221 MB WS。
- 关键上限：DECODE_MAX_MEMORY_MB 默认 2048 MiB（仅兜底），PCM 窗口 streaming_pcm_window_limit_mib 默认 256 MiB（84% 大头）。
- 优化空间合计 ~300–400 MB（最坏场景），全部为上限/策略裁剪（前工程项 library_track_view SQL 下推已在 backlog），无泄漏。
**产物**：research/report.md + data/（tree-residence.csv、playback-cycle.json、tone-long-diagnostics.json）+ scripts/sample-memory.ps1。

## 2026-08-09 — Browse-scenario memory audit (08-09-memory-browse-scenarios)

**自动化**：WebView2 CDP（--remote-debugging-port=9222）+ 零依赖 Node CDP 客户端（cdp-drive.mjs，全局 WebSocket/fetch），
WMI 5s 进程树采样并行。真实 UI 驱动：本地库滚动 4 轮、在线搜索往返 8 轮、混合播放。
- 纯浏览：sidecar 恒定 31-35 MB（浏览零影响）；DOM 恒 1149 nodes、JS heap 无累积（虚拟列表合格）。
- 搜索结果误触播放（长歌）：sidecar 31→222 MB（整曲缓冲）、整树 520→868 MB 峰值；20 分钟静置后 TOT WS −0.48 MB/min
  回落，DOM 20059→19462、JS heap 41.6→31.0 MB；sidecar 保持 222 MB（设计保留）。
- **判定：浏览路径无泄漏**；大头仍是播放整曲缓冲（256 MiB 窗口默认）与 WebView 基线（~545-605 MB）。
- 产物：report-browse.md + browse-mem.csv/settle-mem.csv/scene-log + 可复跑脚本组；归档 08-08 报告 §5/§6 增补。

## 2026-08-09 — Memory trim delivery (08-09-memory-trim-delivery)

**落地**：DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB 256→128（config.rs），401 测试全绿；默认路径零行为影响。
**解码路径实测**（240s 曲目，sidecar）：legacy 全曲缓冲 208.8 WS/175.8 账本 → v2@128MiB 161.1/128.1 → v2@64MiB 96.9/64.1（省 48–112 MB）。v2 需 AUDIO_STREAMING_FIRST_BUFFER=true（env_flag 只认 "true" 字符串！"1" 无效——调试耗时点）。v2 默认化属行为变更，建议独立任务做全量播放回归。
**WebView2 参数**：baseline 463.4 WS/307.4 PB @6 procs；--renderer-process-limit=1 负收益（492.6）弃用；--disable-gpu 446.1 WS/199.7 PB（PB 省 ~108 MB），像素差 0.7/255 不可感知，但合成走软件路径有性能风险 → 记录不默认。
**结论**：当前默认路径下内存已无可无损裁剪项；真实大头（190 MB）为 legacy 全曲缓冲设计，切换 v2 窗口化才有质变。

## 2026-08-09 — UI 架构决策报告 (08-09-ui-framework-migration-report)

产出 architecture-comparison.md：4 方案矩阵 + 迁移成本估算（Avalonia 50–80 人日、egui/iced 65–120 人日，基于 106.4K 行/196 组件实测数），
结论**保持 Tauri 为主**（WebView 基线为 Chromium 固有、播放缓冲与架构无关、前端为 Solid 全量重写成本高、CDP 自动化资产专属），
混合方案为渐进路径；触发器：<300 MB 硬指标 / 完全原生视觉转向 / 技术栈偏好变化。已并入父任务结论。
（journal 已含上一轮 entry：架构决策——本次为报告产出记录）

## 2026-08-09 — WebView2 进程级优化：反证结论 (08-09-webview2-process-memory)

- 验证 --disable-gpu / --disable-breakpad / --disable-crash-reporter：参数注入成功（命令行动员），但 gpu-process 与 crashpad-handler 均**未消失** → WebView2 忽略这些开关，6 进程树（browser+gpu+crashpad+2×utility+renderer）为不可削减基线。
- 修正 trim 报告错误归因：−108 MB PB 乃采样时机/页面状态差异，非 disable-gpu 效果（勘误写入 trim 报告 §6）。
- rAF 帧间隔三组 6.05→6.06ms 无差异；procs 恒定 6。
- 结论：无可落地启动参数；剩余可变项仅歌词窗 renderer（已归 SMTC 路线）。无产品代码变更（不引入误导配置）。

## 2026-08-09 — 图片位图内存审计 (08-09-frontend-image-bitmap-audit)

- 方法：真实鼠标事件（Input.dispatchMouseEvent，.click() 不触发 Solid 事件委托 → 反直觉调试点）驱动导航 + WMI renderer 采样 + 图元统计。
- 关键发现：本地库歌曲列表为**全量渲染**（19,353 nodes / 598 imgs 全解码）而发现页虚拟化（1,155/63）；但 renderer PB 仅差 22–43 MB → renderer ~150 MB 为平台成本（V8/Blink/合成器），内容增量 ~25%。
- 结论：优化上限 30–45 MB（切片列表虚拟化，已列入 07-16 任务）；图片专用优化 ≤20 MB 不单独立项。更新架构报告口径（renderer 产品本）。

## 2026-08-09 — streaming-v2 窗口化默认化落地（含 gapless v2 换轨）

**背景**：用户指出"可能没用最新构建" → 时间戳验证确认二进制确实最新，真正根因是 **serde `#[serde(default)]` 对 bool 得 false**：audio_settings.json 无 `streaming_first_buffer` 字段 → 反序列化静默回 legacy 全曲缓冲。

**修复**：
1. config.rs：`default_streaming_first_buffer()` + `load_from_file` env 显式覆盖（env=false 对已有配置文件也成立——此前 env 只影响文件缺失路径，回滚失效）。
2. gapless v2：pending 会话槽（InstallPending/Cancel/abandon）+ callback EOF 换轨（Ready|EndOfStream 均可）+ supervisor `streaming_pending_ready` 节流 + pending metadata 交接。
3. 记账：`PcmWindow::create(owner)` + `reown()` —— preload 窗口挂 pending playback，换轨时转 active window；EOF 队列尾 abandon 回收死窗口。

**踩坑**：EOF 时 pending rt 状态是 EndOfStream(3) 而非 Ready(2)（短曲全量 < 窗口）→ 首批 swap 失败；debug 日志定位。

**实测**：gapless PASS（30s→10s 无缝，无重 load）；480s tone legacy 399MB vs v2 175MB WS（ledger 351.6 vs 128.1 MiB）；seek 120s/5s ±0.2s；403 tests；clippy 无新增；npm build PASS。
**决策**：窗口保 128 MiB（64 MiB 对超长曲有重复解码风险）。

commit 106e417 · 任务 08-09-streaming-v2-window-default 待归档。
## 2026-08-09 — 64 MiB 窗口对照实测 + v2 seek 排障

- A/B：128 vs 64 MiB（env AUDIO_STREAMING_PCM_WINDOW_LIMIT_MIB），480s 曲 20 次跨窗 seek + gapless。
  64 MiB 零 rejection/零欠载，seek 误差与 128 完全一致（settle 1.6s 后 ~1.62s，实际位置偏差 ~0.02s），
  WorkingSet 174.4→110.3 MB（−64 MB，−37%）。结论入 verification-report.md §3.1；§4 补 swap 后
  ledger 记账滞留实测（64 轮 active=128.1 = 旧 64.1+新 64.1）。
- 排障插曲：20 次 seek 全失效 -> 加 6 处埋点 -> 发现端点错误：`/domain/queue/seek` 未注册路由，
  命中 cors_preflight（default_service）返回空体 200；真实端点是 legacy `/seek`。v2 跨窗 seek 本身
  一直正常（apply_source_seek 链路完整）。保留 info 级 seek telemetry（entry/command/publish/apply/warn）。
- 顺带修复：load_from_file 缺 AUDIO_STREAMING_PCM_WINDOW_LIMIT_MIB env 显式覆盖（与 first_buffer 对齐），
  低内存档位切换对已存在配置文件生效。
## 2026-08-10 — swap 旧窗口释放修复（gapless 假象揭穿）

- 目标：换轨时释放旧窗口。排查发现更深缺陷：preload 与 active 共用 load_generation，
  CallbackWindowCache 只按 generation 换 reader → 换轨后 callback 仍读旧曲目窗口
  （tone 素材掩盖，之前"无缝"验证全部无效）；旧窗口被 cache reader 钉死，
  PcmWindow 永不 drop → ledger 128.1 与物理页永久滞留（此前误判为 owner-transfer API 缺失）。
- 修复：refresh 支持 reader 缺失重绑 + retire_reader()；try_activate_pending_v2 swap 时
  显式 retire 旧 reader（Arc 进 retire 队列，audio 线程 drop）。
- 实测（64MiB）：PcmWindow drop 首次出现（origin=440s 帧）；swap 后 ledger active=64.1
  （原 128.1）；WS 118.7→54.9 MB（=基线 47.4+10s 实际页）；三曲连放两次 swap 全绿；
  20× 跨窗 seek 无回归。跨窗 seek 不受影响（重置同一窗口）。
- 注意：gapless 声音真实性首次被验证（rebind 到新窗口）；880Hz/440Hz tone 对照是
  这次发现假象的关键手段。


## Session 13: Songs list virtualization closeout

**Date**: 2026-08-10
**Task**: Songs list virtualization closeout
**Branch**: `feat/desktop-lyric`

### Summary

Bounded the library viewport, verified 592-to-16-row virtualization and about 30 MiB renderer savings, and recorded runtime evidence.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `59e13d0b` | (see git log) |
| `68de3d1a` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: Streaming v2 window default closeout

**Date**: 2026-08-10
**Task**: Streaming v2 window default closeout
**Branch**: `feat/desktop-lyric`

### Summary

Aligned the frontend streaming PCM window fallback to 128 MiB, synchronized model coverage and verification evidence, formatted the task-scoped Rust paths, and passed the full frontend and Rust validation gates.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `d6752ce5` | (see git log) |
| `f898ac8f` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
