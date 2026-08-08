# 浏览场景内存补充测量（UI 自动化）

## Goal

弥补上一审计（08-08-memory-footprint-audit）的局限：通过真实 UI 自动化（WebView2 CDP）驱动浏览场景，测量整树内存占用在浏览/搜索/播放混合操作下的水平与增长曲线，判定浏览路径是否存在内存膨胀/泄漏，并复用/沉淀自动化脚本基建。

## Requirements

- 驱动方式：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动真实 app，Node（零依赖，全局 WebSocket/fetch）CDP 客户端 attach 页面 target 执行 DOM 操作。
- 场景（用户选定）：
  1. 本地库滚动：进入本地音乐库页，列表滚动到底再回顶，多轮（验证虚拟列表内存行为）。
  2. 在线搜索+详情往返：搜索关键词 → 结果 → 详情 → 返回，10+ 轮。
  3. 浏览+播放混合：上述浏览同时触发播放/切歌，观察叠加态。
- 采样：与浏览驱动并行，5s 间隔 WMI 进程树（壳/sidecar/WebView），并记录 WebView 渲染器 DOM 节点数/JS heap（CDP 采样）。
- 判定：每场景峰值/平台/回落；浏览循环多轮内存是否单调增长（阈值同前：>0.05 MB/min 且不回落 → 候选）。

## Acceptance Criteria

- [x] 三个场景均有 ≥1 轮完整自动化运行与同期进程树采样数据（原始 CSV）。【证据：S3 实测。A 本地库滚动 4 轮/B 搜索往返 8 轮/C 混合播放全流程完成；browse-mem.csv + settle-mem.csv 原始采样】
- [x] 每场景给出：开始/峰值/结束的 WS 与 PB（整树与逐进程）。【证据：report-browse.md 场景表（整树 WS 520→868→818 MB；sidecar 31→222 MB；WebView 545-605 MB）逐进程明细见 CSV】
- [x] CDP 侧记录 DOM 节点数与渲染器 heap 变化趋势（≥1 场景，作为 WebView 内部状态证据）。【证据：scene-browse 全程 DOM/heap mark 点（nodes 1149→20059，JS heap 5.4→41.6 MB，见 browse-scene-log.txt）+ probe-final 终态 19462/31.0MB】
- [x] 明确判定：浏览场景无泄漏 / 候选点 X（含复现轮次与证据）。【证据：判定无泄漏。纯浏览 DOM/heap 零累积；播放后 20 分钟 TOT WS −0.48 MB/min 回落；sidecar 整曲缓冲为设计保留】
- [ ] 自动化脚本沉淀：`research/scripts/cdp-drive.mjs`（CDP 客户端）+ 场景脚本，可复跑。 【证据：cdp-drive.mjs（零依赖 CDP 客户端）+ scene-browse.mjs + ui-utils.mjs + sample-tier.ps1，复跑命令记录于报告】
- [x] 结论并入原审计报告（archive/2026-08/08-08-memory-footprint-audit/research/report.md 增补章节）或新小节。【证据：archive/2026-08/08-08-memory-footprint-audit/research/report.md §5 浏览补充 + §6 修订局限】