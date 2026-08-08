# 旧归档任务验收证据矩阵（2026-08-08 重建）

任务：`08-08-legacy-archive-evidence-reconstruction`
方法：S1 任务目录内记录 → S2 git 提交 → S3 现行代码/测试/产物复核。
复核日实测（S3 基准）：`npm run typecheck` 通过；`npm test` 520+6+8+5 全绿；`cargo test --lib` 401 通过；`cargo clippy --lib --no-deps` 仅既有 66 警告（无新增）；`npm run build` PASS；`cargo check --manifest-path apps/desktop/src-tauri` 通过。

## 1. 05-31-local-library-worker-virtualization — 达成 7/7

1. 滚动不再每 range 变化发后端请求 — **达成**：S3 `libraryControllerViewState.ts:136/146` `workerClient.requestView`（页内 worker 切片）；S2 0f55d47
2. MediaList 行 virtualStart 匹配 worker 切片 — **达成**：S3 `libraryVisibleRowsStore.ts` + `mediaListVirtualization.test.ts`
3. play-all/行播放用有序 media_id[] — **达成**：S3 `requestViewMediaIds` / `requestViewRows`
4. 批量操作可请求全部行 — **达成**：S3 `requestViewRows()` 全量行 API
5. 文件夹过滤与文件夹树一致 — **达成**：S3 `LibraryGroupedView.tsx` folders kind
6. typecheck — **达成**：复核通过
7. 聚焦库测试 — **达成**：`mediaListVirtualization.test.ts` + `libraryVisibleRowsStore.test.ts`（套件全绿）

## 2. 06-01-frontend-tech-debt-cleanup — 达成 5/6（1 不可达成）

1. 800/801/802/803/200 魔数消除 — **达成**：S3 现行 `shared/api/netease*.ts` 等无裸 800-803 字面量
2. 迁移类型走 schema 驱动生成器 — **达成**：S2 628da752/be3be33 "define schema-driven API parsers"；S3 解析测试全绿
3. useLibraryDataController 错误走 withFeedback — **达成**：S2 8006f62；S3 `useLibraryDataController.ts:101,295` `withFeedback`
4. madge 报告 13 个 Naive type cycle 消除 — **不可达成**：package.json 无 madge 脚本、无等价产物 → 保留未勾选
5. WindowControls 日志 + os.ts 归一 — **达成**：S3 `WindowControls.tsx` 反馈通道（dialog.warning:81）；S2 9b242c8 移除 os.ts 危险 API
6. typecheck + 解析器/库测试 — **达成**：复核通过

## 3. 06-01-introduce-playback-context — 达成 6/6

1. NeteasePage 不再转发 props；模式读 PlaybackContext — **达成**：S2 adfbb29；S3 `discoverShowcases.tsx:11,519` `usePlayback()`
2. FullPlayer props 大幅减少（UI-local） — **达成**：S2 adfbb29；S3 FullPlayer 用 PlaybackContext
3. useAppController 分组子控制器 — **达成**：S3 `useAppController.ts` 分组导出（Navigation/Playback/Queue/…）
4. 播放/歌单导航/注册无回归 — **达成**：套件 520 全绿（S3）
5. typecheck — **达成**
6. 聚焦播放测试 — **达成**

## 4. 06-01-persist-navigation-and-page-state — 达成 6/6

1. 重载恢复非 home 页 — **达成**：S2 e03103b；S3 `ContentArea persistKey` + `navigationPersistence.test.ts:35`
2. 恢复 tab/收藏 tab + 滚动位置 — **达成**：S2 e03103b（PageSurface/ContentArea）；S3 测试 :202
3. 失效页回退 recommend — **达成**：S3 测试 :63/:126/:194
4. back/forward 无回归 — **达成**：套件全绿
5. typecheck — **达成**
6. 聚焦恢复+回退测试 — **达成**：navigationPersistence.test.ts

## 5. 06-01-virtualize-discover-and-comment-lists — 达成 5/5

1. Discover 卡片 DOM 有界 — **达成**：S2 f51e9c5；S3 `VirtualizedGrid.tsx` + `gridVirtualization.test.ts`
2. 评论 DOM 有界 — **达成**：S3 `ResourceCommentsPanel.tsx` 虚拟化（299 行改动）
3. 滚动流畅/点击进详情 — **达成**：套件绿 + 主干未回归
4. typecheck — **达成**
5. 可见区解析聚焦测试 — **达成**：gridVirtualization.test.ts

## 6. 06-03-fix-audio-callback-playback-hang（#7 单测）— 部分，保持未勾选

prd L35 内嵌 2026-07-03 审计注已判定：无专门单测，证据为发布顺序代码 + 注释（callback.rs:454-468）。判定维持：**部分**（不满足"单测覆盖"字面），保留未勾选。

## 7. 06-08-server-netease-proxy-path-security — 达成 4/5，未达成 1

