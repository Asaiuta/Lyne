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

## 3.1 64 MiB 对照实测（2026-08-09）

同机同曲（480 s tone + 10 s tone 队列）对照一轮：20 次跨窗 seek（随机远距，map 到 `/seek`
真实端点）+ gapless 换轨，128 与 64（`AUDIO_STREAMING_PCM_WINDOW_LIMIT_MIB=64`）各一遍：

| 指标 | 128 MiB | 64 MiB |
|---|---|---|
| 480s 曲稳态 WorkingSet | 174.4 → 175.6 MB | 110.3 → 111.5 MB（**−64 MB，−37%**）|
| active 窗口记账 | 128.1 MiB | 64.1 MiB |
| 20× 跨窗 seek 误差（1.6s settle 后）| max 1.64 s / mean 1.62 s | max 1.63 s / mean 1.61 s |
| ledger rejection / budget rejection | 0 / 0 | **0 / 0** |
| gapless 换轨（480→10 s）| 成功 | 成功 |
| gapless 双窗口峰值记账 | 256.3 MiB* | active 64.1 + pending 64.1 = 128.1 MiB |

\* 128 轮早期记账口径（owner 参数落地前），64 轮为 owner 修复后读数。

关键结论：
1. **64 MiB 完全可用**：20 次满窗状态下的跨窗 seek 零 rejection、零欠载，重解码换窗在
   settle 窗口（1.6 s）内完成；误差差值与 settle 时间一致（实际位置偏差 ~0.02–0.03 s）。
2. 物理内存与窗口容量 1:1 对齐：窗口减半 → WS 减 ~64 MB，说明 128 MiB 槽位正是物理
   占用主体（server 基线 ~42 MB + 窗口页 + 杂项）。
3. 64 MiB 窗口 ≈ 87 s（44.1/16 f64 立体声），>150 min 无损 24bit 的超长曲滑动窗口
   边缘理论仍在；但 rejection（=producer 重置重复解码）风险实测未发生——64 轮 20 次
   跨窗 seek 无一次 reject。默认保 128 不变（保守 + 远跳留余量），64 已可作为低内存
   档位一行切换（见 §5）。

## 3.2 swap 旧窗口释放（owner-transfer 修复，2026-08-10）

**排查中揭示一个更深的既有缺陷**：gapless 换轨此前"看起来成功"（无 reload、位置计数归零），
实际是**假象**——preload 会话与 active 会话共用 `load_generation`（同 generation），
`CallbackWindowCache` 只按 generation 换 reader，**换轨后 callback 仍读旧曲目窗口**：
tone 素材无法听辨内容，之前的"无缝"验证全部无效；且旧窗口被 cache reader 持有，
**PcmWindow 永不 drop**（物理页 + ledger 128.1 MiB 永久滞留）——这就是 §4 曾记录
"记账滞留"的真正根因，不是 owner-transfer API 缺失。

修复（最小侵入）：
- `CallbackWindowCache::refresh` 增加 `reader 缺失时重绑` 条件（swap 重置后下一帧自动
  adopt 新 rt 的窗口）；新增 `retire_reader()`。
- `try_activate_pending_v2`（callback 线程）swap 时显式 `retire_reader`（旧窗口 Arc 进
  retire 队列，audio 线程 drop）——旧窗口真正释放。

实测（64 MiB 档，480 s → 880 Hz 10 s 双曲 + 三曲连放）：
| 指标 | 修复前 | 修复后 |
|---|---|---|
| swap 后 ledger `active window` | 128.1 MiB（滞留）| **64.1 MiB** |
| `PcmWindow drop` | 从未发生 | swap 后立即 drop（origin=440 s 帧）|
| swap 后 WorkingSet | 126.3 MB 不回落 | **118.7 → 54.9 MB**（= 基线 47.4 + 10s 曲实际页）|
| 连续两次 swap（三曲连放）| 未验证 | 全绿，ledger 每次归零 |
| 20× 跨窗 seek + rejection | — | 无回归（1.62 s / 0 reject）|

注：跨窗 seek（`apply_source_seek`）不受影响——它重置的是**同一窗口**（epoch++），
reader 的窗口 Arc 不变，数据源天然正确；只有换轨涉及**新窗口**，故仅 swap 需显式重绑。

## 4. 已知残留（非本任务引入）

- v2 会话在 stop 后保留窗口占位（可复用播放路径的设计使然），不再是本次新增泄漏；
  `pending` 槽的换轨/EOF 清理已完整。**swap 场景的窗口滞留已由 §3.2 修复**；
  stop 场景（保留复用）仍属设计行为，如需 release 可后续再评估。
- 换轨后 metadata 交接：lofty 粗提取写入 pending_metadata（title/artist），详细 tag 后端异步 enrichment 同 legacy。

## 5. 回滚与档位切换

- 单命令：`AUDIO_STREAMING_FIRST_BUFFER=false`（对已存在 settings 文件也生效，本次已修env覆盖）；
- 或在 audio_settings.json 写入 `"streaming_first_buffer": false`；
- 低内存档位：`AUDIO_STREAMING_PCM_WINDOW_LIMIT_MIB=64`（本次对照中顺带补齐 `load_from_file`
  的 env 显式覆盖，此前与 first_buffer 一样只对文件缺失路径生效——已存在配置文件时被静默忽略）；
- 代码级：config.rs 两处默认改回 `false`。

## 6. 前端默认值契约收口（2026-08-10）

全量前端测试新增的 Rust/TypeScript 契约检查发现唯一失败：Rust
`DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB=128`，而设置表单在没有持久化快照时仍回退到
`256`。这不是 gapless 双窗口峰值，而是默认值跨层漂移。前端缺省值与对应模型测试已同步为
`128`；用户已持久化的合法窗口值不受影响。

最终门禁：
- `npm test`：521/521；bundle policy、provenance utils、Lyne sub-gates 全绿；
- `npm run typecheck`、`npm run build`（含 bundle policy）通过；
- `cargo test --lib`：403/403；`cargo clippy --lib` 通过（仅既有告警）；
- 本任务 12 个 Rust 文件经 rustfmt 后逐文件 `--check` 通过；工作区级
  `cargo fmt --all -- --check` 仍只被任务外的 `src/bench_gate.rs` 与
  `src/bench_provenance.rs` 历史格式漂移阻断，未扩大本任务提交范围。
