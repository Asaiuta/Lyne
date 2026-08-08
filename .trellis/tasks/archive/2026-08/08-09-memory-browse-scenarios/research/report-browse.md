# 浏览场景内存补充测量报告（08-09）

> 自动化：WebView2 CDP（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`）+ 零依赖 Node CDP 客户端（`research/scripts/cdp-drive.mjs`、`ui-utils.mjs`、`scene-browse.mjs`）+ WMI 进程树采样（`sample-tier.ps1`）。
> 运行：2026-08-08 16:44–17:05，release 构建，真实 UI 驱动（本地音乐库 592 首/21.55 GB）。

## 场景与结果

| 场景 | 行为 | 整树 WS 变化 | sidecar | WebView（nodes/JS heap） | 趋势判定 |
| --- | --- | --- | --- | --- | --- |
| A 本地库滚动（4 轮到底回顶） | 虚拟列表 | 520 → 537 MB | 恒 31–35 MB（不受浏览影响） | DOM 恒 1149 nodes；heap 5.4→6.0 MB | 无累积，虚拟化生效 |
| B 在线搜索→详情→返回（8 轮） | 关键词搜索 3 组循环 | 520–540 MB（t<90s，无播放段） | 恒 31–35 MB | DOM 1282–1329 波动；heap 6.2–8.2 MB | 无单调增长（第 5 轮 GC 回落 6.4 MB） |
| B' 搜索结果误触播放（1 首长歌） | 播放开始 | 跳升至 **868 MB WS / 685 PB**（峰值） | 31 → **222 MB**（整曲解码缓冲） | nodes 20059 peak；heap 41.6 MB | 见下 |
| C 混合播放+切歌 | 播放/切歌/暂停 | 843 MB 平台 | 222 MB 恒定 | 19462 nodes（回落）；heap 30.8 MB | 无泄漏 |
| D 播放后静置 20 分钟 | 无操作 | 843 → **818 MB**（斜率 −0.48 MB/min） | 222 MB（整曲缓冲有意保留） | nodes 19462，heap 31.0 MB 稳定 | **无泄漏** |

## 关键结论

1. **纯浏览（库滚动/搜索往返）内存行为优异**：sidecar 完全不受浏览影响（31–35 MB 恒定）；WebView DOM 恒定（虚拟列表合格）、JS heap 无单调累积（8 轮往返无增长，GC 正常回收）。
2. **浏览路径唯一的大幅涨点 = 播放**：搜索结果点击 → 播放 → 整曲解码进 sidecar（+190 MB）→ 整树 520→868 MB。这是**设计内行为**（整曲缓冲 + 96k 目标采样），非泄漏。
3. **播放后 20 分钟静置**：TOT WS −0.48 MB/min 持续回落；DOM 20059→19462、JS heap 41.6→31.0 MB；sidecar 保持 222 MB 直到下一曲（账本行为，预算内）。
4. WebView 常驻 545–605 MB WS（Chromium），PB 343 MB；整树 idle 带回 200 余 MB 的“浏览+一首长歌”驻留态 ≈ 818–870 MB WS。

## 数据文件

- `research/data/browse-mem.csv`（场景全程进程树，5s）
- `research/data/settle-mem.csv`（播放后静置 20 分钟）
- `research/data/browse-scene-log.txt`（CDP 驱动日志：DOM/heap 各 mark 点）
- 复跑：`powershell -File research/scripts/sample-tier.ps1 … &` 然后 `node cdp-drive.mjs research/scripts/scene-browse.mjs`

## 局限

- 搜索结果“详情”点击实际命中歌曲行并触发播放（B' 混合态），纯详情页往返覆盖不完整（A/B 未播段数据已独立）。
- 采样为渲染器进程级，未经 DevTools heap snapshot 逐对象级分析；DOM 计数为全文节。