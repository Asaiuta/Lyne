# 架构对比评估（ui-framework-migration-report）

## Goal

产出书面决策文档：Tauri(WebView2) 保持 vs Avalonia(.NET) vs Rust 原生(egui/iced) vs 混合架构。以项目实际数据（08-08/08-09 内存实测、前端资产规模、SPlayer parity 投资、sidecar 边界）为核心论据。

## Requirements

- 对比维度：内存基线（估算区间，引用实测）、视觉保真可行度（CSS 资产 → 各框架复刻成本与上限）、工程量（行数级估算基于现有前端规模）、技能栈/CI/分发变化、运行时成本（.NET/WebView2）、风险（迁移期间双轨）。
- 覆盖事实：当前前端资产（apps/desktop/src 规模、虚拟列表、SPlayer parity 20+ 任务、AMLL 歌词渲染计划（canvas））、Rust 边界（audio_engine lib + audio_server sidecar 可复用）、检测体系（bench + CDP 自动化可迁移性）。
- 决策建议：明确“保持 / 渐进混合 / 切换”三档建议 + 触发器条件（如：若未来 <300 MB 硬指标、同步视觉需求消失等）。

## Acceptance Criteria

- [ ] 报告含 ≥4 个候选方案的矩阵表（内存/视觉/工程量/风险/迁移成本）。
- [ ] 至少 1 个方案的量化迁移成本清单（按现有代码库估算，人日级）入准。
- [ ] 引用实测数据（2026-08-08/09 报告与 CSV）作为内存侧依据。
- [ ] 明确的行动建议（保持-优化/混合/切换）及触发器条件。
- [ ] 产出文档入库：`research/architecture-comparison.md`。