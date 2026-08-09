# Streaming v2 窗口化默认化

## Goal

把解码路径从 legacy 全曲缓冲（240s 曲目 sidecar ~209 MB、账本 175.8 MB）切换为 **streaming v2 窗口化**（实测 @128 MiB：161.1 MB；@64 MiB：96.9 MB），使内存收益默认化（−48~−112 MB），同时保持播放行为/性能不回退。

## Requirements

1. **默认切换**：`EngineSettings::default()` `streaming_first_buffer = true`；`AUDIO_STREAMING_FIRST_BUFFER` env 默认 true（用户/dev 可用 env=false 回滚）；窗口默认 128 MiB（已落地 08-09 trim）。
2. **边界保持**：`use_cache=true`（AUDIO_USE_CACHE）时继续禁用 v2（沿用现存条件）；credentials(HTTP 带凭据) 场景保持 legacy（既有分支），若 v2 支持则按现状不动。
3. **回归门禁**（必须全绿才能验收）：
   - 播放：本地文件播放 240s restore、暂停/恢复/音量/EQ 生效；
   - **seek**：向前/向后多段（含跨窗口边界），位置误差 ≤ ~0.1s；
   - **gapless**：2 曲连续（preload 双缓冲）；账本 rejection_count 不新增；
   - **流媒体 URL**：远程 http 播放 + URL 插件路径（AUDIO_URL_PLUGIN 若在回归范围）；
   - **频谱/可视化数据**：谱数据继续有效（v2 事件流不变）；
   - 缓存/配置持久化不变（audio_settings.json 兼容）。
4. **性能**：cargo bench（如 engage）无显著退化；cargo test 401 全绿 + clippy 无新增。
5. **实测对比**：同 240s 曲目（或最长本地曲）前后 sidecar WS/PB + 账本（一读下 64MiB 窗口是否作为默认——默认 128 vs 64 取舍，若 64 满足长曲需求则采纳 64 默认并记录；若窗口 rejection 风险大则保 128）。

## Acceptance Criteria

- [x] 默认切换落地（config/env/settings 三处一致），env=false 可回退（含已存在配置文件：env 覆盖已补）。
- [x] 回归门禁全绿（播放/seek/gapless/暂停恢复逐项记录于 verification-report.md §1）。
- [x] 实测：480s 曲目 ledger WS 对照（legacy 351.6MiB/399MB vs v2 128.1MiB/175MB，−224MB），数据入库。
- [x] cargo test 403/403 绿、clippy 无新增、typecheck/build 通过。
- [x] 窗口默认值决策（128 vs 64）有数据依据 → 保 128（长曲滑动窗口/rejection 权衡，见报告 §3）。
- [x] 报告 + 归档（含回滚说明）。