# 技术设计

## 设计目标

建立明确的“目录根拥有媒体”关系，替代当前把 `media_items` 全表和路径前缀推断同时当作本地库真相的做法。删除目录、成功重扫和升级修复使用同一套完整清理事务；数据库记录及应用引用可以删除，但任何路径都不得删除用户的音频文件。

## 核心不变量

1. `media_items` 只保存媒体元数据，不再隐含“属于本地库”。
2. 本地库成员的唯一真相是有效 `library_roots` 与媒体之间的显式关系。
3. 一个媒体可以同时属于多个重叠目录根；只有失去最后一个根成员关系时，才能完整清理媒体及引用。
4. 清理目标始终携带数据库实际存储的 `media_id` 和 `source_path`。规范化 ID 只用于比较和兼容引用，不能替代实际主键执行删除。
5. 扫描失败或取消不改变已提交成员关系；只有完整成功的扫描才能原子替换该根的成员集合并清理失效项。
6. 完整清理删除应用数据库中的媒体、历史、会话、持久化队列和依赖引用，但不调用任何用户媒体文件删除 API。

## Schema

新增迁移版本 12 和关系表：

```sql
CREATE TABLE library_root_memberships (
    root_id    INTEGER NOT NULL,
    media_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (root_id, media_id),
    FOREIGN KEY(root_id) REFERENCES library_roots(root_id) ON DELETE CASCADE,
    FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
);

CREATE INDEX idx_library_root_memberships_media_id
    ON library_root_memberships(media_id);
```

使用复合主键支持重叠根去重；反向索引用于判断媒体是否仍被其他根拥有。关系表不保存路径副本，避免第三份路径真相。

## 升级迁移

迁移 12 在单一事务内按以下顺序执行：

1. 幂等创建成员表和索引。
2. 读取现有根与媒体，使用实际 `media_id` 回填可证明的成员关系。
3. 本地根使用共享的路径规范化和目录边界判断；`D:/Music2` 不得被视为 `D:/Music` 的子路径，普通路径、`\\?\` 和 `//?/` 变体必须等价。
4. WebDAV 根通过 `source_key` 对应配置计算有效根 URL；使用结构化 URL 的 origin 与路径段边界匹配，并排除已有 `ncm_track_sources` 的在线媒体。重叠 WebDAV 根允许多重成员关系。
5. 找出 `source_kind='local'` 且没有任何成员关系的媒体，作为升级清理目标。远程孤儿不按本地文件规则自动删除，但没有成员关系时不会出现在本地库。
6. 调用共享完整清理事务删除目标及引用，然后才记录 schema version 12。

当前用户数据库没有目录根，因此 371 条本地媒体全部属于可确定的孤儿目标；20 条远程媒体保留为在线/全局元数据，但不会进入本地库。

迁移失败时整个版本 12 回滚，不记录版本号。迁移成功后不自动执行 `VACUUM`：SQLite 空闲页可复用，避免在启动期间复制约 224 MB 数据库或长时间独占文件。

## 完整清理事务

在 `app_database` 内新增单一事务帮助器，输入为实际 `(media_id, source_path)` 目标集合，输出结构化计数报告。为兼容旧身份，同时构造实际 ID、`media_id_for_path(source_path)` 和规范化路径集合。

删除顺序：

1. 删除匹配的 `playback_history`，避免其 `session_id` 阻止后续会话删除。
2. 删除匹配的 `playback_sessions`。
3. 删除匹配的 `playback_queue_entries`，并清除 `playback_queue_state` 中匹配的 current/pending 路径。
4. 删除 `local_playlist_items` 并重排受影响歌单；清空匹配的 `local_playlists.cover_media_id`。
5. 删除 `ncm_track_sources`、`cover_art_cache` 和根成员关系。
6. 最后按实际存储的主键删除 `media_items`。

引用匹配同时检查实际/规范 ID 与规范化 source path，覆盖历史表中 ID 已规范化、媒体主表仍是遗留 `//?/` ID 的情况。所有步骤共享一个 SQLite transaction；任一步失败则不提交部分清理。

该帮助器复用于：

