# Implement — 内存占用与泄漏审查

## 阶段 0：准备

- [ ] 确认 release 二进制最新（`target/release/audio-desktop.exe` / `audio_server.exe`，如过时则 `cargo build --release`）。
- [ ] 写采样脚本 `research/scripts/sample-memory.ps1`：每 5s 采集 Win32_Process（按名归类 WS/PB）+ `/diagnostics/runtime` 存 JSON，追加 CSV/JSONL。
- [ ] 确认 audio_server HTTP 端口与播放 API 用法（config/文档或既往 bench 脚本）。

## 阶段 1：实测（4 场景）

- [ ] 冷启动→空闲：启动 app，记录 t0；2 分钟空载采样。
- [ ] 浏览场景：playwright 或 API 驱动（本地库滚动 + 在线搜索/详情若干页），采样至平稳。
- [ ] 播放场景：用 diagnostic-tone wav 或库内曲目经 API 播放/切歌/暂停 ×10+，采样。
- [ ] 驻留 30 分钟：无操作，观察回落/增长；≥6 采样点。

## 阶段 2：静态热点分析

- [ ] 解码账本与预算（memory.rs/config.rs）— 当前上限与典型占用。
- [ ] 环形缓冲/重采样/预载缓冲大小计算。
- [ ] 前端缓存（封面/歌词/列表）与 WebView 基线。
- [ ] DB 全量加载点（library_track_view、历史、会话）与缓存策略。
- [ ] WS fanout / 事件队列 / scan 中间态。

## 阶段 3：判定与报告

- [ ] 泄漏判定：分段斜率分析 + 账本/缓存上限对照；明确"无泄漏"或候选点。
- [ ] `research/report.md`：占用表（每进程 WS/PB 各场景）、趋势、热点×优化空间（MB 估算）、环境与局限。
- [ ] 数据文件入 `research/data/`；脚本入 `research/scripts/`。
- [ ] 修复项登记（backlog 清单），不改产品代码。

## 阶段 4：收尾

- [ ] 任务 PRD 验收框按实际结果勾选；journal 记录。
- [ ] 提交（任务目录 + journal）；归档。

## 验证命令

```bash
# 采样（后台）
powershell -File research/scripts/sample-memory.ps1 -OutDir research/data -DurationSec 1800
# 运行时诊断
curl http://127.0.0.1:<port>/diagnostics/runtime
```
