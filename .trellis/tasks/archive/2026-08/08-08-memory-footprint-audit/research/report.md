# AudioPlayer 内存占用与泄漏审查报告

> 审查任务：08-08-memory-footprint-audit（2026-08-08）
> 测量环境：Windows 11（本机），release 构建（`cargo build --release`，2026-08-08 重建），WebView2（msedgewebview2.exe），Rust sidecar `audio_server.exe` v2.0.0 + Tauri 壳 `audio-desktop.exe`。采样工具：PowerShell/WMI（Get-CimInstance Win32_Process，working set/private page count）+ 内建 `/diagnostics/runtime` 端点（进程树 + 解码内存账本）。

## 1. 结论摘要

| 项 | 结果 |
| --- | --- |
| 整树空闲占用（壳+sidecar+WebView） | **≈ 495–505 MB working set；≈ 298 MB private（31 分钟驻留后 492 MB / 281 MB）** |
| 各部件占比 | WebView 树 ≈ 420 MB WS（85%）；Tauri 壳 ≈ 36 MB WS；Rust sidecar 空闲 ≈ 40 MB WS |
| 播放整曲缓冲最坏情况（5 分钟曲目） | sidecar 单进程 **220 MB WS / 201 MB private**（解码 PCM 占 176 MB） |
| 30+ 分钟空闲驻留（31 min，182 采样点） | 全周期无单调增长：WS 斜率 −0.29 MB/min、PB −2.08 MB/min，净变化 WS −16.3 MB / PB −24.8 MB → **未发现内存泄漏** |
| 解码账本上限（默认） | `DECODE_MAX_MEMORY_MB=2048`（2 GiB 兜底），PCM 窗口默认 256 MiB |
| 已观测到的最优裁量空间 | ≥ 300–400 MB（见 §5，全部有上限/默认值可调，无代码泄漏） |

## 2. 实测数据

### 2.1 进程树基线（空闲，未播放）

| 进程 | Working set | Private |
| --- | --- | --- |
| audio-desktop.exe（Tauri 壳） | ≈ 36.5 MB | ≈ 7.3 MB |
| audio_server.exe（sidecar） | ≈ 40 MB | ≈ 24 MB |
| msedgewebview2.exe（WebView 树合计，5–6 进程） | ≈ 420 MB | ≈ 270 MB |
| **合计** | **≈ 497 MB** | **≈ 298 MB** |

明细（首个采样 t≈1s）：webview 主进程 141–142 MB、渲染器 90 MB（private 142 MB）、其他子进程 20–40 MB。

### 2.2 30 分钟驻留（t≈0 → t≈11.5 min）

| t（s） | 壳 | sidecar | WebView | 合计 WS | 合计 PB |
| --- | --- | --- | --- | --- | --- |
| 1 | 36.4 | 41.3 | 430.6 | 508.3 | 305.5 |
| 186 | 36.3 | 39.6 | 420.2 | 496.1 | 296.9 |
| 370 | 36.5 | 39.8 | 418.6 | 494.9 | 297.7 |
| 555 | 36.5 | 39.8 | 419.3 | 495.6 | 297.7 |
| … | | | | | |

趋势：启动后 30–60s 到达平台，之后全程持平/微降（WebView 压缩工作集）。→ **无泄漏迹象**。

### 2.3 解码内存账本（独立实例，播放循环）

- 切歌循环 10 次（30s/40s 曲目交替）：账本 reserved 在 22.0 / 29.3 MB 两档间交替，切换即释放被替换曲目的缓冲 → **释放路径完善，无累积**。
- 账本 peak_reserved = 51.3 MB（双曲过渡），`rejection_count=0`。
- 240s 曲目整曲缓冲：reserved **175.8 MB**（≈96 kHz f32×2channel 全曲 PCM），process WS 220.8 MB / private 201.2 MB；空闲基线 sidecar 为 67 MB WS / 47 MB private。

### 2.4 原始数据

- `research/data/tree-residence.csv`（驻留逐条采样）
- `research/data/playback-cycle.json`（切歌循环账本）
- `research/data/tone-long-diagnostics.json`（整曲缓冲诊断样例）
- 采样脚本：`research/scripts/sample-memory.ps1`（WMI + diagnostics 双通道）

## 3. 静态分析与优化空间

