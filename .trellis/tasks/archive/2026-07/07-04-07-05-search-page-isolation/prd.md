# Search results page isolation

## Goal

搜索结果当前嵌入在 Discover 页面内容下方，首屏仍显示“发现音乐”标签和播放列表卡片。需要将搜索结果独立为专用路由，对齐 SPlayer 的独立搜索结果页体验。修复后应该：1) 搜索提交后导航到独立路由 2) 首屏直接显示搜索结果标题和 tab 3) 移除 Discover 页面内容。

## Confirmed Evidence

- 视觉审计确认：`audioplayer-search-results-songs-targeted-1280x720.png` 首屏仍显示 `发现音乐` tabs 和 Discover 卡片；SPlayer 对照图首屏直接是搜索标题、结果 tab 和歌曲行。
- 当前代码中 `SearchMode` 是 `DiscoverMode` 末尾的条件块，搜索结果状态也由 `DiscoverMode` 内部持有。
- `RecommendMode` 收到顶栏搜索提交后通过 `onMarkPendingDiscoverSearch()` 跳转到 `discover`，再由 `DiscoverMode` 执行搜索。
- 本项目没有 URL router，页面身份由 `ActivePage`、`NeteasePage` mode 和 `useNavigationController` 管理。

## Requirements

1. 在线搜索提交后进入独立搜索页面：
   - 从 `recommend`、`discover` 或已有搜索结果页提交 NCM 搜索时，主内容区切换到专用搜索结果页面。
   - 搜索结果页是独立 `ActivePage` / `NeteasePage` mode，不再作为 Discover 页面下方内容块渲染。
   - 顶栏搜索历史、默认关键词、热搜、建议词的提交入口继续可用。
2. 搜索结果页首屏只呈现搜索上下文：
   - 显示搜索标题、搜索 tab、加载/空态和结果列表/卡片。
   - 不显示 `发现音乐` 标题、Discover segmented tabs、Discover playlist/toplist/artist/new cards 或 Discover MV 区块。
   - 保留 AppShell、TopNav、Sidebar、底部 PlayerBar 和现有页面过渡。
3. 搜索功能行为保持不回退：
   - 保留歌曲、歌单、歌手、专辑、视频、播客 6 个搜索 tab。
   - 保留结果项既有操作：播放/入队、打开歌单/歌手/专辑/视频/播客详情、打开歌曲百科、右键菜单。
   - 搜索失败、空关键词、加载中和无结果状态仍有明确反馈。
4. Discover 回到纯浏览页：
   - Discover 只承载 playlist/toplist/artist/new 浏览内容和后续专属详情入口。
   - Discover 页面不因历史搜索结果存在而在底部继续挂载 `SearchMode`。
5. 本地库搜索不纳入本任务：
   - `library` 页顶栏搜索仍按本地库现有逻辑工作。
   - 本任务不改变本地库过滤、worker 查询或本地列表行为。
6. 验证以运行时截图为准：
   - 修复后必须重新截搜索结果 songs/playlists/artists/albums/videos/radios 至少一个首屏对比。
   - 截图必须证明首屏无 Discover 内容。

## Acceptance Criteria

- [ ] 从推荐页输入关键词并提交后，主内容切到独立搜索页，首屏可见搜索标题和结果 tabs。
- [ ] 从 Discover 页输入关键词并提交后，首屏不再显示 `发现音乐` 标题、Discover tabs 或 Discover 卡片。
- [ ] 搜索结果 6 个 tab 仍能切换，加载/空态/错误态可达且不依赖 Discover browse state。
- [ ] 点击搜索结果中的歌单、歌手、专辑、视频、播客仍进入对应详情或现有目标页，不出现 Discover 浏览内容夹在结果页上方。
- [ ] 顶栏搜索历史、热搜、建议词选择仍能触发搜索并写入历史。
- [ ] 本地库搜索行为未改变。
- [ ] `npm run typecheck` 通过；涉及导航持久化或搜索策略时补充/更新对应单元测试。
- [ ] 产出修复后 AudioPlayer vs SPlayer 搜索首屏截图，证明达到父任务批次 1 验收。

## Out of Scope

- 不做搜索结果卡片/列表密度的像素级打磨。
- 不新增真实 URL/deep-link router。
- 不修复账号调试块；该项属于 `07-04-07-05-content-page-cleanup`。
- 不处理歌手详情页大改；该项属于后续核心详情页对齐批次。

## Notes

- 本任务是 P0 批次 1 的导航组合修复。实现时优先复用现有 `SearchMode` 作为展示组件，避免复制搜索 tab UI。
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
