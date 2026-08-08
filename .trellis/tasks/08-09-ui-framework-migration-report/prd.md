# 架构对比评估（ui-framework-migration-report）

## Goal

产出书面决策文档：Tauri(WebView2) 保持 vs Avalonia(.NET) vs Rust 原生(egui/iced) vs 混合架构。以项目实际数据（08-08/08-09 内存实测、前端资产规模、SPlayer parity 投资、sidecar 边界）为核心论据。

## Requirements

- 对比维度：内存基线（估算区间，引用实测）、视觉保真可行度（CSS 资产 → 各框架复刻成本与上限）、工程量（行数级估算基于现有前端规模）、技能栈/CI/分发变化、运行时成本（.NET/WebView2）、风险（迁移期间双轨）。
- 覆盖事实：当前前端资产（apps/desktop/src 规模、虚拟列表、SPlayer parity 20+ 任务、AMLL 歌词渲染计划（canvas））、Rust 边界（audio_engine lib + audio_server sidecar 可复用）、检测体系（bench + CDP 自动化可迁移性）。
- 决策建议：明确“保持 / 渐进混合 / 切换”三档建议 + 触发器条件（如：若未来 <300 MB 硬指标、同步视觉需求消失等）。

## Acceptance Criteria

- [x] 报告含 ≥4 个候选方案的矩阵表（内存/视觉/工程量/风险/迁移成本）。 【证据：architecture-comparison.md §2（4 方案 × 7 维）】 【证据：architecture-comparison.md §2 矩阵（Tauri/Avalonia/egui-iced/混合 × 7 维度）】
- [x] 至少 1 个方案的量化迁移成本清单（按现有代码库估算，人日级）入准。 【证据：§3 估 50–80／65–120 人日（基于 512 文件／196 组件／106.4K 行）】 【证据：§3 清单 50–80（Avalonia）/65–120（egui）人日（基于 512 文件/196 组件/106.4K 行实测数）】
- [x] 引用实测数据（2026-08-08/09 报告与 CSV）作为内存侧依据。 【证据：§1（空闲 495–505 MB、播放峰 868 MB、disable-gpu −108 PB、v2 −48~−112 MB）】 【证据：§1 全表引用 08-08/09/trim 实测（空闲 495–505 MB、播放 868 MB、disable-gpu −108 PB、v2 −48~−112 MB）】
- [x] 明确的行动建议（保持-优化/混合/切换）及触发器条件。 【证据：§5 结论“保持 Tauri + 混合渐进”、3 条触发器（<300 MB 硬指标/原生视觉转向/技术栈偏好）】
- [x] 产出文档入库：`research/architecture-comparison.md`。 【证据：文件已提交】 【证据：文件存在且已提交（8cd335a 前提交内容含其初次版本）】