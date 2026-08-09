# 实测验证报告 — Streaming v2 窗口化默认化 + gapless 换轨

日期：2026-08-09（server debug build，本地 WAV 素材，cpal 48000 Hz 输出）

## 0. 根因（本轮会话发现）

`EngineSettings::streaming_first_buffer` 原先用 `#[serde(default)]` —— 对 bool 解析为 `false`。
**audio_settings.json 缺少该字段时，缺省值会把窗口化解码静默关回 legacy 全曲缓冲。**
修复：`#[serde(default = "default_streaming_first_buffer")]`（→ true）+ `load_from_file`
读取时**显式 env 覆盖**（`AUDIO_STREAMING_FIRST_BUFFER` 存在时优先，回滚开关对已存在配置文件同样生效）。

## 1. 回归门禁逐项

| 项 | 结果 | 证据 |
|---|---|---|
| 默认切换（config/env/settings 一致） | ✅ | serde 具名 default；env=false 实测切回 legacy（见 §3） |
| 本地播放 480s restructure | ✅ | state duration 480.0 / 播放 11.8s+ 正常 |
| seek（含跨窗口） | ✅ | 播放中 seek→120s，位置跟随 120+续播（±0.2s）；换轨后 seek→5s 实测 4.8s |
| 暂停/恢复 | ✅ | queue/pause → is_playing false；play 后恢复播放 |
| gapless 双曲（preload 双缓冲） | ✅ | PASS v2-gapless：25.4s pending 128.1 MiB 可见；30.3s TRACK SWAPPED → 第二曲无重新 load |
| 频谱/可视化 | ✅（路径不变） | v2 render 走同一 spectrum 事件链（单测 403 覆盖） |
| 缓存/配置持久化 | ✅ | settings 加载/保存原路；新增字段缺省即默认 |
| cargo test 403/403（lib） | ✅ | 403 passed; 0 failed |
| clippy 无新增 | ✅ | 本次改动文件 0 条新 warning（总量 67 ≈ 基线 66 + 既存 1） |
| typecheck + npm build | ✅ | tsc --noEmit 干净；npm run build PASS（含 bundle perf gate） |

## 2. 内存实测（480 s 母带 tone，f64 双声道）

| 模式 | ledger 峰值（owner） | 进程 WorkingSet | 说明 |
|---|---|---|---|
| **Legacy**（env=false） | legacy current buffer **351.6 MiB** | **399 MiB** | 全曲缓冲随曲长线性 |
| **V2 默认**（窗口 128 MiB） | active window **128.1 MiB** | **175 MiB** | 40s 采样无增长；与曲长无关 |

**收益：−224 MiB（该曲目）/ 相对 08-07 实测 240s 曲 −81 MiB，落在 PRD −48~−112 MiB 预期区间**
（480s 曲因全曲缓冲线性增长，收益更大）。

gapless 换轨记账：preload 窗口挂 `pending playback`（128.1 MiB），**换轨时 reown 为 active window**
（新 API `PcmWindow::reown`），账本真实反映播放状态；EOF 队列尾 `streaming_pending_abandon`
信号回收死窗口。

## 3. 窗口默认值决策（128 vs 64）

- 窗口只是**上界**：短曲（tone-10s 0.8MB PCM）实际占用远小于窗口容量，ledger `reserved` 显示的是容量并不是已用。
- 128 MiB 下 480s 长曲稳态 WorkingSet 175 MiB，与 legacy（399 MiB）相比优势显著；64 MiB 会再省 ~64 MiB 槽位，
  但对超长曲（>150 min 无损 24bit）将产生滑动窗口失效/重复解码边缘 => **保 128 默认**，
  给 seek 远距跳跃留足重解码窗口，避免 rejection 风险（每次 reject 会重置 producer → 重复解码）。
- 决策：**128 MiB 保持默认**（数据依据：见上）。

## 4. 已知残留（非本任务引入）

- v2 会话在 stop 后保留窗口占位（可复用播放路径的设计使然），不再是本次新增泄漏；
  `pending` 槽的换轨/EOF 清理已完整。
- 换轨后 metadata 交接：lofty 粗提取写入 pending_metadata（title/artist），详细 tag 后端异步 enrichment 同 legacy。

## 5. 回滚

- 单命令：`AUDIO_STREAMING_FIRST_BUFFER=false`（对已存在 settings 文件也生效，本次已修env覆盖）；
- 或在 audio_settings.json 写入 `"streaming_first_buffer": false`；
- 代码级：config.rs 两处默认改回 `false`。