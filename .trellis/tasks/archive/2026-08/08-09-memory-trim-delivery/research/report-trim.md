# 内存裁剪落地报告（08-09-memory-trim-delivery）

> 实施日期：2026-08-08/09。release 构建（audio_engine v2.0.0），独立 sidecar 实例 + 真实 app CDP/WMI 采样，方法沿用 08-08/08-09 审计任务。

## 1. PCM 窗口默认值裁剪（已落地）

**变更**：`src/config.rs` `DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB: 256 → 128`（`MAX=4096`、clamp 逻辑不变，settings 持久化覆盖能力保留）。

**验证**：
- `cargo test --lib` 401/401 通过（含 `engine_settings_default_uses_persistent_defaults`、`engine_settings_normalized_clamps_streaming_pcm_window_limit`）。
- legacy 播放路径（当前默认）实测 240s 曲目：改动前后 sidecar **无差异**（208.8 vs 220.8 WS，账本 175.8 MB 一致）→ 无损。
- 该值只约束 streaming v2 窗口会话（`PersistentStreamingSession`），默认 `StreamingFirstBuffer=false` 时无行为影响。

## 2. 解码路径实测对比（240s 曲目 @48kHz 输出）

| 路径 | sidecar WS | sidecar Private | 解码账本 | 相对 legacy |
| --- | --- | --- | --- | --- |
| legacy 全曲缓冲（当前默认） | 208.8 MB | 199.1 MB | 175.8 MB | — |
| v2 窗口化 @128 MiB（env） | 161.1 MB | 151.9 MB | 128.1 MB | **−48 MB** |
| v2 窗口化 @64 MiB（env） | 96.9 MB | 87.6 MB | 64.1 MB | **−112 MB** |

- v2 路径功能验证：播放（is_playing）、seek（`{"position":180}` → 183.1/240）、切歌均正常；账本 owner 从 legacy current buffer 变为 active window（窗口化语义正确）。
- **结论**：190 MB 级单曲缓冲的真正来源是 legacy 全曲解码路径（`decode_file_internal` 全曲 f64 PCM 驻留）。启用 v2 窗口化（`AUDIO_STREAMING_FIRST_BUFFER=true`）+ 64 MiB 窗口可省 ~112 MB，但这是**行为变更**（解码路径切换），需单独任务做全量播放回归（seek/gapless/preload/频谱/流媒体）后默认化。本任务不默认启用。

## 3. WebView2 启动参数试验（真实 app，35s 稳定后 25s 采样 + CDP 截图）

| 参数 | WebView 树 WS | WebView 树 PB | 进程数 | 像素差（vs 基线） |
| --- | --- | --- | --- | --- |
| 基线（无） | 463.4 MB | 307.4 MB | 6 | — |
| `--renderer-process-limit=1` | 492.6 MB | 293.4 MB | 7 | 0.003/255 |
| `--disable-gpu` | **446.1 MB** | **199.7 MB** | 6 | 0.708/255 |
| `--disable-gpu --renderer-process-limit=1` | 450.2 MB | 203.7 MB | 6 | 0.708/255 |

- `--disable-gpu`：WS 省 17 MB、**PB 省 ~108 MB**（GPU 进程 + 共享显存消失），像素差异 0.7/255 ≈ 不可感知。
- 风险：合成/滚动/动画走软件路径（SwiftShader），CPU 占用与帧率需运行时验证 → **不默认引入**，作为可选项记录（启动参数注入点：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`，已在实验中验证通道）。
- `--renderer-process-limit=1` 负收益，弃用。

## 4. 综合收益与建议

| 动作 | 预期收益（整树） | 状态 |
| --- | --- | --- |
| PCM 窗口默认 256→128 | 无损（当前默认路径零影响；v2 用户收益） | ✅ 已落地 |
| v2 窗口化默认化（64–128 MiB） | −48 ~ −112 MB（sidecar） | ⏸ 行为变更，建议独立任务（需全量播放回归） |
| WebView2 `--disable-gpu`（可选） | −108 MB PB（−17 MB WS） | ⏸ 记录实验数据，性能权衡后决策 |

## 5. 数据文件

- `research/data/wv-{baseline,rlimit,nogpu,combo}.csv`（WebView2 参数采样）
- `research/data/wv-*.png`（CDP 截图，像素对比依据）
- `research/scripts/`（sample-webview.ps1、shot.mjs、cdp-drive.mjs、ui-utils.mjs 复用件）
- v2 实验日志：`mem-trim-data/v2*.log`（进程已停，日志保留于本报告引用）
## 6. 勘误（2026-08-09，由 08-09-webview2-process-memory 复核）

§3 "WebView2 参数试验" 中 `--disable-gpu` 的收益结论**不成立**：
- 复核证明：参数（`--disable-gpu`/`--disable-breakpad`/`--disable-crash-reporter`)均被 WebView2 忽略——命令行动员显示参数已注入，但 gpu-process 与 crashpad-handler 依然存在；
- 当时观测的 PB 差异（200 vs 307 MB）为测量时机/页面状态差异，非参数效果；
- **不要将 `--disable-gpu` 作为生产配置**。WebView2 进程树（browser + gpu + crashpad + 2×utility + renderer）6 进程为不可削减基线。
