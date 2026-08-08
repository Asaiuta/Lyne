# Content page cleanup - remove debug blocks

## Goal

搜索结果、收藏页等内容页面中出现调试用的“网易云账号”块和“退出登录”按钮，影响视觉体验。需要清理这些调试/开发块。修复后：1) 移除所有内容页的账号信息块 2) 移除内容页的退出登录按钮 3) 账号管理功能统一移到设置页或侧边栏 4) 同时移除 Discover MV 空壳标签。

## Confirmed Evidence

- 视觉审计确认：搜索结果 tab 和收藏页截图中出现 debug-like `网易云账号` block / `退出登录` action，SPlayer 对照页面无此内容页账号管理块。
- `LikedCollectionMode` 和 `UserPlaylistsMode` 在 logged-in 状态下把 `退出登录` 作为页面 header action 渲染。
- `NeteasePage` 底部有通用 `online-login-card` feedback block，可能在正常内容页下方附加 `网易云账号` 文案。
- `DiscoverMode` 显式包含第五个 `mvs` tab；SPlayer release 只展示 playlist square、toplists、artists、new music 四个 Discover tab。
- `07-05-remaining-detail-page-routes` 已将歌曲行 MV 跳转改为独立 `video-detail`，移除 Discover MV tab 不再需要承担视频详情入口迁移。
- `navigationPersistence` 仍会恢复持久化的 `discoverTab: "mvs"`，需要在本任务中归一化。
- 产品决策已确认：移除内容页账号调试块、移除内容页退出登录按钮、移除 Discover MV 标签。

## Requirements

1. 内容页不承载账号管理：
   - 搜索结果、收藏集合、用户歌单列表、云盘/历史/下载等内容页不得出现 logged-in 账号信息块或页面级 `退出登录` 按钮。
   - 已登录账号管理入口保留在现有 TopNav account menu / sidebar account chrome / future settings surface，不在内容页重复出现。
   - 未登录时可以保留必要的登录 CTA 或 login-required empty state，但不得呈现为调试块。
2. Feedback 不污染正常内容页：
   - 普通成功/错误反馈可以通过现有反馈服务或轻量状态展示，不应在搜索结果/收藏内容下方追加 `网易云账号` 管理卡片。
   - 如果某页面需要提示登录缺失，使用该页面的空态/CTA，而不是 logged-in 账号管理块。
3. Discover 移除 MV 空壳 tab：
   - Discover segmented tabs 只显示 SPlayer 对齐的四项：歌单广场、排行榜、歌手、新歌/新碟。
   - 已持久化或代码请求的 `mvs` Discover tab 必须回退到安全默认 tab。
   - 移除 MV tab 不等于删除全站 MV/视频能力；搜索结果视频、歌曲右键 MV、视频详情如仍可用，应通过非 Discover-tab 的路径保留或显式降级。
4. 不破坏在线服务基础能力：
   - 登录/退出真实能力不删除，只移出内容页可见区域。
   - 收藏、用户歌单、搜索、Discover 浏览页面继续可加载。
5. 运行时验证：
   - 修复后需要截图证明内容页无账号/debug block，Discover 无 MV tab。

## Acceptance Criteria

- [ ] 搜索结果 6 个 tab 首屏和页面底部都没有 `网易云账号` 内容块或内容页 `退出登录` 按钮。
- [ ] 收藏集合 5 个 tab 没有 logged-in 账号管理块或页面级 `退出登录` 按钮。
- [ ] 创建/收藏歌单列表没有页面级 `退出登录` 按钮；未登录状态仍有可用登录入口。
- [ ] TopNav account menu / sidebar 账号入口仍可打开登录或执行退出登录。
- [ ] Discover 页面只显示四个 SPlayer 对齐 tab；无 `MV` tab。
- [ ] 持久化 `discoverTab: "mvs"` 或调用旧 tab 请求时，不会渲染空白/隐藏 tab，而是回退到默认 Discover tab。
- [ ] 搜索结果和歌曲行中的视频/MV能力不因移除 Discover MV tab 而产生死路，应继续进入独立 `video-detail`。
- [ ] `npm run typecheck` 通过；导航持久化或 tab normalization 变化有测试覆盖。
- [ ] 产出修复后 Discover、搜索结果、收藏集合截图。

## Out of Scope

- 不实现完整 MV 广场或视频详情视觉 parity。
- 不重新设计账号系统或新增设置页账号管理。
- 不做搜索结果独立路由；该项由 `07-04-07-05-search-page-isolation` 处理。
- 不做歌单/专辑详情 route independence；该项由 `07-04-07-05-detail-page-routes` 处理。

## Notes

- 本任务清理可见产品表面，不删除底层登录能力和 NCM API 能力。
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
