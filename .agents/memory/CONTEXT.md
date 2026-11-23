# Project Context

Last updated: 2026-11-23T11:24:16.593Z

## Summary

本会话从 session-a8e77e7b-383b-468f-9b36-0ba80ea15a5b 交接（handoff-seed c6171818bd85）。用户裁定「现在就把行内证据一次译完」，于是把回执里由状态核生成的英文数据也本地化：`820583e`（feat(receipts): localize the data inside every receipt, not only the sentence）与 `dffc437`（CHANGELOG 登记）。随后用户追问「都是标准术语吗？」——核对 `docs/GLOSSARY.md` 与 `docs/vocabulary-conventions.md` 后确认概念词合规，但状态词没有规范来源，且两处措辞与 README 既有写法冲突（`/context task` 行、`/session-log tree` 的「父会话 X 不在存档」），改成 README 用词（`2627aca`），再把五套状态词与「证据」的两个义项登记进术语表、把「存档 vs 归档」「已 X vs 名词短语」写成规则（`f1102ba`）。门禁全绿，desktop/web pin 抬到 `f1102ba` 且逐文件 sha256 0 mismatch。用户重启后，用 9230 Inspector 探针逐模块比对 13 个模块全部判「running host executes the code on disk」，真实 `.agents/memory` 上的回执已全中文；`--verify-only` 因脚本回落到旧缺省口 19387 印 5 次 `fetch failed` 的假失败。剩余：406-12 的 tgz 仍停在旧构建、`/autolearn` 原因句残余、工作树里记忆文件待一次记忆 pass 对齐。

## Key points

- 交接来源 session-a8e77e7b-383b-468f-9b36-0ba80ea15a5b，handoff-seed c6171818bd85。
- 行内数据批次：`820583e`（feat）+ `dffc437`（CHANGELOG 登记）；术语修复 `2627aca`（fix(receipts): name the task row and the tree annotation the way the glossary does）+ 术语表登记 `f1102ba`（docs(rules): register the five state vocabularies in the glossary）。`HEAD` = `origin/main` = `f1102ba`。
- 行内词汇落点：`src/project-memory/entry-state.ts`（`ENTRY_STATE_LABEL`、`entryStateOf(tid, facts, language)`）、`prune.ts`（`PRUNE_REASON_LABEL`）、`report.ts`（`--accept` 两支）、`src/project-context/task-usage.ts`（`TASK_STATUS_LABEL` / `taskUsageRow`）、`search.ts`、`session-tree.ts`、`src/project-autolearn/evidence.ts`、`src/project-handoff/command.ts`。
- 刻意保留英文：整理 pass 的提示词、`purge.log` 的机器拼写（数据不是回执）；构建器的 `language` 参数仍默认 `en`，语言在处理器里解析一次。
- 新增用例 4 条（`test/receipt-layout.test.mjs`，各带英文对照）：条目状态词、prune 原因与任务行、find 与会话树计数、autolearn 证据与冲突句；另给中文 handoff 用例补 `固定阈值 300000 token` 断言。
- 术语核对结论：概念词符合规范写法；状态词缺来源且两处与 README 冲突——已改并登记。`docs/GLOSSARY.md` 新增「状态词（代码枚举 ↔ 回执中文）」一节持有五套词；概念表把「证据」拆成「证据目录」与「证据（引用）」。
- 刻意不统一并写成规则：技能 `drifted`=已漂移（完成态）与条目 `anchor-drift`=锚点漂移（名词短语）并存；**存档**是层名与存储、**归档**是动作与状态。
- 门禁：`pnpm typecheck` 0、`pnpm boundary:check` 0 失败、`pnpm docs:check` 0 失败、`pnpm test` 826/826、`pnpm build` 两遍 hash 相同（`lib/` 245 文件）。
- 变异 6 个（回执布局 4 + 术语 2），先编译进 `lib/` 再跑，每个只红对应用例；从 `sha256sum -c` 校验过的 `/tmp/i18n-inline-mut/*.bak` 还原，`git status -- src/` 0 残留。
- desktop/web pin 抬到 `f1102ba`（备份 `*.bak-i18nvocab-20261123`），各 245 文件 0 mismatch；锁文件 resolution commit = `f1102ba`，repo 仍记原 ssh remote。push 第一次报「无法读取远程仓库」，重试成功。
- 重启后验收：9230 Inspector 探针逐模块比 13 个模块（entry-state / report / prune / entry-states / start / task-usage / session-tree / search / context start / autolearn evidence·candidate·start / handoff command）全部 `the running host executes the code on disk`；宿主进程启动 19:12:12，晚于 `f1102ba` 的 19:06:36。
- 真实 `.agents/memory` 上的中文回执已确认：`/memory reconcile` 首行「记忆核对：41 / 260 个条目需要复查」+ 条目状态词中文、`/context task` 行「绑定会话数 / 未完成 todo / 最近活动」、`/session-log tree` 头与尾注、`/autolearn list` 的「证据 N 个会话」、`/memory prune` 保留规则句。
- `--verify-only` 的 FAIL 是假失败：脚本回落到自己的旧缺省口 `http://127.0.0.1:19387`（alpha.2 起宿主 `--port 0`，19387 永不被占——脚本注释自述），本机真实口是 GUI 35687 与 Inspector 9230；验收判据取 9230 探针，不取脚本 RESULT。
- 清掉 `src/project-memory/entry-states.ts` 里重复声明两遍的 `MemoryEntryState` / `MemoryStates`（TS 静默合并，属复制粘贴残留）。

