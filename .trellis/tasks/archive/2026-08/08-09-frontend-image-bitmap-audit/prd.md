# 前端图片位图内存审计（frontend-image-bitmap-audit）

## Goal

量化 renderer（主窗口 WebView）内**图片位图/解码纹理**的内存占比：此前 memory audit（08-08/09）只测了 DOM/JS heap（31 MB 级），未覆盖绕过 JS heap 的解码位图。本任务先摸清，为"是否值得做图片懒加载/尺寸剪裁优化"提供数据。

## Method

- 真实 app + CDP（沿用 08-09 自动化栈：cdp-drive/ui-utils、sample-webview.ps1 WMI 采样）。
- 逐场景测量 renderer 进程 WS/PB 增量 + CDP `Runtime` 的 JS heap + `Performance` 资源条目（图片请求数/字节）。
- 场景设计（图片密度从高到低）：发现/首页网格 → 本地库网格 → 专辑详情（大封面）→ 设置页（无图基线）。
- 每场景进入后等待稳定（≥8s）再采样；相邻场景差异归因于页面内容（无图基线用于剥离固定成本）。

## Acceptance Criteria

- [x] 每场景输出：renderer WS/PB、JS heap、图片请求数/字节、网格节点数 —— 数据入 `research/data/image-bitmap.csv` + 报告。 【证据：image-timeline.jsonl 5 场景 × rendererWS/PB/JS heap/DOM/imgs/位图估算 + report §1】
- [x] 归因（report §2）：位图+DOM 增量 22–43 MB（list 223.6 vs discover 180.3 PB）；renderer ~150 MB 为平台成本（discover/settings ≥180 佐证）。
- [x] 结论（report §3）：优化上限 30–45 MB= 歌曲列表虚拟化（已在 07-16 任务路线）；图片专用优化 ≤20 MB 不建议立项。
- [x] 衔接：修正架构报告中 renderer 口径（~150 MB 平台成本 + ~15–25% 内容增量），见 report §3。