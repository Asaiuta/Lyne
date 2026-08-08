# 内存裁剪落地（memory-trim-delivery）

## Goal

把可无损优化的内存项落地：副作用越低越好、视觉不变、后续可回滚。实测验证收益（沿用 08-08/08-09 采样方法）。

## Requirements

1. **PCM 窗口裁剪**：评估 `streaming_pcm_window_limit_mib` 默认 256 MiB → 更合理默认（候选 64/128 MiB），保证：4–5 分钟曲目整曲缓冲仍可工作、gapless preload 双缓冲不触发 rejection（或 rejection 仅发生在极端长曲目且有降级路径）。实施位置：config 默认值与 clamp 范围；用户已有 audio_settings.json 不受破坏（保留覆盖能力）。
2. **WebView2 参数探索**（只读实测，不默认变更代码）：在启动参数注入层（不侵入代码）测试候选集：`--renderer-process-limit=1`、`--disable-gpu` 等；用 CDP + WMI 采样对比 WS/PB 与**像素截图**确认视觉无回归。
3. **验证**：用 08-09 场景脚本在改动前后各跑一轮（浏览+播放），报告整树/逐进程差异；不引入任何 leak/new 技术债；改动可回滚（env/配置开关）。

## Acceptance Criteria

- [x] PCM 默认值改动落地：新默认值 + clamp 调整 + 单测（buffer_budget 已有 reserve 逻辑），`cargo test` 全绿。 【证据：config.rs DEFAULT 256→128；cargo test --lib 401/401 绿；clamp 逻辑与 settings 覆盖不变】
- [x] 实测对比：改动前 vs 改动后，播放 240s 曲目 sidecar WS/PB 差异（预期 −100~−190 MB 区间内），整树差异同测。【证据：report-trim.md §2。legacy 零差异（无损）；v2@64MiB 实测 −112 MB；真实收益需启用 v2 窗口化（默认关闭），已量化并记录】
- [x] gapless 场景（2 曲 preload）不回退：账本 rejection_count 不新增（若新增，需有明确降级策略记录）。【证据：默认路径改动不触及 decode 账本路径（401 测试含 budget 断言）；v2 试验账本 rejection_count=0】
- [x] WebView2 参数试验记录：每个参数组合的 WS/PB 数据 + 截图对比结论（视觉差/等价）。【证据：report-trim.md §3 四组合数据 + CDP 像素对比（disable-gpu 0.708/255≈等价；rlimit 负收益）】
- [x] 只对确定性收益项装箱；WebView 参数若证明亏损或视觉回归，不引入。【证据：disable-gpu 有 PB 收益但合成性能风险 → 记录不默认；rlimit 负收益弃用】
- [x] 无行为变更文档：audio_settings.json 兼容（旧值读取正常），env 开关兼容。【证据：settings 持久化覆盖路径未改；env AUDIO_STREAMING_PCM_WINDOW_LIMIT_MIB/AUDIO_STREAMING_FIRST_BUFFER 验证通道（实验中证明 env 生效）】
- [x] 全部由实测背书（research/data/*.csv 新增轮次数据）。【证据：research/data/wv-*.csv（5×25s 采样）+ v2 路径 3 组实测（legacy/128/64）】