# Harden NetEase proxy and path security against SSRF, rebinding and bypass

> **[CLOSED 2026-07-03 — audit] 关闭方式 = superseded（所有权移交），非 fixed。** 4 项发现
> 在代码中**仍然真实存在**，但已全部移交新任务，验收框保持未勾选：
> - token 入日志 → `07-02-server-token-log`（修复已在工作树实现，归该任务收口）；
> - proxy/ua/realIP 透传（SSRF）→ `07-02-server-fetch-hardening` R2；
> - DNS-rebinding → `07-02-server-fetch-hardening` R1；
> - scan-root 分类绕过 → `07-02-server-fetch-hardening` R4——并把本任务更强的要求
>   （远程 scan root 必须通过 `validate_remote_media_url`）于今日移植进 R4。
> Remaining scope: moved to `07-02-server-token-log` + `07-02-server-fetch-hardening`（R1/R2/R4）。

> Source: Rust 代码审计（2026-06-08）发现 **#7 高危**（子代理报告）。localhost sidecar 绑定下风险受限，但应修。

## Goal

堵住 NetEase 代理与本地/远程路径校验的几个安全缺口：SSRF、DNS-rebinding、scan-path 绕过、API token 经 query 进入访问日志。

## 验证状态

- ⚠ **子代理报告，待实现前复核行号**。实现前先对齐权威契约 `.trellis/spec/backend/ncm-proxy-contract.md`。

## Requirements

- **SSRF（代理透传）**：`/api/netease/*` 转发客户端 `proxy` 参数且**零校验**（`netease/proxy/request.rs:128-132` 设 `query.proxy`，`registry.rs:301-313` 转发到出站 `ApiClient`）。与 `domain`（经 `normalize_domain_override` 白名单）不同。→ 移除 `proxy`（及 `ua`/`real_ip`）透传，或按白名单校验；至少在到达 `RequestOption` 前剥离。注意账号 cookie 在 `netease.rs:98-111` 注入，经攻击者代理可被转走。
- **DNS-rebinding**：`validate_remote_media_url` / `is_private_host`（`path_security.rs:107-147`）只判**字面** host 字符串；公网域名解析到 `127.0.0.1`/内网仍放行。→ 对解析后 IP 复核，或把连接固定到已校验 IP；至少诚实记录残余风险（现注释夸大）。
- **scan-path 绕过**：以 `/` 开头的 scan-root 被判 `is_remote` 而**跳过 `validate_path`**（`library_domain_handlers.rs:701-712`）。→ 远程 URL 走 `validate_remote_media_url`，`/` 前缀按相对配置源路径处理。
- **token 入日志**：API token 经 `?token=`（`auth.rs:109-129`）被默认 `Logger`（`server.rs:555`）写入访问日志（及浏览器历史/referrer）。→ Logger 格式脱敏 `token` 参数，或 cover-art 改用短时签名路径 token。

## Acceptance Criteria

- [ ] `proxy` 参数被移除或白名单校验；新增测试覆盖"恶意 proxy 被拒/剥离"。
- [ ] SSRF 过滤对解析后 IP 生效（或显式文档化 + 测试）。
- [ ] 以 `/` 开头的 scan-root 不再绕过 `validate_path`；测试覆盖。
- [ ] access log 不再出现明文 token。
- [ ] `cargo test`、`cargo clippy` 全绿。

## Out of Scope

- 整体认证体系重构（仅做 token 日志脱敏 / 路径 token）。

## Technical Notes

- 关键文件：`src/server/netease/proxy/request.rs`、`registry.rs`、`src/server/netease.rs`、`src/server/path_security.rs`、`src/server/playback/library_domain_handlers.rs`、`src/server/auth.rs`、`src/server.rs`。

## Research References

- 审计 #7（2026-06-08，高危·子代理）；`.trellis/spec/backend/ncm-proxy-contract.md`。
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