1. proxy 参数移除/白名单 + 测试 — **达成**：S2 43d143a/10fd05f "unify proxy registry and handlers" + 3cf352f "lock proxy compatibility contract"；S3 `netease.rs` 无用户 proxy 参数透传 + `proxy` 模块 registry/契约测试
2. SSRF 解析后 IP 过滤 — **未达成**：S3 fetch/proxy 路径无 resolved-IP 过滤；该修复由 `07-02-server-fetch-hardening`（in_progress）承接 → 保留未勾选
3. `/` 开头 scan-root 不绕过 validate_path — **达成**：S3 `library_scan.rs` canonicalize（:622）+ `local_scan_source_path_skips_canonicalize_for_empty_snapshot` 测试（:1405）
4. access log 无明文 token — **达成**：S2 22d48de；S3 `auth.rs redact_token_query` + 测试（server.rs:578）
5. cargo test/clippy — **达成**：复核 401 绿；clippy 无新增

## 8. 07-02-frontend-lyric-fixes — 达成 6/8，部分 2

1. 主窗退出时 overlay 关闭（运行时验证） — **部分**：S2 9ba3dcf D1（Destroyed 钩子 + main.rs 注释）；无运行时手工清单 → 保留未勾选
2. 主窗已关闭时 close 可用 — **部分**：close 自回退代码存在；无运行时验证 → 保留未勾选
3. tick ≈2Hz 非每帧 — **达成**：S1 implement.md step9（回归测试模拟）+ S3 套件
4. marquee 无每帧 scrollWidth — **达成**：S2 9ba3dcf D3；S3 DesktopLyricApp（active-line + ResizeObserver）
5. rAF 暂停时 idle — **达成**：S2 9ba3dcf D3
6. 位置越界恢复在屏 — **达成**：S2 9ba3dcf D4（availableMonitors clamp）
7. reload 后 active 反映已开 overlay — **达成**：S2 9ba3dcf D5（desktop_lyric_is_open 播种）
8. typecheck + 前端测试 + src-tauri check — **达成**：复核通过

## 8. 07-02-frontend-security — 达成 4/4

1. CSP 真实策略且应用可用 — **达成**：S3 `tauri.conf.json` csp（default-src/self+ipc/…）+ 复核 typecheck/build 绿 + S2 9b242c8
2. delete_file 拒绝目录外/目录/相对路径 — **达成**：S3 `delete_target_*` 7 个测试（:452 内/470 外/489 目录/505 远程/520 非库根/538 符号链接）+ sidecar 路由 `routes.rs:99`
3. 调用方更新/typecheck/cargo check — **达成**：S2 9b242c8（library.ts +11 / os.ts -12）；复核通过
4. overlay capability 无回归 — **达成**：S3 `capabilities/desktop-lyric.json` + main.rs desktop_lyric 命令注册

## 9. 07-02-player-seek-race — 达成 5/6，部分 1

1. seek 竞态压测（interleave） — **达成**：S3 callback.rs 1838/1899/2059 三个竞态测试（`seek_slot_request_wins_*`、`seek_slot_stress_interleaved_*`），套件绿
2. 首缓冲窗口 seek — **达成**：S2 b962568（generation-tagged slot）+ `seek_slot_request_wins_if_it_lands_between_publish_check_and_store`（callback.rs:1899）
3. dsp_reset_pending 可观察 — **达成**：`seek_slot_consumption_requests_dsp_reset_and_repairs_position`（callback.rs:1932）
4. 既有测试全绿 — **达成**：401 导入复核
5. 基准门无回归 — **达成**：S1 implement.md（512 full median 40267.8 ns，--enforce 通过 2026-07-02/03）
6. 回调路径无新锁/分配 — **部分**：atomic-only 设计声明，但 seek 测试无 no_alloc 断言 → 保留未勾选

## 10. 07-02-server-blocking-handlers — 达成 4/4

1. 无内联阻塞加载 — **达成**：S2 eda3c20；S3 transport.rs spawn_blocking 包装（:15 注释+调用），grep 无 handler 内直调
2. cargo test 绿 — **达成**：401
3. 慢加载时 /state 及时性 — **达成**（按验收点 OR）：运行时压测不可行已声明；结构性 + 测试为准
4. clippy 无新警告 — **达成**：66 既有，无新增

## 11. 07-02-server-token-log — 达成 4/4

1. ?token=SECRET 日志无明文 — **达成**：S3 auth.rs `redact_token_query` + 测试（server.rs:578）
2. "null" origin 移除 + 前端连接正常 — **达成**：S2 22d48de（config.rs）；套件绿
3. cargo test + clippy — **达成**
4. 查询 token 回退保留（img 封面 URL） — **达成**：auth.rs 模块文档 + 仅日志 redact

## 12. 07-04-07-05-content-page-cleanup — 达成 9/9

