# Detail pages route independence

## Goal

专辑和歌单详情页当前仍嵌入在 Discover 页面的“发现音乐”标签体系下。需要将这些详情页独立为专用路由，对齐 SPlayer。修复后：1) 专辑/歌单详情有独立路由（不显示 Discover 标签）2) 保留底部播放条 3) 使用统一的返回导航（移除“返回推荐首页”按钮）。

## Confirmed Evidence

- 视觉审计确认：`audioplayer-album-detail-targeted-1280x720.png` 仍在 `发现音乐` tab strip 下方；SPlayer 专辑详情是 standalone route。
- 视觉审计确认：`audioplayer-playlist-detail-targeted-1280x720.png` 有内容内返回控件、fallback artwork、无匹配的 standalone route shell；SPlayer 使用 shell back navigation。
- 当前 `useNavigationController` 的 `handleNavigateToAlbumDetail` 会 `pushNavigation("discover")`，`DiscoverMode` 再把 Discover tab 切到 `new` 并加载专辑。
- 当前歌单/专辑详情组件本身已有可复用的 detail UI，主要问题是承载它们的页面身份和返回模型。

## Requirements

1. 专辑详情独立：
   - 从 Discover 新碟、搜索结果、歌曲/歌单内专辑入口进入专辑详情时，主内容区显示专辑详情页。
   - 页面不显示 `发现音乐` 标题、Discover tabs 或 Discover 浏览卡片。
   - 专辑详情保留封面、标题、描述、歌曲/评论 tab、详情内搜索框、播放/收藏/更多等既有能力。
2. 歌单详情独立：
   - 从 Discover 歌单、搜索结果、用户创建/收藏歌单列表进入歌单详情时，主内容区显示独立歌单详情页。
   - 页面不显示父列表页 tab、Discover tabs 或推荐首页内容。
   - 歌单详情保留封面、标题、描述、歌曲/评论 tab、详情内搜索框、播放全部、订阅/取消订阅、更多、滚动收缩态等既有能力。
3. 返回模型统一：
   - 内容区内不再出现 `返回推荐首页` 或等价的冗余返回按钮。
   - 返回使用现有 TopNav back/forward 历史。
   - 从详情返回应回到发起入口所在页面及其滚动/选择状态，至少不强制跳回推荐首页。
4. 播放和全局壳保持：
   - AppShell、TopNav、Sidebar、底部 PlayerBar、队列抽屉、设置弹窗、登录弹窗仍正常覆盖详情页。
   - 详情页播放/入队动作继续走现有在线播放 controller。
5. 不改变本批次之外的详情重构：
   - 歌手详情页大改、详情页行密度/封面真实数据、评论独立页、全屏播放器不在本任务内。
   - 如果共享 detail 组件顺手需要隐藏 inline back 控件，只做最小 props/样式调整。
6. 运行时验证：
   - 修复后必须对专辑详情和歌单详情各截图，并与 SPlayer 对照。

## Acceptance Criteria

- [ ] 专辑详情首屏无 `发现音乐` 标题、Discover tabs、Discover browse cards。
- [ ] 歌单详情首屏无 Discover 或父列表页 tab 内容夹在详情上方。
- [ ] 专辑/歌单详情内容区无 `返回推荐首页` 或等价冗余返回按钮；TopNav back 可返回上一页。
- [ ] 从搜索结果打开专辑/歌单详情后，返回能回到搜索结果页。
- [ ] 从 Discover 打开专辑/歌单详情后，返回能回到 Discover 原入口。
- [ ] 从用户歌单列表打开歌单详情后，返回能回到对应列表，而不是推荐首页。
- [ ] 详情页播放全部、单曲播放/入队、详情内搜索、歌曲/评论 tab 不回退。
- [ ] `npm run typecheck` 通过；涉及导航持久化/详情请求模型时补充或更新单元测试。
- [ ] 产出修复后专辑详情、歌单详情 AudioPlayer vs SPlayer 截图。

## Out of Scope

- 不做歌手详情页视觉重构。
- 不解决底部播放器 active playback 截图缺口。
- 不新增完整 URL/deep-link router。
- 不修复搜索结果页独立；该项由 `07-04-07-05-search-page-isolation` 处理。

## Notes

- 本任务聚焦 route/page composition。样式 polish 只做为达成独立详情壳所必需的最小改动。
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
