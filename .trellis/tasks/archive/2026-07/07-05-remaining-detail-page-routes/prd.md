# Remaining online detail route independence

## Goal

补完 `07-04-splayer-ui-parity` 中广义 detail-page 的路由独立问题。上一轮
`07-04-07-05-detail-page-routes` 只覆盖了专辑和歌单；本任务继续将仍嵌在父页
内的在线详情页迁到专用页面身份，对齐 SPlayer 的统一返回模型。

修复后，daily songs、artist detail、video/MV detail、radio detail 不再显示父页面
标题、Discover tabs、搜索结果 tab 或内容区内的 `返回推荐首页` / `返回` 冗余按钮；
进入详情后保留 AppShell、TopNav、Sidebar、底部 PlayerBar 和原有播放/收藏/评论能力。

## Confirmed Evidence

- `ACTIVE_PAGES` 当前只有 `album-detail`、`playlist-detail` 两个独立 detail identity。
- `useNavigationController.handleNavigateToArtistDetail()` 仍 `pushNavigation("discover")`。
- `useNavigationController.handleNavigateToMv()` 仍设置 Discover `mvs` tab 后 `pushNavigation("discover")`。
- `NeteaseRadioPage` 内部用 `selectedRadio()` 切换 radio detail，并在内容区显示 inline back。
- `RecommendMode` / `DiscoverMode` 内部用 `detailNav.selectedDailySongs()` 渲染 `DailySongsDetail`。
- `RecommendMode` / `DiscoverMode` / `OnlineSearchMode` 内部仍直接渲染 `ArtistDetail` 和 `VideoDetail`。
- 视觉审计 `gap-list.md` 已确认 daily songs 有 `返回推荐首页`，artist detail 导航模型与 SPlayer 不同；radio detail 在 SPlayer 中有独立详情截图。
- `liked-songs` 已经是独立 `ActivePage`，不是本任务的剩余 route gap。
- liked collection 页面内账号块属于 `07-04-07-05-content-page-cleanup`，不是本任务的 route composition 范围。

## Requirements

1. Daily songs 独立：
   - 从首页/发现页 daily card 进入时，主内容区显示 `daily-songs` 页面。
   - 页面不显示首页 greeting、Discover tabs、父列表内容或 `返回推荐首页`。
   - 保留刷新、批量操作、播放全部、单曲播放/入队、移出每日推荐、song wiki/MV 入口。
2. Artist detail 独立：
   - 从推荐、发现歌手、搜索结果、播放器/歌曲详情等入口进入时，主内容区显示 `artist-detail` 页面。
   - 页面不显示 Discover/search 父页 chrome 或内联 back 按钮。
   - 保留歌曲/专辑/视频 tab、分页加载、排序、收藏/取消收藏、播放全部、专辑/视频跳转。
3. Video/MV detail 独立：
   - 从推荐、发现、搜索结果、歌曲行 MV 入口、artist videos 进入时，主内容区显示 `video-detail` 页面。
   - 页面不强制切回 Discover `MV` tab，不显示 Discover tabs 或内联 back。
   - 保留视频播放器、清晰度、评论、打开源站、关联 artist 跳转。
4. Radio detail 独立：
   - 从播客电台首页、分类页、搜索结果进入时，主内容区显示 `radio-detail` 页面。
   - 页面不显示 radio 首页/分类列表或内容区内联 back。
   - 保留节目/评论 tab、订阅/取消订阅、播放节目、打开源站、节目行播放/入队。
5. 返回模型统一：
   - 详情页返回使用现有 TopNav back/forward 历史。
   - 从详情返回应回到发起入口页面及其状态，至少不强制回推荐首页或 Discover 默认 tab。
6. 保持全局壳：
   - AppShell、TopNav、Sidebar、底部 PlayerBar、队列抽屉、设置弹窗、登录弹窗仍正常覆盖详情页。
   - 在线播放 controller、NCM 账号状态、收藏订阅状态更新保持现有行为。
7. 不做视觉重构：
   - 歌手详情头部比例、行密度、真实封面、评论独立页、Discover MV tab 清理不在本任务内。
   - 如需隐藏 content-level back，只做最小 prop/default 调整。

## Acceptance Criteria

- [ ] `ACTIVE_PAGES` / online-only sets 增加 `daily-songs`、`artist-detail`、`video-detail`、`radio-detail`；`NeteasePageMode` / `NETEASE_PAGES` 增加由 `NeteasePage` 承载的 daily/artist/video detail，radio detail 保持 App 级 RadioPage 分支。
- [ ] daily songs 首屏无首页 greeting、Discover tabs、`返回推荐首页` 或等价内容区返回按钮。
- [ ] artist detail 首屏无 Discover/search 父页标题/tabs，内容区无 `返回推荐首页` 或等价返回按钮。
- [ ] video/MV detail 首屏无 Discover tabs，不再为了打开视频强制切换 Discover `mvs`。
- [ ] radio detail 首屏无 radio 首页/分类内容夹在详情上方，内容区无 inline back。
- [ ] 从搜索结果打开 artist/video/radio 后，TopNav back 返回搜索结果页。
- [ ] 从推荐/发现打开 daily/artist/video 后，TopNav back 返回原入口页。
- [ ] 从 radio 首页/分类打开 radio detail 后，TopNav back 返回 radio 原入口。
- [ ] 详情页播放、入队、订阅/收藏、评论 tab、资源 tab 和分页加载不回退。
- [ ] 导航持久化不恢复无 payload 的 detail 页面；相关 normalization test 更新。
- [ ] `npm run typecheck`、相关前端测试、`npm run build` 通过。
- [ ] 产出修复后 daily/artist/video/radio detail 1280x720 截图，确认没有父页 chrome。

## Out of Scope

- 不重做歌手详情视觉布局；该项属于 `核心详情页对齐` 后续 P1 视觉任务。
- 不处理专辑/歌单 detail；已由 `b8e60db` 覆盖。
- 不清理 Discover MV tab 空壳；归属 `07-04-07-05-content-page-cleanup`。
- 不清理 liked collection 账号块；归属 content cleanup。
- 不新增完整 URL/deep-link router。

## Notes

- 本任务聚焦 route/page composition 和返回模型；视觉 polish 只做隐藏 inline back 所必需的最小改动。
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
