# Retired memory entries

- 2026-11-11 · Z4 清洗通道（`src/project-memory/prune.ts`）：备份只留最新 3、`memory-log-*.jsonl`/`memory.jsonl.*.tmp` 超 90 天、`errors.log` 超 1 MB 归档后原地截断、`skill-candidates/*.md` 超 60 天；`se… · superseded
- 2026-11-21 · Tier C 只数结构性丢失（`sectionDropped` / `droppedItems` / `itemTruncated`），所以一个用压缩措辞重生成文档的 pass 报零、状态干净 `updated` 而事实消失；字节相同的往返只证明结构、绝不证明存活——重写度量把这种丢失报在 `/memory upda… · superseded
- 2026-11-21 · 重启验证脚本可能因为与本仓库无关的原因印 `RESULT: FAIL`：`/etc/nixos/scripts/dsh-desktop-restart.sh --verify-only` 在另一个无关 desktop 活着时失败，验收脚本自己的 `title-load verify` 一半在重启后重跑判据前也失败。 · superseded
- 2026-11-22 · `RULES.md` 有四处要求无实现或被现状违反：7.3 的辅助调用超时（`grep timeout src/shared/model-call.ts` 无输出，`requestOptions` 只透传 `signal`）、3.2 的 ≤900 行（`project-memory/index.ts` 1246、`c… · anchor-drift
- 2026-11-22 · 文档间相对链接按文档自身目录解析（`docs/` 内写 `./behavior.md`、出目录写 `../RULES.md`），不写仓库根相对路径；`.agents/evidence/**` 是冻结证据、描述的是当时读到的树，绝不回改。 · anchor-drift
