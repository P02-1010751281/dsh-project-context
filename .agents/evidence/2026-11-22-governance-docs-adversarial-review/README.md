# 治理文档对抗审查（2026-11-22）

## 对象与方法

被测对象是重建后的 `RULES.md`、`AGENTS.md`、`docs/architecture.md`、`docs/GLOSSARY.md`（基线 `9ed4369`，
重建落 `3c1d6c4`）。三个独立 subagent 做只读对抗审查：不允许改文件、不允许跑会写 `lib/` 的命令；
每条结论必须带命令与输出，只报能被证伪的条目。`adv-a` 中途失败、没有输出；`adv-b` 是本批更早的
冷读（只核尺寸、链接与符号抽查），不列为对抗轮。

## 来源

三份附件从本机的归档会话日志复制（会话 `session-6a120da1-d436-4c96-9fcd-626d6ac374db`，
`session.jsonl` 的 `text` 字段），不是重新叙述的摘要：

- `adv-d.md`：第二轮内部一致/可操作性审查（98 条检查，8 错误、14 警告）。
- `adv-e.md`：收口轮，验证 12 条修复（8 成立/3 不精确/1 不成立）并新增 11 条发现。
- `adv-c-partial.md`：第一轮文档 vs 代码审查。归档的交接消息在 B 段被裁剪，只有 A 段（RULES 表）
  可恢复；B 段（AGENTS 表）的结论当时已用于修复，但原文不可恢复，这里不伪造。

## 处置

| 来源 | 发现 | 处置 |
|---|---|---|
| adv-c | `consolidateProject` 锚到 `consolidate.ts:296`（实为 `index.ts:296`） | 已改为 `index.ts:296` + `consolidate.ts:698`（`3c1d6c4`） |
| adv-c | 备份「保留 5 份 / 1 小时内不删」漏硬上限 20 | 已按 `backup.ts` 写全（`3c1d6c4`） |
| adv-c | tier C 锚点是分支标志而非日志点 | 已改指 `consolidate.ts:1111` 与 `index.ts:358` |
| adv-c | `shared` 反向依赖 `project-handoff/language` 未点明 | 已在 §2 写成唯一例外（`3c1d6c4`） |
| adv-c | 条目核没有 severity 表 | 已改为 `NON_RETIRING_STATES`/`retiresEntry` |
| adv-c | `assertNever` 并非所有枚举分支都用了 | 5.5 改为「穷尽」，给出现有用法与判据 |
| adv-c | GLOSSARY 的整理/交接/条目/墓碑锚点不精确 | 已带符号名（`consolidateProjectState`、`performHandoff`、`entryTid`、`appendTombstones`） |
| adv-d | 2.1 与 2.4 提交规则冲突 | 2.1 扩为治理文档集合；2.4 改为「规则先提交、代码提交点名规则号」 |
| adv-d | 3.6 指向不存在的文档门禁 | 判据改为 `scripts/check-docs.mjs` |
| adv-d | 6.6 与 `pnpm test` 自相矛盾 | 改为禁「无参数的 `node --test`」 |
| adv-d | 9.1「同步两个 profile」与「profile 只读」冲突 | 改为「给出改法清单，由用户按 9.2 执行」 |
| adv-d | 多数规则无判据也未标软规则 | 补判据命令或标软规则（3.4/4.5/7.4/7.6/5.6） |
| adv-d | 4.2 判据可被「删一条加一条」绕过 | 判据改为 `文件:行` 集合 + specifier 名单逐条比对，脚本执行 |
| adv-d | 8.2 漏「版本目录加一行」 | 已补 |
| adv-d | 6.3 要求用例名但 CHANGELOG 没有 | AC 条目补用例文件与用例名 |
| adv-d | 新增插件清单在 RULES 与 architecture 重复 | architecture §12 指向 RULES 4.1 |
| adv-d | §8 数据树漏 `retired.md`、`purge.log`、`trash/`、`skill-bindings.json`、`expired-skills/` | 已补 |
| adv-d | §11「绝不自动改写文件」与技能 `expired` 自动移出矛盾 | 改为列出三处自动落盘（INDEX 对账、条目退休、技能移出） |
| adv-d | 门禁命令在 RULES 与 development 重复 | RULES §6 声明权威；development 加同样声明并加文档门禁 |
| adv-e | 「唯一自动改写是技能 expired」漏了 `INDEX.md` 启动对账 | 已改为三处（`index.ts:152`、`consolidate.ts:810`、`skill-state-source.ts:227`） |
| adv-e | 5.1「唯一值依赖 schemastery」不成立 | 改为 host 侧口径，客户端 `react` / `ui-primitives` 由 devDependencies 供 |
| adv-e | 7.2「写盘只有两条路」与 `appendFile` 反例冲突 | 改为「覆盖写两条路；append 走各自有界通道」 |
| adv-e | 4.2 specifier 名单不存在、只对计数 | architecture §2 补 12 个 specifier 名单；判据由脚本逐条比对 |
| adv-e | `git diff --numstat` 看不见已暂存净增 | 改为 `git show --numstat` / `git diff HEAD --numstat` |
| adv-e | 2.1 判据未排除 `lib/`、`README.md`、`.agents/` | 已收窄判据路径集合 |
| adv-e | CHANGELOG 只写中文变异描述、没写用例名 | 已补英文用例名 |
| adv-e | `docs/README.md` 的 AA3「未落地」、`pnpm test 756` 过期 | 已改为 AA3 已落地并指向 AA 规格 §12 |

## 仍未处理（需要用户裁定，不在本目录的验收范围）

- `RULES.md` 第 11 章三项未决：大文件拆分、辅助调用超时、证据冻结前豁免。
- 406-12 的目视验收与设置拆分的 6 个拍板点。

## 复验

```bash
pnpm docs:check     # 链接 / 锚点+符号 / 3.2 基线 / 4.2 白名单
pnpm typecheck
pnpm test           # 含 test/doc-governance.test.mjs
```
