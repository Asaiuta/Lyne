# Implement — 浏览场景内存补充测量

## 阶段 0：准备
- [ ] 确认 app 以 release 二进制 + CDP 端口 9222 启动，`/json` 可见 tauri.localhost target（已完成验证）。
- [ ] 写 `research/scripts/cdp-drive.mjs`（CDP 客户端框架：connect/list/evalJs/wait）。
- [ ] 发现遍历：dump nav 文本/DOM 关键选择器 → 确定场景脚本定位方式。

## 阶段 1：三个场景
- [ ] scene-library：本地库列表多轮滚动 + DOM 节点统计。
- [ ] scene-online：搜索→结果→详情→返回 ×10 轮 + DOM 节点统计。
- [ ] scene-mixed：浏览 + 播放/切歌混合。
- 每个场景：并行 WMI 采样器记录全进程树（5s），场景脚本输出自身时间线与节点数 JSON。

## 阶段 2：分析
- [ ] 逐场景：整树/逐进程 WS/PB 开始-峰值-结束；多轮趋势斜率。
- [ ] CDP DOM 节点与 heap 变化趋势对照 WebView 内存。
- [ ] 泄漏判定（浏览路径）：单调增长 + 不回落 → 候选；否则无泄漏。

## 阶段 3：报告与收尾
- [ ] 增补归档报告（archive 08-08 report.md）浏览场景章节 + 修订其 §5 局限。
- [ ] 数据：research/data/browse-*.csv|json。
- [ ] 任务 PRD 勾选 + journal + commit + archive。

## 验证命令
```bash
powershell -File .trellis/tasks/08-09-memory-browse-scenarios/research/scripts/sample-tier.ps1 &  # 背景采样
node research/scripts/scene-library.mjs   # 或 scene-online / scene-mixed
```