- schema 12 升级清理；
- 显式删除目录根；
- 成功重扫后的失效成员清理；
- 现有显式“从库删除”媒体 API，避免继续保留多套不一致的引用策略。

磁盘文件删除端点仍先通过现有安全边界显式删除用户选择的文件，再调用数据库清理；本任务不会让目录删除或迁移进入该文件删除路径。

## 扫描提交合同

### 本地扫描

`load_scan_snapshot(root_id)` 只读取该根的已提交成员，并返回实际 `media_id`、source path、mtime、大小和封面文件信息。

临时 seen 集从“由路径重新计算的 ID”改为“数据库实际/写入后返回的 ID”：

- 未变化文件直接使用 snapshot 中的实际 ID；
- 新增或变化文件使用 metadata batch 返回的最终 ID；
- identity merge/rename 同步更新 `library_root_memberships` 引用。

扫描完全成功后，在一个事务中：

1. 将 seen IDs upsert 为该根成员；
2. 删除该根未 seen 的成员；
3. 对失去最后一个根成员关系的媒体执行完整清理；
4. 更新根的完成状态和 track count；
5. 清空临时 seen 集。

扫描失败、写入失败或取消只清空临时 seen 集，不替换成员集合、不清理旧媒体。

### WebDAV 扫描

WebDAV 成功索引同样记录返回的媒体 ID，并在成功结束时原子替换该根成员。这样 NCM/普通远程媒体不会因同在 `media_items` 中而混入 WebDAV 库，删除 WebDAV 根也能只清理其独占媒体。

## 删除目录根

`delete_library_root(root_id)` 改为单事务：

1. 读取根和其成员；不存在则返回 `None`。
2. 删除根，依靠 FK 移除该根成员关系。
3. 仅选择已无其他成员关系的媒体进行完整清理。
4. 返回 `LibraryCleanupReport`；HTTP 保留现有 `removed_media_count` 并增加历史、会话、队列等计数字段，属于向后兼容的响应扩展。

如果根正在扫描，删除请求返回冲突而不是与扫描提交竞争。前端目前会在扫描时禁用按钮，后端校验用于覆盖直接 API 调用。

## 本地库读取合同

以下读取统一通过 `EXISTS (SELECT 1 FROM library_root_memberships ...)` 限定成员，并对重叠根去重：

- `library_summary_stats()`
- `list_library_track_summaries()`
- `library_track_view()` / `library_track_groups()`
- folder descriptors 与 worker 初始化载荷
- track detail、track-key/media-id 队列扩展等本地库专属查找

`get_media_items()`、播放历史和在线媒体补充查询继续是全局媒体接口，不复用本地库过滤。无根或无成员时，本地库统计与列表均为 0；前端保持稳定侧栏入口并渲染现有空状态，无需新增前端状态分支。

## 事件与缓存一致性

显式目录删除成功后：

- 刷新本地库与本地歌单的现有 HTTP 数据；
- 发出 queue/history 更新事件，使已挂载的队列抽屉和最近播放页失效；
- 更新 backend/shared queue snapshot，避免数据库已删而运行时仍广播旧持久化队列。

升级迁移发生在 HTTP/WS 服务启动前，不需要运行时事件。

## 兼容与风险

- 现有 API 请求形状不变；删除根响应只增加计数字段。
- 新建数据库直接得到空成员表；已有有效根通过迁移回填，不要求先手动重扫。
- 路径/URL 归属判断必须是共享纯函数并有 Windows、UNC、大小写、边界和 WebDAV 测试，不能散落字符串 `starts_with`。
- 删除是用户确认的破坏性数据库迁移。事务保证失败不产生半清理，但成功后历史与会话按需求不可恢复；音频文件仍可通过重新添加目录重建媒体库。
- 不在本任务中压缩数据库文件、删除用户音频、重做离线侧栏或改变在线播放历史策略。

## 任务拆分决定

不拆父子任务。schema、扫描提交和查询过滤必须在同一次实现中切换；只落地其中任一部分都会产生空库、漏清理或重新显示孤儿数据，无法形成独立可交付状态。
