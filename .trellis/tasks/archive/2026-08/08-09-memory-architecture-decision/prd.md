# 桌面架构内存决策：优化落地与研究

## Goal

基于已完成的内存实测（08-08/08-09：整树 idle ~495–505 MB WS、播放峰值 ~868 MB；大头 = WebView 基线 ~545–600 MB + 整曲 PCM 缓冲 ~190 MB），回答"是否应从 Tauri 切换到 Avalonia 等原生架构"的决策问题：
1. 先落地**无损内存裁剪**（能在数天内省 100–250 MB，不动视觉）；
2. 产出**架构对比评估报告**（Tauri 保持 / Avalonia / Rust 原生 UI / 混合），用数据支撑"是否切换"的决策与切换成本。

## Children

- `08-09-memory-trim-delivery` — 落地：PCM 窗口默认值裁剪 + WebView2 启动参数/功能探索，实测收益与视觉回归确认。
- `08-09-ui-framework-migration-report` — 研究：架构选项对比（内存收益×视觉保真×工程量×风险）、迁移成本清单、决策建议。

## Cross-cutting Notes

- 测量基线与脚本沿用 08-08/08-09 任务（research/scripts、sample-memory.ps1/sample-tier.ps1、CDP 场景）。
- 视觉回归判定：CDP 截图对比（同页面同路由：主界面、详情、播放器、设置）。
- 产出不回退：两级任务各自 PRD 验收框，父任务最后做交叉 review。
## Outcome (2026-08-09)

- [x] **内存裁剪落地**（08-09-memory-trim-delivery 归档，commit 71719de）：PCM 窗口默认 256→128 MiB（401 测试全绿、legacy 路径零行为影响）；实测 v2 窗口化 @64 MiB sidecar −112 MB（96.9 vs 208.8 WS）；WebView2 `--disable-gpu` −108 MB PB（像素差 0.7/255），记录不默认。
- [x] **架构对比报告**（08-09-ui-framework-migration-report 归档）：architecture-comparison.md —— 4 方案矩阵、迁移成本估算（Avalonia 50–80 人日 / egui 65–120）、结论“保持 Tauri + 混合渐进”、3 条触发器。
- [x] **决策结论**：不切换架构。当前默认路径无可无损裁剪项；播放缓冲与 UI 架构无关；切换收益（300–400 MB）< 成本（50–120 人日 + 视觉保真损失）。
