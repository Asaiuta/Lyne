# Design — 浏览场景内存补充测量

## 架构

```
audio-desktop.exe (env: --remote-debugging-port=9222)
   ├─ msedgewebview2.exe (CDP 端点 http://127.0.0.1:9222)
   ├─ audio_server.exe (sidecar)
   └─ ...webview 子进程
        ▲                                  ▲
   cdp-drive.mjs (Node 零依赖)    sample-power.ps1 (WMI 采样器)
   Runtime.evaluate 驱动 DOM      5s 间隔逐进程 WS/PB + CDP heap
```

## CDP 客户端（零依赖）

- Node ≥21 全局 `WebSocket`/`fetch`。
- 流程：GET `/json/list` 找 `http://tauri.localhost` page target → `ws://.../devtools/page/<id>` → 消息 id 递增 + 响应 promise 表；`Runtime.evaluate`（expression, returnByValue, awaitPromise）。
- 辅助：`evalJs(expr)` 返回 JSON 值；`wait(ms)`；元素查找优先 `[data-*]`/文本；scroll 容器派发 `wheel` 或设 `scrollTop`。

## 场景脚本

1. **scene-library.mjs**：导航到本地音乐库（侧栏入口文本匹配）→ 等待列表 → 滚到底（循环 scrollTop += viewport，每步 200ms）→ 回顶 ×3 轮 → 采集每轮 DOM 节点数(`document.getElementsByTagName('*').length`) 与整树内存。
2. **scene-online.mjs**：进入在线搜索 → 输入关键词 → 提交 → 结果列表 → 点首个详情 → 返回 ×10 轮；每 2 轮记录 DOM 节点 + heap（`performance.memory` 若可用）。
3. **scene-mixed.mjs**：浏览（库滚动 2 轮）+ 点击曲目播放 → 切歌 ×5 → 期间采样。
4. **sample-tier**：沿用上一任务 WMI 采样器（进程树 CSV）。

## 判定与报告

- 对每场景：开始/峰值/结束 + 多轮趋势；浏览循环中 WebView 渲染器 WS/PB 单调增长且 DOM 节点同步增长 → 候选项（提供轮次与截图式证据）。
- 报告增补至 archive/2026-08/08-08-memory-footprint-audit/research/report.md §“浏览场景补充（08-09）”，并更新归档 PRD 局限说明。