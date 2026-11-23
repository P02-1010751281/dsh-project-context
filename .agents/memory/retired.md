# Retired memory entries

- 2026-11-11 · Z4 清洗通道（`src/project-memory/prune.ts`）：备份只留最新 3、`memory-log-*.jsonl`/`memory.jsonl.*.tmp` 超 90 天、`errors.log` 超 1 MB 归档后原地截断、`skill-candidates/*.md` 超 60 天；`se… · superseded
- 2026-11-21 · Tier C 只数结构性丢失（`sectionDropped` / `droppedItems` / `itemTruncated`），所以一个用压缩措辞重生成文档的 pass 报零、状态干净 `updated` 而事实消失；字节相同的往返只证明结构、绝不证明存活——重写度量把这种丢失报在 `/memory upda… · superseded
- 2026-11-21 · 重启验证脚本可能因为与本仓库无关的原因印 `RESULT: FAIL`：`/etc/nixos/scripts/dsh-desktop-restart.sh --verify-only` 在另一个无关 desktop 活着时失败，验收脚本自己的 `title-load verify` 一半在重启后重跑判据前也失败。 · superseded
- 2026-11-22 · `RULES.md` 有四处要求无实现或被现状违反：7.3 的辅助调用超时（`grep timeout src/shared/model-call.ts` 无输出，`requestOptions` 只透传 `signal`）、3.2 的 ≤900 行（`project-memory/index.ts` 1246、`c… · anchor-drift
- 2026-11-22 · 文档间相对链接按文档自身目录解析（`docs/` 内写 `./behavior.md`、出目录写 `../RULES.md`），不写仓库根相对路径；`.agents/evidence/**` 是冻结证据、描述的是当时读到的树，绝不回改。 · anchor-drift
- 2026-11-22 · handoff 没有自己的 provider/model 配置键：`resolveTarget`（`src/project-handoff/runtime.ts:128`）先用插件配置再退回会话请求头，所以模型切换只有在该头被重写后才生效，且 `gate.ts` 的 `resolveModelInfo` 对过期配对抛… · anchor-drift
- 2026-11-23 · 判浏览器是否拿到新的客户端代码，别把服务端响应与安装文件整文件比 sha256：combo `?rev=` 响应在安装字节之后多一行 `\n;\n//# sourceMappingURL=…&rev=<rev>`（2026-11-21 那次多 76 字节），所以只比前 `installedBytes` 字节，并按宿主… · superseded
- 2026-11-23 · `src/project-handoff/summary.ts` 拥有交接的对话切分与「摘要」面，自述 no model call、no output budget、no timeout——判交接有没有模型调用读它，而不是读 `docs/architecture.md`。 · superseded
- 2026-11-23 · `.agents/skills/dsh-command-receipt-localization/SKILL.md`（autolearn 派生、受跟踪，`3348b41`）拥有把回执接到会话语言的流程：`receiptLanguage` 单一入口、中英标点分开、中英双断言加变异轮，以及碰 `src/shared/` … · superseded
