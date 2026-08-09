# WebView2 进程级优化：反证实验报告（08-09-webview2-process-memory）

> 2026-08-09。目标：验证 `--disable-gpu` 与 crashpad 禁用参数对 WebView2 的实际效果；结果：**三项参数均被 WebView2 忽略**，此前 trim 报告中的"disable-gpu 收益"结论需勘误。

## 1. 方法

- 注入通道：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`（生产等价的 `tauri windows[].additionalBrowserArgs` 通道）。
- 三组运行：base（无参数）、`--disable-crashpad`、`--disable-gpu --disable-breakpad --disable-crash-reporter`；每组 35s 稳定 + WMI 树采样 25s + CDP rAF 帧计数 3s。
- 进程 type 判定：`Win32_Process.CommandLine` 中 `--type=` 值。
- 干扰排除：确认测量期间宿主机另有 SearchHost(Windows 搜索) 的独立 WebView2 树，但采样器从 audio-desktop 根出发，未污染数据；分析时按父子关系过滤。

## 2. 结果

### 2.1 参数注入有效，但进程未消失

启动参数**确实进入 browser 命令行**（实测命令行动员）：
`... --noerrdialogs --disable-breakpad --disable-crash-reporter --disable-gpu --remote-debugging-port=9222 ...`

启用全部禁用参数后，进程树仍为 6 进程：

| 进程 | 禁用后仍存在? |
| --- | --- |
| browser(main) | — |
| **gpu-process** | ✅ 仍存在（WS ~59–69 / PB ~20–63） |
| **crashpad-handler** | ✅ 仍存在（WS ~20 MB） |
| renderer | ✅ 1 个（歌词窗打开时 +1） |
| utility ×2 | ✅ |

→ **WebView2 强制保留 GPU 进程与崩溃处理进程，忽略 `--disable-gpu` / `--disable-breakpad` / `--disable-crash-reporter`**。
（可能与 WebView2 的嵌入隔离、`--embedded-browser-webview=1` 模式有关；`--disable-features=msWebOOUI,...` 类 feature 开关由系统注入的成员生效，但进程级开关不被尊重。）

### 2.2 rAF 帧间隔（scroll 3s）

| 组合 | avgFrameMs | 相对 base |
| --- | --- | --- |
| base | 6.051 | — |
| --disable-crashpad | 6.054 | +0.05% |
| full（gpu+crashpad） | 6.060 | +0.15% |

帧节奏无实质差异（与进程未消失一致）。

### 2.3 内存

| 组合 | 进程数 | 树 WS | 树 PB |
| --- | --- | --- | --- |
| base | 6 | 478.8 MB | 295.4 MB |
| --disable-crashpad | 6 | 474.0 MB | 291.4 MB |
| full | 6 | 463.3 MB | 198.1 MB |

> ⚠️ full 组 PB 差异（−97 MB）**不能归因于参数**（GPU 进程仍存在）。**判定为页面负荷/显存共享状态的测量时机差异**（即：曾经 trim 任务将 −108 MB PB 归因于 `--disable-gpu` 的结论**错误**，见勘误 §3）。

## 3. 勘误（trim 报告 §3 修订）

`08-09-memory-trim-delivery/research/report-trim.md` 原结论：
> `--disable-gpu`：WS 省 17 MB、PB 省 ~108 MB（GPU 进程 + 共享显存消失）…

**修订**：参数被 WebView2 忽略，gpu-process 与 crashpad 均无法通过启动参数禁用；当时观测的 PB 差异（200 vs 307 MB）为采样时机/页面状态差异，**不应作为配置收益**。该报告 §3 表格保留原始记录并加注勘误。

## 4. 结论与影响

1. **无启动参数可削减 WebView2 进程树**（6 进程为 WebView2 基线，~463 MB WS / ~295 MB PB 稳定）→ 本任务无配置落地。
2. 该 6 进程树中的可变项只剩：
   - 歌词窗口 renderer（打开时 +1 进程 ~20–35 MB）→ 已在 SMTC/桌面歌词原生化路线覆盖；
   - 页面负荷（renderer/gpu 的 PB 随内容起伏）→ 前端已虚拟化，无方案级优化。
3. 产品配置**不引入** `--disable-gpu` 等无效参数（避免误导性配置）。

## 5. 数据

- `research/data/wvp-{base,nocp,full}.csv`（25s × 5 点进程树采样）
- `research/scripts/framerate.mjs`（rAF 帧间隔 probe，可复用）
- 帧率：FPS_PROBE 行内嵌于各组合运行输出（见 §2.2）