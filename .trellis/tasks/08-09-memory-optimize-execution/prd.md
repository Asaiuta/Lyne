# 内存优化执行：v2 窗口默认化 + 歌曲列表虚拟化

## Goal

执行审计闭环后的两项优化（父任务，跨前后端）：

1. `08-09-streaming-v2-window-default`：Streaming v2 窗口化路径默认启用（`streaming_first_buffer = true`，窗口 128 MiB），sidecar −48~−112 MB（实测）。
2. `08-09-songs-list-virtualization`：本地库歌曲列表全量 592 行 → 虚拟化，renderer −30~45 MB（实测）。
3. `08-10-desktop-tray-destroy-webview`：主窗口关闭进托盘时销毁 WebView2（实测 360 MB → 0 MB），托盘点击重建；退出改走托盘菜单。

## Cross-cutting

- 验收 = 实测数字（沿用 WMI + CDP 栈）+ 行为回归（v2 需 seek/gapless/流媒体/频谱回归；虚拟化需滚动/选中/上下文菜单回归）。
- 回滚点：v2 = config 单行/env 开关；虚拟化 = 前端组件单文件级。
- 两任务独立可交付；本父任务做交叉 review。

## Child acceptance state (2026-08-10)

- `08-09-songs-list-virtualization`: completed, intentionally unarchived.
  Production-equivalent runtime changed from 592 rows / 19,352 elements to 16
  rows / 927 elements at the midpoint after bounding `.panel-library`.
- Initial same-process WMI acceptance sample: renderer WS -29.9 MiB and PB
  -26.2 MiB. A later paired forced-GC repeat measured -21.3/-21.4 MiB, so the
  process-level saving is allocator-sensitive; the DOM/image reduction remains
  deterministic.
- Full validation: typecheck and task-relevant tests pass. The full frontend
  suite retains one unrelated Streaming v2 default/max constant failure
  (`128 !== 256`), owned by the sibling task.
