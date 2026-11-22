# Project Context

Last updated: 2026-11-22T09:53:52.213Z

## Summary

本会话从 session-ebc40ab6 交接而来（链 ebc40ab6 → 41767aa6）。前半段是治理重建后的残余收口，已推两笔：`378738f docs(rules): scope the glossary to current docs and fix the AA index rows` 与 `37c8ece docs: align the current docs with the glossary and the model-free handoff`，修掉 `docs/behavior.md` 的摘要器措辞、种子含 `MEMORY.md` 的错误说法、`README.md` 对 `nothing-to-drop` 与 `handoffBudgetRecentTokens: 0` 的误述、`docs/settings.md` 说 handoff 受 `maxOutputTokens` 约束、`docs/README.md` 把 AA3 标未落地并链错章节，并统一 7 个现行文档的 17 处禁用异名。用户随后说「请全部修复」，本段把剩余可自主修的缺口全部落地，共 6 笔提交并推送，`HEAD = origin/main = 0d31478`：新增仓库自带文档门禁 `scripts/check-docs.mjs`（`pnpm docs:check`）与 `test/doc-governance.test.mjs`（仓库通过加五条失败夹具，变异只让对应用例变红）；`RULES.md` 3.2 / 3.6 / 4.2 改指该脚本、6.1 要求文档改动另跑门禁；`AGENTS.md` 与 `docs/development.md` 各加一行并声明 RULES 第 6 章权威；`docs/architecture.md` §2 补 12 个 specifier 名单使 4.2 可机器比对；冻结档案 5 处旧词统一（`batch-aa` 条目 id、`batch-ac` 设置卡片、`batch-z-six` 沉淀）；`README.md` 的「≤150 行」改成篇幅现读；adv-c/adv-d/adv-e 三份对抗审查冻结进 `.agents/evidence/2026-11-22-governance-docs-adversarial-review/` 并附逐条处置表；未跟踪的 autolearn 技能 `dsh-batch-residual-closure` 入库；记忆 pass 的快照一并提交，工作树干净。门禁实测：`pnpm docs:check` 135 项 0 失败 exit 0、`pnpm test` 793 pass / 0 fail / exit 0、提交前后 `git diff --exit-code -- lib` 皆空。`git push` 再次先报「致命错误：无法读取远程仓库」exit 128（并出现 `Connection closed by 198.18.0.179 port 443`），`git ls-remote` 成功后重推成功。`test/context-injection.test.mjs` 连跑 30 次全红 0，仍属「偶发、未定性」。剩下的是需要用户拍板或用户动作的项。

## Key points

- 本段 6 笔提交已推送，`HEAD = origin/main = 0d31478`：`855f603 feat(scripts)`（文档门禁）、`4798baa docs(rules)`（判据改指门禁）、`1fe881d docs`（指南加门禁行 + 冻结 spec 术语）、`a4e534d docs(evidence)`（冻结审查）、`db9b4f2 chore(skills)`（跟踪 autolearn 技能）、`0d31478 docs(memory)`（记忆快照）。
- 文档门禁 `scripts/check-docs.mjs` 查五类：受跟踪文档的相对链接（跳过代码块与行内代码示例）、`path:line` 锚点是否越界、紧邻锚点的符号是否落在那行的窗口内、`RULES.md` 3.2 的大文件基线、4.2 的依赖白名单；首行印条目计数与失败数，退出码 0 为通过。
- `test/doc-governance.test.mjs` 钉两个方向：仓库自身通过，加坏链 / 越界锚点 / 符号不在位 / 基线不符 / 白名单外 import 五条失败夹具；变异（关掉链接的 fail 分支）只让链接用例变红，其余 5 条保持绿。
- 接线：`RULES.md` 3.2 / 3.6 / 4.2 改指脚本、6.1 要求文档改动另跑 `pnpm docs:check`；`AGENTS.md`、`docs/development.md` 只答「什么时候跑哪条」并声明 RULES 第 6 章权威；`package.json` 新增 `docs:check`（先 `tsc` 再跑脚本）。
- `docs/architecture.md` §2 现在明文列出 12 个 specifier，门禁拿 `src/` 实际 import 逐条比对，所以增删跨插件 import 必须同时改表——4.2 从人工比对变成可运行判据。
- 冻结档案旧词统一：`docs/batch-aa-state-machines-spec.md`（尾标→条目 id）、`docs/batch-ac-settings-split-spec.md`（设置卡→设置卡片）、`docs/batch-z-six-problems-spec.md`（技能沉淀）；`README.md` 的「≤150 行」改为篇幅现读。
- 对抗审查留档在 `.agents/evidence/2026-11-22-governance-docs-adversarial-review/`：adv-c 仅部分版（B 段在归档交接里被裁，README 已注明）、adv-d、adv-e 原文加逐条处置表（adv-e 结论：12 条修复中 8 条成立、3 条仍不精确、1 条不成立）。
- 未跟踪的 autolearn 技能 `dsh-batch-residual-closure` 已随 `db9b4f2` 入库，工作树现在干净（记忆快照也已在 `0d31478` 提交）。
- 门禁实测：`pnpm docs:check` → 135 项（33 链接文件 / 81 锚点 / 18 符号 / 2 基线 / 1 依赖检查）0 失败 exit 0；`pnpm test` → 793 pass / 0 fail exit 0；提交前后 `git diff --exit-code -- lib` 皆空。
- `test/context-injection.test.mjs` 连跑 30 次全绿（0 红），本轮无法复现，仍按「偶发、未定性」记录。
- `git push` 再次 exit 128「无法读取远程仓库」并伴 `Connection closed by 198.18.0.179 port 443`；`git ls-remote origin` 成功后再推即成功（`37c8ece..0d31478`），判据看 push 退出码与 `HEAD` 对 `origin/main`。

## Open tasks

- 用户裁定 `RULES.md` 第 11 章三项（各带 2026-12-31 复查日）：大文件拆分（`src/project-memory/consolidate.ts` 与 `index.ts` 超过「只减不增」400 行线）、辅助调用超时要不要真实现（`src/shared/model-call.ts` 无 timeout，`requestOptions` 只透传 `signal`）、`3.7` 冻结前豁免要不要写明文。
- 406-12 用户侧目视验收：设置卡片三页签（记忆/技能/交接）加新选项、`/session-log status`、`/autolearn status` 首行带分母、跑一次 `/memory update` 看首行 `Restored: N entry(ies)`。
- 设置拆分 6 个待拍板点（`docs/batch-ac-settings-split-spec.md`）待用户定案后单开一批。
- SH-10：先确认锁定线 0.1.7-rc.2 是否声明 `compactNow` 与 `agentPresets.serviceFor`，再按 8 条守卫接线。
- 15 条 `content-stale` 条目的 `/memory reconcile --accept <id>` 清单按用户需要重贴。
- `test/context-injection.test.mjs` 连跑 30 次全绿仍未定性，需在无并发写入时定位偶发失败的触发条件。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）未拍板；可选 `dsh-code-index` 兼容性试验与 AOCI 可选动作 A/B 均未启动。
- SSH 远端间歇性不可达（`Connection closed by 198.18.0.179 port 443`）：若需复核远端，等网络恢复后跑 `git ls-remote origin`。
- 每次改 profile 设置或重启前复读 `cordis.patch.yml` 的 `maxMemoryChars`（当前 52000）与 `subagent-codex` 的 `model` 一行，防设置卡整份回写冲掉手改值。

<!-- latest-session-title: 治理文档缺口全修：仓库文档门禁、审查留档与术语收尾 -->