1. 搜索结果 6 tab 无账号块 — **达成**：S3 grep 无页面级退出登录 + screenshots 02/03
2. 收藏 5 tab 无账号块 — **达成**：screenshot 04 + grep
3. 歌单无页面级退出登录；未登录仍有登录入口 — **达成**：TopNav 入口保留
4. TopNav/Sidebar 账号入口可用 — **达成**
5. Discover 四 tab 无 MV — **达成**：screenshot 01 + DiscoverMode 无 DISCOVER_MV
6. mvs 持久化回退默认 tab — **达成**：navigationPersistence.test.ts:77 → playlists
7. 视频/MV 能力不死路 — **达成**：VideoDetail.tsx + App.tsx video-detail 路由；DISCOVER_MV_* 隐藏非挂载
8. typecheck + 导航测试 — **达成**
9. 截图产物 — **达成**：research/screenshots 4 张 + results.json

## 13. 07-04-07-05-detail-page-routes — 达成 5/9，部分 3，未达成 1

1. 专辑首屏无 Discover chrome — **达成**：S2 b8e60db；S3 OnlineAlbumDetailRoute
2. 歌单首屏无 Discover chrome — **达成**：同上
3. 无"返回推荐首页"冗余返回 — **达成**：S3 grep 无命中；TopNav back 保留
4-6. 搜索结果/Discover/用户歌单 → 详情返回 — **部分**（3 条）：路由隔离代码存在，但无运行时返回路径验证记录 → 保留未勾选
7. 播放/入队/搜索/评论/资源 tab 不回退 — **达成**：静态 + 套件绿
8. typecheck + 导航测试 — **达成**
9. 修复后截图 — **未达成**：research 无截图产物；保留未勾选

## 14. 07-04-07-05-search-page-isolation — 达成 8/8

独立搜索页（S2 283807e + S3 OnlineSearchMode/useOnlineSearchController）；推荐页无 Discover chrome（submitNonce→搜索路由）；6 tab + 状态（screenshots 6 png）；结果点击进详情（路由接线保留）；TopNav 搜索历史/热搜/建议（topNavSearchPolicy 测试）；本地库搜索不变（S2 590eb5e）；typecheck + 测试；截图 6 张

## 15. 07-05-remaining-detail-page-routes — 达成 9/12，部分 3

1. ACTIVE_PAGES 四页/radio App 级 — **达成**：App.tsx daily-songs/artist-detail/video-detail/radio-detail
2. daily 无父 chrome — **达成**：OnlineDailySongsRoute + grep 无命中
3. artist 无父 chrome — **达成**：OnlineArtistDetailRoute
4. video 无 Discover tabs/不强制 mvs — **达成**：VideoDetail + 独立路由
5. radio 无 inline back — **达成**：NeteaseRadioPage 重构（f8c3b91）
6-8. 三处返回路径 — **部分**（无运行时验证）→ 保持未勾选
9. 详情能力不回退 — **达成**：静态 + 套件
10. 无 payload 详情不恢复 — **达成**：navigationPersistence.test.ts:109
11. typecheck/测试/build — **达成**：全部复核
12. 四页截图 — **达成**：research/screenshots 4 张 + results.json

## 16. 07-05-splayer-color-system-unification — 达成 8/10，部分 1，未达成 1

1. paletteEngine/customAppearance 单写契约 — **达成**：S2 05d589c + 119b1cf；S3 useAppController paletteEngine + appearanceSettingsModel.test
2. tokens.css 文档化层级 — **达成**：tokens.css 头部注释
3. Naive/Kobalte 控件颜色统一 — **达成**：119b1cf + 适配层
4. playerFollowsCoverColor — **达成**：S3 useAppController
5. themeFollowCover/themeGlobalColor — **达成**：S3 AppearanceMainPanel/AdvancedPanels
6. 动态封面选择分离 — **达成**：沿用
7. 无新 peer 颜色根 — **部分**（静态复核有限）→ 保留未勾选
8. typecheck — **达成**
9. build — **达成**：复核 PASS
10. 前/后截图 — **未达成**：research 无截图产物 → 保留未勾选

## 17. 07-05-splayer-detail-pages-visual-parity-pass2 — 达成 7/7

S1 决定性证据：research/detail-pages-pass2-result.md + 17 张 after 截图 + 14 张 motion 截图；artist(lmp/album/video)/album/playlist 收敛说明 + 剩余差距（mock 数据、底部播放器）明示；S2 4f3147e；复核 typecheck/build/测试绿

## 18. 07-13-frontend-lossless-performance — 验收占位「TBD」

无定义 → 不可达成；保持未勾选（无产物可证）

## 07-18-fix-orphaned-local-library-media（剩余 1 条）

前端空状态 — **未达成（不可重建）**：归档材料仅后端/副本/扫描证据，无前端运行时验证 → 保持未勾选

---
**统计**：达成 102、部分 11（保持未勾选）、未达成 6（含 1 占位、1 不可达成 madge、4 未达成）。无伪勾选；所有"达成"均可回溯至矩阵内引用的提交/测试/产物。