## Open tasks

- 待用户回答：是否把「`--verify-only` 在 rc.x 上回落到 19387 的假失败」写进 `docs/` 技巧记录，免得下次重启验收再误判。
- 406-12 那台机的 tgz 仍停在 `7704e2f`：覆盖同名 tgz、改 `pnpm-lock.yaml` 的 integrity、重解包并逐文件 sha256 比对，再由用户重启那台机宿主。
- 残余（已登记 CHANGELOG）：`/autolearn` 的 admission / skip 原因句（`shapeRejection`、`rejectionReason`、pass 的 `skipped`）在 pass 核里生成、那一刻没有会话语言；要中文化得把「原因」换成「码 + 参数」（`AutolearnOutcome` 类型变更），属单独一批，待用户定是否做。
- 工作树里 `.agents/memory/{CONTEXT,MEMORY}.md` 与 `retired.md` 的未提交改动是既有状态：按写路径纪律等一次记忆 pass 对齐，不手工提交；是否重跑由用户定（`/memory update` 只由用户跑）。
- 待用户决定是否查 `include:subagent-claude-code` 为何 enabled 未 active（外部 profile 项，会持续让重启验收的表印 notActive FAIL）。
- `RULES.md` 第 11 章最后一项：`src/project-memory/consolidate.ts` 仍超 400 行「只减不增」线，属用户裁定项。
- 接第二个宿主前的三件（`docs/host-context-2c-design.md` §6）：`fiber.config` 设置读取换中性接口、服务 getter 成契约接口、事件时序写进契约。
- 设置拆分 6 个待拍板点（`docs/batch-ac-settings-split-spec.md`）待用户定案后单开一批。
- SH-10：确认锁定线 0.1.7-rc.2 是否声明 `compactNow` 与 `agentPresets.serviceFor`，再按 8 条守卫接线。
- `test/context-injection.test.mjs` 的偶发失败仍无定论，需在无并发写入时定位触发条件。
- P0 补强（`/memory` 面板扩展、交接回执可视化）未拍板；dsh-code-index 兼容性试验与 AOCI 可选动作 A/B 均未启动。

<!-- latest-session-title: 行内词汇本地化与术语表落到 f1102ba，重启后驻留宿主已验收 -->
