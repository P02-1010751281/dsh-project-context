# Project Context

Last updated: 2026-11-22T09:38:37.070Z

## Summary

本会话从 session-ebc40ab6 交接而来（链 ebc40ab6 → 41767aa6）。前一段把治理文档重建落成提交 `3c1d6c4 docs(rules): rebuild the governance docs and add a terminology table`（6 文件 +370/−298，新建 `docs/GLOSSARY.md`），经三轮只读对抗审查（adv-c 文档 vs 代码、adv-d 内部一致、adv-e 收口复验）逐条修完并推送。本段做的是残余收口：先按审查遗留核对文档与实现，再提交两笔并推送——`378738f docs(rules): scope the glossary to current docs and fix the AA index rows`（2 文件 +5/−4）与 `37c8ece docs: align the current docs with the glossary and the model-free handoff`（9 文件 +30/−26），`HEAD = origin/main`。修掉的实证错误：`docs/behavior.md` ④ 仍写「摘要输入 / 摘要调用前 / 写摘要的那几秒」，而 `src/project-handoff/summary.ts` 自述 no model call / no budget / no timeout；「种子含 `MEMORY.md`」不成立（`continuation()` 参数里没有记忆正文，`MEMORY.md` 由子会话 systemPrompt 注入）；`README.md` 的「没有更早内容可摘要」与「`handoffBudgetRecentTokens: 0` = 只带摘要」把 `decide.ts` 的 `nothing-to-drop`（`olderTokens < MIN_DROP_TOKENS`）说错；`docs/settings.md` 说「交接摘要的失败重试」受 `maxOutputTokens` 约束，实际该键只被 memory/autolearn 读，交接重试余量是 `max(4096, reasoningTokens)`；`docs/README.md` 把 AA3 标成「未落地」并链到 AA2 §12，实际 AA3 在 `docs/batch-aa-state-machines-spec.md` §12 且已落地（`session-state.ts`，`9a5062d`）；7 个现行文档共 17 处禁用异名（`设置卡`、`记忆整理`、`技能沉淀`、`交接摘要`）已统一，`GLOSSARY` 头部改为明文豁免冻结档案与带日期 spec。门禁：docgate 12 文件失败项 0、锚点 87 条引用 / 84 唯一 / 0 坏、跨文件链接 0 坏、`pnpm test` 787 pass / 0 fail / exit 0、`git diff --exit-code -- lib` 空。首次 push 报「致命错误：无法读取远程仓库」exit 128，`git ls-remote` 成功后重推成功。工作树仍有两处非本任务改动未提交：`.agents/memory/{CONTEXT,MEMORY,retired}.md`（插件记忆 pass 写的）与未跟踪 `.agents/skills/dsh-batch-residual-closure/`。

## Key points

- 治理重建 `3c1d6c4` 后本段再提两笔并推送：`378738f`（GLOSSARY 作用域收紧 + AA 索引行）与 `37c8ece`（9 个现行文档对齐术语表与「交接不调模型」），`HEAD = origin/main`。
- `docs/GLOSSARY.md` 头部明文豁免冻结档案（`.agents/evidence/**`、`docs/archive/`）与带日期 spec，术语规则只约束现行文档。
- 现行文档修掉的错误：`docs/behavior.md` ④ 的摘要器措辞、种子含 `MEMORY.md` 的说法、`README.md` 的「没有更早内容可摘要」与「0 = 只带摘要」、`docs/settings.md` 说 handoff 受 `maxOutputTokens` 约束、`docs/README.md` 把 AA3 标未落地并链错章节。
- 实现侧核对：`continuation()` 不含记忆正文；`nothing-to-drop` 来自 `decide.ts` 的 `olderTokens < MIN_DROP_TOKENS`；`maxOutputTokens` 只被 `consolidate.ts` 与 `project-autolearn/pass.ts` 读；交接重试余量是 `Math.max(RETRY_OUTPUT_HEADROOM_TOKENS, attempt.reasoningTokens)`。
- 现行文档 7 个文件共 17 处禁用异名（`设置卡`、`记忆整理`、`技能沉淀`、`交接摘要`）已改为规范术语；`batch-*-spec.md` 与 `docs/archive/` 里仍有 5 处旧词，属豁免区。
- 门禁实测：docgate 12 文件失败项 0；锚点 87 条引用 / 84 唯一 / 0 坏；跨文件链接 0 坏；`pnpm test` 787 pass / 0 fail / exit 0；`git diff --exit-code -- lib` 空。
- 锚点脚本报的 `START LINE BLANK`（区间起点落在空行）与 `bare missing`（裸文件名）不是坏链；它只证文件存在与行号在范围内，符号名仍靠人工抽查。
- 首次 `git push` 报「致命错误：无法读取远程仓库」exit 128，`git ls-remote origin` 成功后再推即成功。
- `RULES.md` 3.2 与 4.2 把基线数字（大文件行数、依赖 7 边 / 12 specifier / 14 处）写进规则，是唯一允许写死基线的地方，文件一变就要同步改规则。
- 工作树未提交：`.agents/memory/{CONTEXT,MEMORY,retired}.md` 与未跟踪 `.agents/skills/dsh-batch-residual-closure/`。

## Open tasks

- 用户裁定 `RULES.md` 第 11 章三项（各带 2026-12-31 复查日）：大文件拆分（`src/project-memory/consolidate.ts`、`index.ts` 超过「只减不增」400 行线）、辅助调用超时要不要真实现（`src/shared/model-call.ts` 无 timeout）、证据冻结前豁免。
- 406-12 用户侧目视验收：设置卡三页签（记忆/技能/交接）加新选项、`/session-log status`、`/autolearn status` 首行带分母、跑一次 `/memory update` 看首行 `Restored: N entry(ies)`。
- 设置拆分 6 个待拍板点（`docs/batch-ac-settings-split-spec.md`）待用户定案后单开一批。
- SH-10：先确认锁定线 0.1.7-rc.2 是否声明 `compactNow` 与 `agentPresets.serviceFor`，再按 8 条守卫接线。
- 15 条 `content-stale` 条目的 `/memory reconcile --accept <id>` 清单按用户需要重贴。
- `batch-*-spec.md` 与 `docs/archive/` 里 5 处旧词是否要求全仓统一（需另开一次历史档案改词提交）。
- `RULES.md` 第 6 章与 `docs/development.md` 的门禁命令与产物纪律文字重复，是否收敛到一处待定。
- adv-c / adv-d / adv-e 三份审查报告尚未冻结进 `.agents/evidence/`，要不要留档待用户决定。
- `test/context-injection.test.mjs` 偶发失败仍未定性，需在无并发写入时复现。
- .agents/memory/{MEMORY,CONTEXT,retired}.md 的工作树改动与未跟踪 `.agents/skills/dsh-batch-residual-closure/` 的归属待定。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）未拍板；可选 `dsh-code-index` 兼容性试验与 AOCI 可选动作 A/B 均未启动。
- 每次改 profile 设置或重启前复读 `cordis.patch.yml` 的 `maxMemoryChars`（当前 52000）与 `subagent-codex` 的 `model` 一行，防设置卡整份回写冲掉手改值。

<!-- latest-session-title: 治理文档重建后的残余收口：术语统一、无模型交接写法与 AA3 索引纠正 -->
