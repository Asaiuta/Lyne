# 任务元数据归档一致性修复

## Goal

修复任务元数据层的归档一致性问题：已归档任务的 PRD 验收框未勾选、jsonl manifest 引用已归档路径导致 `task.py validate` 失败，并为 `task.py` 增加防复发机制，使未来归档不再产生悬空引用或未勾选状态。

## Requirements

- 已归档任务的 PRD 验收标准框必须反映完成状态（`- [x]`），勾选须有 `validation-evidence.md` 或其他完成证据支撑。
- 归档任务及其引用方任务的 `implement.jsonl` / `check.jsonl` 中所有路径引用必须存在；归档导致路径失效的引用改指到归档后的实际位置，不丢语义。
- `task.py validate` 对归档任务应能发现并容忍/报出归档类悬空引用；`task.py archive` 应在归档时自动改写受影响引用并校验验收框状态，防止复发。

## Acceptance Criteria

- [x] 三个已归档性能整改任务（08-07-performance-artifact-provenance、08-07-realtime-benchmark-gate-contract、08-07-source-seek-benchmark-hardening）的 PRD 验收框全部勾选，且每个勾选点有对应验收证据（validation-evidence.md）；07-18-fix-orphaned-local-library-media 有证据的 9/10 条已勾选，无证据的前端空状态条目保留未勾选并注明依据。
- [x] 全仓扫描出的 17 处悬空 jsonl 引用全部改指到归档后的实际文件路径，改指后全仓 `task.py validate`（活动 + 归档，134 个任务目录）零失败。
- [x] `task.py validate` 增加归档感知解析（对 `.trellis/tasks/<name>/...` 缺失时尝试 `archive/<YYYY-MM>/<name>/...`），使归档任务的兄弟/自身引用能通过校验（归退回退路径实测通过）。
- [x] `task.py archive` 在归档后自动改写引用该任务路径的 jsonl 条目到归档位置，并对未勾选验收框输出警告（端到端探针验证：create → archive → validate 通过）。
- [x] 既有 archive 与活动任务共 134 个目录全量 `task.py validate` 零失败；回归验证证明防复发机制生效，且无伪勾选（无证据条目保留未勾选 + 注记）。

## Notes

- 轻量任务：PRD-only，无 design.md / implement.md。
- 涉及脚本：`.trellis/scripts/common/task_context.py`（validate）、`.trellis/scripts/common/task_store.py`（archive）。
- 不改变任何产品代码、bench 或运行行为；仅元数据与工具链。
