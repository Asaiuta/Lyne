# 实施计划（webview2-process-memory）

## 步骤

1. **参数确认实验**（不改产品代码，env 注入 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`）：
   - 组合 A：`--remote-debugging-port=9222 --disable-crashpad`
   - 组合 B：`--remote-debugging-port=9222 --disable-gpu --disable-crashpad`
   - 每组：启动 → 40s 稳定 → WMI 25s 采样（沿用 trim 任务 sample-webview.ps1）→ CDP 截图 + rAF 帧计数（新脚本 framerate-probe.mjs）。
2. 门禁判定：scroll + sidebar 折叠 rAF 帧间隔对比 baseline（trim 已存 baseline 数据；如需补跑则补）。
3. 落地：tauri.conf.json windows[].main.additionalBrowserArgs = `--disable-gpu[ --disable-crashpad]`；npm run build 回归 + tauri config 生效验证（重启 app 观察进程树）。
4. 视觉冒烟：4 页截图像素差 vs baseline。
5. 报告 + PRD 勾选 + 归档提交。

## 验证命令

- `npm run build`（desktop tsc/bundle 门禁）
- 复用脚本：sample-webview.ps1（WMI 树采样）、cdp-drive.mjs + shot.mjs（截图）、新 framerate.mjs（rAF 计数）
- baseline 对比源：08-09-memory-trim-delivery/research/data/wv-baseline.csv（463.4 WS / 307.4 PB）

## 回滚点

- 配置回滚 = 删除/恢复 single-line additionalBrowserArgs；实验阶段零代码改动。