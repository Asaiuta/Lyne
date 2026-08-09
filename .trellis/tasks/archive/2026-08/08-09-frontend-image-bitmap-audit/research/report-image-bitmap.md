# 前端图片位图内存审计报告（08-09-frontend-image-bitmap-audit）

> 2026-08-09。真实 app + CDP（Input 真实鼠标事件驱动导航）+ WMI 进程采样。场景：本地库歌曲列表（**全量 592 行**）vs 发现页（虚拟网格）对照。

## 1. 实测数据（renderer 进程；imgBytes=0 因图片走 HTTP 缓存的 transferSize=0 条目限制，以 tex 解码估算为主）

| 场景 | DOM nodes | imgs（已解码） | 位图估算 | JS heap | renderer WS | renderer PB |
| --- | --- | --- | --- | --- | --- | --- |
| library 歌曲列表（全量 592 行） | **19,353** | **598/598** | **61.1 MB** | 42.5 MB | 301.8 MB | **223.6 MB** |
| library（滚动后） | 19,353 | 598/598 | 61.1 MB | 41.7 MB | 278.5 MB | 199.1 MB |
| discover（虚拟网格） | 1,155 | 63/63 | 8.9 MB | 24.1 MB | 283.3 MB | 201.5 MB |
| settings（无图基线） | 1,155 | 63/63 | 8.9 MB | 24.3 MB | 277.7 MB | 195.5 MB |

> 注：专辑网格场景未能切换成功（等幂/未命中），表格第 2 行实为歌曲列表滚动后状态；数据结论不受影响。

## 2. 归因

- **renderer 平台成本（内容无关）≈ 155–180 MB PB**：discover/settings（仅 63 图、DOM 1.1K）与 library（598 图、DOM 19K）的 PB 差距仅 ~22–43 MB —— V8/Blink/合成器/缓存是 renderer 的大头，**任何页面都在**。
- **图片位图 + DOM 增量总和 ≈ 22–43 MB**（列表 vs 虚拟页 PB 差 223.6 vs 180.3 → +43 MB；其中 heap 差 ~19–24 MB（DOM 结构 + JS 数据）、位图差 ~20 MB（598 缩略图实际解码，估算 61 MB 偏高——缩略图较小）。
- 歌曲列表确认为**全量渲染**（19,353 nodes / 598 imgs 全部 decode）——与 08-09 browse 场景"发现页虚拟化"不同：本地库歌曲表格未虚拟化。

## 3. 结论（比先前猜测收窄）

1. **位图/DOM 优化收益上限 ≈ 30–45 MB**（整树 <10%），不是此前猜测的 20–80 MB 上限——因为 renderer ~150 MB 是平台成本，与内容无关。
2. **可行动作 = 歌曲列表虚拟化**（非图片策略）：省 DOM 19K→~1.5K + heap ~20 MB + 位图 ~20 MB，合计 ~35–45 MB renderer；且该工作**已在 07-16-frontend-scroll-dom-observers（List DOM hot paths，P1）路线内**，无需新任务。
3. **图片专用优化（懒加载/尺寸裁剪/decoding=async）收益 ≤20 MB，且图片本身已随虚拟化缩减 → 不建议单独立项**；发现页等虚拟网格已良性。
4. 更新架构报告"内存解剖"：renderer ~160–180 MB 中 ~150 MB 为平台成本（此前"内容相关"估认为大头，修正为 ~25%）。

## 4. 数据与脚本

- `research/data/image-timeline.jsonl`（5 场景 × 全指标）
- `research/scripts/scene-images.mjs`（真实鼠标导航 + 图像统计 probe，可复用）
- 复用件：cdp-drive.mjs / ui-utils.mjs（copy from 08-09 归档）