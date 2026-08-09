# WebView2 进程级内存优化落地

## Goal

把上一轮实验已验证的 WebView2 进程级优化落地为产品配置：
1. `--disable-gpu`（实测 PB −108 MB / WS −38 MB，视觉像素差 0.7/255 ≈ 无感）——以**动画帧率抽查**为门禁后默认开启；
2. crashpad-handler 进程去除实验（`--disable-crashpad` 等，目标 −16 MB/树）——验证有效才落地；
3. 实测对比（沿用 WMI 采样 + CDP 截图与 rAF 帧计数），产出前后数据。

## Requirements

1. 落地通道：`tauri.conf.json` windows[].additionalBrowserArgs（Windows only，仅影响 WebView2；macOS/Linux 忽略）——不引入额外 env 开关；若 crashpad 参数无效则保持现状并记录。
2. 门禁（disable-gpu 默认化的前提）：
   - 浏览器渲染帧节奏抽查：经 CDP Runtime 注入 rAF 计数器，对比开启前后 ≥2 个场景（静置、滚动、侧栏折叠动画）的平均帧间隔——不允许反向劣化 >5%；
   - 视觉冒烟：主界面/搜索/播放器/设置 4 路由 CDP 截图 + 像素差对比（与基线 ≤ 1.0/255）；
   - 功能冒烟：播放启动/暂停正常（sidecar 不受影响，确认）。
3. 数据：启用前后各一轮 25s WMI 采样（进程树 WS/PB、crashpad 存在性、进程数），入库 research/data/。
4. 配置须可回滚（单行 revert）。

## Acceptance Criteria

- [x] 参数有效性验证：启动参数确认注入成功（命令行动员可见）且 WebView2 仍保留 gpu-process / crashpad-handler → 三类参数（disable-gpu / disable-breakpad / disable-crash-reporter）**均无效，无配置落地**（与 PRD 原假设相反，实证记录于 report）。
- [x] 帧节奏对比：base / 禁用组合 rAF 平均帧间隔 6.051 / 6.054 / 6.060 ms（差异 ≤0.15%）——无劣化（参数无效前提下无变化）。
- [x] 内存与进程树：三组合均 6 进程；修正 trim 报告中 “disable-gpu 省 108 MB PB” 的错误归因（勘误已写入 trim 报告 §6）。
- [x] 结论与影响：WebView2 6 进程为不可削减基线；仅可变项为歌词窗口 renderer（已在 SMTC/原生歌词路线覆盖）；**不引入误导性配置**。
- [x] 报告与数据入库：research/report-noprocess-flags.md + wvp-{base,nocp,full}.csv + scripts/framerate.mjs。
- [x] 全部由实测背书。