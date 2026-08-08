# 内存占用与泄漏审查

## Goal

审查 AudioPlayer 运行时的内存占用：实测当前进程树（Tauri 壳 / WebView / Rust audio sidecar）的内存占用水平与稳定性；静态分析内存热点路径；判定是否存在内存过大、内存泄漏；量化优化空间并交付报告。

## Requirements

- 覆盖典型运行场景：冷启动→空闲驻留；浏览本地库/在线页（虚拟列表、封面加载）；播放/切歌/暂停（解码缓冲、环形缓冲、预载）；长时间驻留（≥30 分钟）检测单调增长。
- 实测数据来源：内建 `/diagnostics/runtime`（进程树 working set/private bytes + 解码内存账本 + 预算），另用 OS 级采样（PowerShell/CIM）交叉验证与补足 WebView 子进程。
- 静态分析：解码内存账本与 `decode_max_memory_mb` 预算、环形缓冲/重采样缓存/gapless preload、前端封面/歌词/列表虚拟化缓存、SQLite 全量加载点（如 library_track_view、历史/会话表）。
- 判定规则：单进程 private bytes 在负载后不回落且持续单调增长（扣除缓存陡增）→ 列为泄漏候选，给出复现路径与证据；缓存有明确上限且到达后平台回落 → 非泄漏。
- 交付物：报告 md（现状占用表、场景趋势图数据、泄漏判定、优化空间清单每项含量级估算）+ 原始采样数据 + 于可复现的采样脚本。

## Acceptance Criteria

- [x] 实测覆盖 4 个场景（冷启动/浏览/播放/驻留），每场景给出进程树逐进程 working set 与 private bytes。【证据：S3 实测。冷启动/驻留=整树 CIM 采样（31 min/182 点）；播放=独立实例 10×切歌循环+240s 整曲缓冲；浏览=WebView 基线+静态（无 UI 自动化，见报告 §5 局限）】
- [x] 30+ 分钟驻留趋势数据（≥6 个采样点）支撑"无泄漏"或"泄漏候选 X + 复现条件"的明确判定。【证据：31 分钟 182 采样点，WS 斜率 −0.29 MB/min、PB −2.04 MB/min（负），净变化 −16.3/−24.8 MB → 判定无泄漏】
- [x] 静态热点清单 ≥ 8 项，每项含现状、优化空间、预估收益（MB 量级）。【证据：report.md §3 共 8 项热点（解码窗口/预算/WebView/DB 视图/线程/前端缓存/虚拟化/SQLite），收益量级 300–400 MB 最坏场景】
- [x] 报告注明测量环境（构建、OS、WebView 版本、采样方法）与测量局限。【证据：report.md §1 环境 + §5 局限（无 UI 浏览驱动、音频独立实例、秒级采样）】
- [x] 无伪数据：所有数字可回追溯到采样脚本输出文件。【证据：research/data/tree-residence.csv（原始采样）+ playback-cycle.json + tone-long-diagnostics.json + research/scripts/sample-memory.ps1】

## Notes

- 本任务只测量与报告，不修改产品代码；修复项作为后续任务（或在 backlogs 中登记）。
- 交互存在 GUI 自动化（.playwright-cli/ 既有历史）时用其驱动场景；否则用既有 API（/api/... 播放、/state）驱动。