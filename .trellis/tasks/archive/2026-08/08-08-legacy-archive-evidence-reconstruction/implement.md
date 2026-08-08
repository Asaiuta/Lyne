# Implement — 旧归档任务验收证据重建

## 阶段 0：盘点（约 20 任务）

- [ ] 生成任务 × 验收点清单（脚本：解析 PRD 验收节 + 未勾选数 + 目录文件清单 + check.jsonl 条目）。
- [ ] 生成 git 考古索引：每任务 slug 关键词 → `git log --all --oneline --grep` 候选。

## 阶段 1：逐任务证据采集与判定（19 + 1）

顺序（从证据预期多到少）：

1. `07-02-frontend-lyric-fixes`、`07-02-player-seek-race`、`07-05-splayer-color-system-unification`、`07-05-splayer-detail-pages-visual-parity-pass2`、`07-04-07-05-detail-page-routes`（S1 有 implement.md 验证文本）
2. `05-31-local-library-worker-virtualization`、`06-03-fix-audio-callback-playback-hang-and-realtime-alloc-safety`、`06-08-server-netease-proxy-path-security`、`07-04-07-05-content-page-cleanup`、`07-04-07-05-search-page-isolation`、`07-05-remaining-detail-page-routes`（check.jsonl 有结果文件指向）
3. 其余无 S1 信号任务：`06-01-frontend-tech-debt-cleanup`、`06-01-introduce-playback-context`、`06-01-persist-navigation-and-page-state`、`06-01-virtualize-discover-and-comment-lists`、`07-02-frontend-security`、`07-02-server-blocking-handlers`、`07-02-server-token-log`、`07-13-frontend-lossless-performance`
4. `07-18-fix-orphaned-local-library-media` 前端空状态条目（已知无归档证据，确认判定）

每任务流程：读 prd 验收点 → S1 查记录 → S2 `git log --grep` / `-S` → S3 查测试/产物存在 → 判定 → 写矩阵行。

## 阶段 2：产出与一致性

- [ ] 写 `research/evidence-matrix.md`（全量条目 × 判定 × 级别 × 来源）。
- [ ] 更新各 PRD：达成 → 勾选 + 来源注记；部分/不可重建 → 保留未勾选 + 具体判定注记（删除模板注记文本）。
- [ ] 一致性脚本：矩阵判定 ↔ PRD 勾选双向核对。
- [ ] 全仓 `task.py validate` 零失败。

## 阶段 3：收尾

- [ ] journal 记录判定统计（达成/部分/不可重建 数量）。
- [ ] 按既有流程提交（脚本 + 任务目录 + 修改的归档 PRD 采用此前一致策略：旧归档 PRD 不强制入 git 面，除非用户另行要求；本次任务自身目录随提交）。
- [ ] 归档本任务（验收框按实际完成勾选）。

## 验证命令

```bash
python .trellis/scripts/task.py validate <dir>          # 单任务
python - <<PY  # 全量 134 目录
import pathlib, subprocess
root = pathlib.Path(".trellis/tasks")
for d in sorted([p.parent for p in root.rglob("task.json")]):
    r = subprocess.run(["python", ".trellis/scripts/task.py", "validate", str(d)],
                       capture_output=True, text=True, encoding="utf-8")
    assert "All validations passed" in r.stdout, d
PY
git show <hash> --stat                                   # 复核证据提交
```
