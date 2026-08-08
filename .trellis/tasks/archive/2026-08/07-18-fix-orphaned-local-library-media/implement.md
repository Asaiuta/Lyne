# 实施计划

## 1. 建立回归夹具与成员模型

- [x] 在数据库测试中构造普通 ID、遗留 `//?/` ID、重叠本地根、WebDAV 根、NCM 远程媒体及全套引用。
- [x] 新增迁移 12：创建 `library_root_memberships` 与反向索引，覆盖 fresh DB、v11 升级和幂等/部分 schema 场景。
- [x] 实现共享本地路径与 WebDAV URL 根归属纯函数，并覆盖盘符大小写、`\\?\`、`//?/`、UNC、同名前缀目录和 URL origin/path 边界。

## 2. 实现统一完整清理事务

- [x] 定义 `LibraryCleanupReport` 和基于实际 `(media_id, source_path)` 的目标类型。
- [x] 在一个事务中删除 history → sessions → queue/state → playlist refs → NCM/cover/memberships → media items。
- [x] 对实际 ID、规范 ID和规范路径同时匹配，确保遗留媒体主键与已规范化引用都被清理。
- [x] 重排受影响本地歌单并更新摘要时间，保持歌单顺序合同。
- [x] 将现有 `delete_media_items`、目录删除和重扫失效清理收敛到同一帮助器；磁盘文件删除仍保留显式安全边界。

## 3. 升级回填与孤儿清理

- [x] 回填现有本地根成员，允许重叠根多重拥有同一媒体。
- [x] 通过 WebDAV source 配置回填可证明的 WebDAV 成员，排除 NCM source rows。
- [x] 删除没有任何有效本地根成员的 local media 及完整引用；远程孤儿保留为全局元数据但不进入本地库。
- [x] 记录迁移清理计数并确保 migration 12 失败完全回滚；不执行自动 `VACUUM`。

## 4. 改造扫描提交

- [x] 让 root-scoped snapshot 返回实际 media ID；未变化文件使用该 ID 标记 seen。
- [x] metadata batch 使用最终返回 ID 标记 seen，并让 identity merge/rename 同步成员引用。
- [x] 本地扫描仅在完全成功后原子替换根成员、清理失效独占媒体并更新根状态。
- [x] WebDAV 扫描采用相同的 seen/finalize 成员合同。
- [x] 失败、取消、解析/写入错误路径验证不会提交部分成员或误删旧库。

## 5. 收紧本地库读取边界

- [x] stats、summaries、view、groups、folders 统一只读取有成员关系的媒体，并对重叠根去重。
- [x] 本地库 detail 与 queue expansion 校验成员关系，防止孤儿 media ID 绕过摘要层。
- [x] 保持全局 media/history/online 查询不受本地库过滤影响。
- [x] 保持 track summary DTO、worker 和前端 API 请求形状不变；无成员时复用现有空状态。

## 6. 删除根与运行时失效

- [x] `delete_library_root` 单事务删除根并仅清理失去最后成员关系的媒体。
- [x] 扫描中的根拒绝删除，避免 finalize 竞争。
- [x] HTTP 返回现有媒体计数并增加 history/session/queue/playlist 清理计数。
- [x] 显式删除后使 library、queue、history 和本地歌单消费者失效；升级迁移不发运行时事件。
- [x] 清理结果携带实际删除路径和会话 ID；运行时按身份取消匹配预加载、脱钩当前队列游标、清理活动会话并重新持久化共享队列快照。

## 7. 聚焦验证

- [x] 运行迁移、身份、目录删除、扫描 seen/finalize、playlist cascade、history/session/queue 清理聚焦测试。
- [x] 运行 `cargo fmt --check`。
- [x] 运行 `cargo test --lib`。
- [x] 运行 `cargo check --bin audio_server`。
- [x] 在 `apps/desktop` 运行 `npm run typecheck`；本任务未改变前端解析或事件 DTO，因此未额外运行前端构建。
- [x] 运行 `PRAGMA foreign_key_check` 并断言无悬空引用。

## 8. 当前数据库副本验证

- [x] 使用 SQLite 一致性备份复制当前 `app_state.db` 到工作区临时目录，不直接修改运行中的用户数据库。
- [x] 在副本上执行迁移：验证 local media `371 → 0`、匹配 history `38 → 0`、sessions `20 → 0`、匹配 queue `0 → 0`，20 条 remote media 保留但 library summaries 为 0。
- [x] 验证磁盘受支持媒体文件计数仍为 593，迁移路径没有调用文件删除。
- [x] 在副本上重新添加音乐目录并扫描，确认按当前文件系统重建为 592 个有效成员，而不是恢复 371 条旧快照。

## 9. 收尾

- [x] 更新 `.trellis/spec/backend/database-guidelines.md`，记录显式 root membership、完整清理顺序和扫描成功提交合同。
- [x] 检查只修改本任务相关文件，保留当前工作区其他未提交改动。
- [x] 记录验证命令、迁移计数、剩余风险与回滚说明。
- [ ] 等待用户确认后再进入提交/完成流程。

## 验证记录（2026-07-18）

- `cargo test --lib`: 371/371 passed after runtime queue/session invalidation was added.
- `cargo check --bin audio_server`, `cargo fmt --check`, `git diff --check`, and `apps/desktop npm run typecheck`: passed.
- `cargo clippy --lib --no-deps --message-format=short`: passed with 67 pre-existing repository warnings; no warning points to the new membership or runtime-reconcile helper.
- A SQLite online backup of `C:\Users\Yukina Asaka\AppData\Local\com.audio.desktop\app_state.db` was opened with the project migration code in an isolated copy. Before migration: schema v11, roots 0, local media 371, remote media 20, matching history 38, matching sessions 20. After migration: schema v12, local media 0, remote media 20, library summary 0, history 68, sessions 586, queue entries 0, `foreign_key_check` empty, `integrity_check=ok`.
- The isolated copy was then scanned through the real HTTP library-scan endpoint against `D:\移动云盘挂载\15869685321\Music`: 593 files were enumerated, 592 valid local members were rebuilt, the library API returned 592 tracks, and no `//?/` media IDs remained. The source directory still contained 593 supported files.
- The original user database was never opened for writing; no commit or task archive was performed.

## 风险与回滚点

- migration 12 是破坏性数据库变更；实现阶段先以 in-memory/fixture 和当前数据库副本验证，再允许真实应用启动迁移。
- 成员表建成但读取尚未切换、或读取切换但扫描尚未写成员，都会造成错误空库；这三个步骤必须在同一变更集中完成。
- 不运行 `VACUUM`，避免启动阻塞和额外磁盘峰值；数据库文件物理缩小不属于验收条件。
- 任一聚焦测试、FK check 或副本计数不符合预期时，停止真实数据库验证并回滚本任务代码，不接触用户音频文件。
