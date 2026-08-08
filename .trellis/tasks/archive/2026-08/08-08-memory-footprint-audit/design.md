# Design — 内存占用与泄漏审查

## 被测对象（已知进程构成）

| 进程 | 说明 |
| --- | --- |
| audio-desktop.exe | Tauri 壳（Rust，main window + 桌面歌词窗口） |
| audio_server.exe | Rust 音频 sidecar（actix HTTP/WS、解码、播放、DB）— 无 GUI |
| msedgewebview2.exe | WebView2（前端 UI，多子进程） |

内建遥测：`GET /diagnostics/runtime` → `process.process_tree`（每进程 working_set/private_bytes/cpu）+ `decode.memory_ledger`（解码缓冲账本 + 预算）+ `decode.memory_budget`。

## 测量方法

1. **基线启动**：运行 `target/release/audio-desktop.exe`，等 `/diagnostics/runtime` 可达（audio_server 就绪）。
2. **采样器**：PowerShell 脚本每 5s 采集一次：
   - `Get-CimInstance Win32_Process`（working set / private bytes per pid，按进程名归类）
   - `Invoke-WebRequest /diagnostics/runtime` 存 json（解码账本、进程树）
   - 输出 CSV + jsonl 到任务 research/data/。
3. **场景驱动**：
   - 冷启动→空闲：启动后固定 2 分钟空载（无播放）。
   - 浏览：playwright（或既有 API 列表/封面端到端）滚动本地库与在线页若干页。
   - 播放：用 `.diagnostics-run/diagnostic-tone-*.wav` 或本地曲库经 HTTP API 播放/切歌/暂停，重复 10+ 次。
   - 驻留：最后 30 分钟无操作，观察回落与单调增长。
4. **泄漏判定**：对 private bytes 序列做分段斜率；末段（稳定负载后）斜率 > 阈值（如 0.05 MB/min 且 R² 高）→ 候选；再对照解码账本/缓存上限确认。
5. **交叉验证**：Task Manager 人工快照（如可自动化）或 PowerShell `Get-Process` 复采样。

## 静态分析范围（热点清单骨架）

- `src/player/streaming/memory.rs`：解码账本 LRU，`decode_max_memory_mb` 默认值与配置路径。
- 环形缓冲（callback ring）、重采样缓冲（resample leftover/缓存）、gapless preload（双缓冲 PCM）。
- 前端：封面缓存（blob/内存对象）、歌词内存、虚拟列表窗口大小、WebView 基线 vs 内容。
- DB：library_track_view 全量物化、历史/会话表缓存、metadata 表加载策略。
- 服务端：WS fanout 缓冲、事件队列、scan 中间态。

## 输出

- `research/report.md`：现状占用表、趋势图（数据内嵌）leak 判定、热点清单×优化空间（MB 估算）、环境与局限。
- `research/data/*.jsonl|csv`：原始采样。
- 修复项登记进现有 backlog（08-07 审计遗留任务或新 task 建议清单），不入本次代码。