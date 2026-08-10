# Implement — Streaming v2 默认化 + gapless 预取桥接

步骤顺序（每步验证后前后）：
1. [x] s1: SharedState 新字段（pending rt / ready / swap / generation / abandon）+ audio_thread 命令 Install/CancelPendingStreamingV2Session + cancel/install 接线 + swap 同步消费（含窗口 reown → ActiveWindow）。
2. [x] s2: callback `try_activate_pending_v2`（Ready|EndOfStream 可换）+ EOF 分支 + abandon 信号 + `request_gapless_preload_if_needed` v2 支持；event flags。
3. [x] s3: Player::queue_next v2 预取分流（窗口预载 + pending_metadata 交接 + supervisor pending_ready 节流）。
4. [x] s4: 记账 owner 化（PcmWindow::create owner 参数 / reown API / ledger 对账验证）。
5. [x] s5: 默认化（config.rs serde 具名 default + env 覆盖已存在配置）。
6. [x] s6: 重型 gate：cargo test 403/403、clippy 无新增、typecheck、build。
7. [x] s7: 实测场景（双曲 gapless PASS / seek 前向·换轨后 / 暂停恢复 / 480s 内存 V2 vs legacy / ledger pending owner 断言）。
8. [x] s8: 报告 + PRD 勾选 + 归档（含回滚见 verification-report.md §5）。  

验证命令：
- cargo test -p audio-engine-core --lib（401 基线）+ npm typecheck + cargo clippy（66 基线）
- 实测：audio_server 场景脚本（tone 短曲 + 长曲 seek/gapless）