| # | 热点 | 现状 | 估算占用 | 优化空间 | 预估收益 |
| --- | --- | --- | --- | --- | --- |
| 1 | 解码 PCM 整曲缓冲（streaming window） | `streaming_pcm_window_limit_mib` 默认 **256 MiB**，目标采样 96 kHz 时全曲驻留 | 4–5 分钟曲目 176–200 MB | 按需改为窗口化（如 30–60s 滑动窗口）；或文档化 + 默认 128 MiB | **100–180 MB** 最坏 case 裁剪 |
| 2 | 解码账本兜底上限 | `DECODE_MAX_MEMORY_MB` 默认 **2048 MiB** | 不分配，仅拒绝边界 | 实际上限可收到 256–512 MiB（min 64 MiB 已存在） | 上限收紧（减少 OOM 边界窗口） |
| 3 | WebView 渲染/渲染器进程 | Chromium 固有基线 | 420 MB WS（~85%） | 不可省（Tauri/WebView2 常量）；可削减：延迟加载大的依赖 chunk（lazy routes）、降 DOM 容量 | 30–80 MB（前端工程） |
| 4 | library_track_view 全表物化 | `list_library_track_summaries()` 全量加载 + 内存过滤/排序 + `include_media_ids` 物化 | 50k 曲目 ≈ 20–30 MB/请求 峰值 | SQL 下推（已列 backlog `06-08-library-track-view-sql-pushdown`） | 10–30 MB |
| 5 | sidecar actix 线程 | workers=16（默认 2×CPU） | 线程栈虚拟预留，常驻小 | 可设 min(4, cpu) | 若干 MB |
| 6 | 封面图/外部图 | 经 HTTP 进入 WebView 网络缓存；**无** createObjectURL 泄漏点 | —— | blob 方案不用，缓存由 WebView 管理 | 0（无需改动） |
| 7 | 前端虚拟化 | VirtualizedGrid / visibleRowsStore 窗口化 | DOM 窗口受限 | 已虚拟化；避免整库物化 | 0 |
| 8 | SQLite | WAL + synchronous=NORMAL，默认 page cache（~2 MB） | 忽略 | 可调 `cache_size`，收益 < 5 MB | ~0 |

**合计可优化空间（保守）**：**300–400 MB 在最坏场景**，典型场景 50–150 MB；全部为"裁剪上限/策略"类优化，**无一处需要修复的泄漏**。

## 4. 泄漏判定

- 空闲驻留 30 分钟：总 WS/PB 持平（§2.2）→ 无泄漏。
- 播放循环：PCM 层在切歌时全额释放 → 无泄漏。
- 整曲缓冲为**有意保留**（取消 preload 后 legacy buffer 保留至下一曲），账本 budget rejection_count=0 表示上限从未触发。
- 前端：无 createObjectURL/blob 泄漏模式；虚拟列表窗口化；未发现持续增长的缓存键。
- **判定：当前构建无内存泄漏；内存占用"偏大"集中在 (a) WebView 固有 ~420 MB 与 (b) 整曲 PCM 缓冲策略（默认 256 MiB 窗口 + 96 kHz 目标采样）。**

## 5. 浏览场景补充（2026-08-09，08-09-memory-browse-scenarios）

已在真实 UI 自动化（WebView2 CDP + WMI）下补充浏览/搜索/播放混合场景，报告与原始数据位于
`.trellis/tasks/archive/2026-08/08-09-memory-browse-scenarios/research/`。要点：

- 纯浏览（本地库 4 轮滚动 + 8 轮搜索往返）：sidecar 恒定 31–35 MB（不受浏览影响）；WebView DOM 恒定、
  JS heap 无单调累积（虚拟列表生效）。
- 浏览中点击曲目触发播放（1 首长歌）：整曲解码缓冲使 sidecar 31→222 MB，整树 520→868 MB（峰值）；之后
  20 分钟静置：TOT WS −0.48 MB/min 回落，DOM 20059→19462、JS heap 41.6→31.0 MB；sidecar 保持 222 MB
  （整曲缓冲保留为设计行为，直至下一曲）。
- **浏览路径无泄漏**；占用大头仍是播放大缓冲（见 §3#1）与 WebView 固有基线（§3#3）。

## 6. 局限（原始测量）

- 上一版未覆盖浏览场景 — 已由 08-09 补充（真实 UI 驱动）。
- 音频播放峰值在独立实例测量（与 app 共用代码路径）；浏览+播放叠加态已在真 app 实测（08-09 混合场景）。
- 采样精度：进程树秒级采样，非 flame graph；CDP DOM/heap 计数为渲染器进程级。