# Project Context

Last updated: 2026-11-11T03:39:09.618Z

## Summary

本会话（session-5f3fb68a）由 session-0f1996da 交接而来（meta 带 kind=handoff / parentId=0f1996da，种子落地前写入），继续 Z8 批次的重启后生效验收，并在收口时遇到一次非用户触发的自动整理 pass（2026-11-11T03:33:10Z）重写了两份记忆文档。验收结论：宿主 pid 71971 启动 10:41:56 晚于最后 src/ 提交 b2798e5（10:35:15），lib 里 Z7 createdDir、Z8a HandoffRouteError/withRouteFailure、Z8b build/renderSessionTree、Z8c rmdir 在位，--verify-only PASS（255 条目、enabled 非 active = 0），cordis Config 的 project-context 为 schema，启动后无新 crash、errors.log 无新行。Z8b 由用户实跑 /session-log tree 证实，输出与离线渲染逐字一致（196 session · 194 root · 2 handoff continuation，链 8c58ea1f → 19b9f719 → 0f1996da）；Z4 由 03:16:22Z 的 pass 证实（purge.log reason=auto removed=1 bytes=44482，trash/2026-11-11.tar 存在）。Z2 在 11:29 已按 cap-guard 落地（压 9 条释放 1,076 字符、recordMemoryDocument 落盘、stampEntryIds 盖 138 条、recordEntryDates 写 entries.json，44,897/45,000），提交 a8593e9。但 03:33:10Z 的自动 pass 重写 MEMORY.md：44,218 字符、四节 17/64/43/15 条（条目数不变）、11 条被改写或替换（10 条同头改写，Z4 清洗条目退役并写入 retired.md，1 条移入 Index）；该 pass 还把 CONTEXT 写成 44,897/138 标记，与磁盘矛盾，本轮已校正。重写后带 id 需 45,046 > 45,000（差 46 字符），retireWithinBudget 按设计再次推迟盖章，entries.json 仍是 11:29 的 138 条。该 pass 误报 107 条 no longer present：removedSectionEntries 用 normalizeMemoryEntry 逐字比较，旧文档条目带 （xxxx） 而新文档没有，64+43=107，是错误归因不是丢失。存档现在是 197 目录 / 197 meta / 196 行索引 / 0 悬空 / 0 空目录，唯一无行的是本会话（活着，归档时才补行）。11:31 autolearn 生成并提升了 dsh-batch-landing-acceptance-audit 技能。本轮把 pass 产物、校正后的 CONTEXT、retired.md 与该技能一并提交；src/ 未动。自动交接：本会话上下文已越 157,000 阈值，轮末评估。

## Key points

- 生效判据两条同时成立：宿主 pid 71971 启动 10:41:56 晚于最后 `src/` 提交 b2798e5（10:35:15），且 `lib/` 特征点在位（Z7 `createdDir`、Z8a `HandoffRouteError`/`withRouteFailure`、Z8b `build/renderSessionTree`、Z8c `rmdir`）；`--verify-only` PASS（255 条目、enabled 非 active = 0），cordis Config 的 `project-context` 为 schema，启动后无新 crash、errors.log 无新行。
- 存档现在是 197 目录 / 197 带 meta / 196 行索引 / 0 悬空 / 0 空目录；唯一带 meta 却没有索引行的是本会话 session-5f3fb68a（kind: handoff、parentId: 0f1996da，活着的会话在归档时才补行），所以 197/196 是正常状态，不是悬空。
- Z8b 宿主命令面通过：用户贴的 `/session-log tree` 输出与离线渲染逐字一致——表头 `196 session(s) · 194 root(s) · 2 handoff continuation(s)`，链 8c58ea1f → 19b9f719 → 0f1996da 缩进正确；孤儿作根、环终止、子代理隐藏但计数、500 行上限由 `test/session-tree.test.mjs` 钉住。
- Z4 清洗通道通过：2026-11-11T03:16:22Z 的自动 pass 写了 `purge.log` 一行（reason=auto removed=1 bytes=44482，trash=.agents/memory/trash/2026-11-11.tar），tar 存在；没删东西的 pass 不写行，所以「行数未增」不能判 Z4 未生效。
- Z2 在 11:29 已落地（压缩 9 条释放 1,076 字符、`recordMemoryDocument` 落盘、`stampEntryIds` 盖 138 条、`recordEntryDates` 写 entries.json，44,897/45,000），但在 03:33 的重写后再次被容量推迟：新文档 44,218 字符 + 138×6 = 45,046 > 45,000（差 46 字符），所以整份不带 id、entries.json 也未被重写（仍是 11:29 的 138 条，年龄未重置）。
- 03:33 的自动 pass 重写 MEMORY.md 为 44,218 字符，四节条目 17/64/43/15（条目数不变）：11 条被改写或替换（10 条同头改写，Z4 清洗条目退役进 `retired.md`，另 1 条移入 Index）；渲染往返逐字节一致、drops 0、itemTruncated 0。
- 回归检查误报：`removedSectionEntries` 用 `normalizeMemoryEntry` 逐字比较，旧文档条目带 `（xxxx）` 而新文档因推迟不带 id，于是 Invariants 64 + Pitfalls 43 = 107 条全部被报成 no longer present（errors.log 2026-11-11T03:33:10.664Z）；它只报告不阻断（设计如此），但归因错误。
- Z7 的 live 负控成立：本会话 meta 有 `kind:"handoff"` + `parentId`，但未绑定任务所以没有 `task` 字段，这是正确行为，不是缺陷；task 继承仍待一次绑定任务的真实交接。
- Z8a 与 Z8c 的触发条件（`resolveModelInfo` 抛错的死路由、一次失败的交接）在健康路由/正常交接上无法人为制造，只能由测试钉住（7 条 / 5 条真跑用例）；当前 0 空目录是修复后的不变量，不是 Z8c 的触发证据。
- agent 没有执行 slash 命令的通道（不能驱动会话 UI），用户侧命令必须由用户补；本轮用户已补 `/session-log tree` 与 `/memory update`。
- 11:31 的 autolearn pass 生成并提升了 `dsh-batch-landing-acceptance-audit` 技能（带 autolearn-generated 标记，71 行），本轮把它纳入跟踪提交。
- 上一轮提交 `a8593e9`（docs(memory): record the Z8 acceptance round and stamp entry ids）已推送；本轮只动 `.agents/memory/` 与 `.agents/skills/`，`src/`/`lib/` 未动。
- 本会话上下文 160,511 / 1,048,576（15%），已越过 157,000 阈值；自动交接只在 `turn/end` 评估，越线是必要不充分条件（近期窗口覆盖整个会话时会 `nothing-to-drop`）。

## Open tasks

- 验 Z7 的 task 继承（用户）：开一个一次性会话跑 `/context task z8-acceptance new` 再 `/handoff now`，我负责核对子会话 meta 是否同时带 `"task": "z8-acceptance"`、`kind: "handoff"`、`parentId`。
- Z8a 行为验收需要一次 `resolveModelInfo` 抛错的死路由（中途切换模型后旧请求头残留），正常路由下不存在；该分支由 `test/handoff-route-failure.test.mjs` 7 条钉住，目前只证明 `/handoff status` 回执可构建。
- Z8c 行为验收需要一次失败的交接才能看到创建的空目录被取回；该分支由真跑 `performHandoff` 的用例钉住，当前 0 空目录是修复后的不变量，不是触发证据。
- 修回归检查误报（建议小批次）：`src/project-memory/consolidate.ts` 的 `removedSectionEntries` 在比较两侧前先 `stripEntryTid`，并加一条「旧文档带 id、新文档不带 id → count 0」的用例；证据是 errors.log 2026-11-11T03:33:10.664Z 的 107 与 64+43=107。
- `MEMORY.md` 现在 44,218/45,000；带 id 需 45,046（差 46 字符）：要恢复 138 个标记，先按 cap-guard 压 ~60 字符再走 `retireWithinBudget`/`stampEntryIds`，否则等下一次文档缩小；在那之前 entries.json 仍是 11:29 的 138 条。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 观察 `context-injection.test.mjs` 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 `handoffBudgetRecentTokens`（如 4000）、调小宿主 compaction `headroomTokens`、并压小两份文档，缺一不可。
- 本会话归档后 `INDEX.md` 应补一行（197 目录 / 197 行）；重启后顺手核对「带 `meta.json` 的目录数 = 索引行数 + 活着的会话数」。

<!-- latest-session-title: 批次 Z8 验收收口：Z8b/Z4 通过，Z2 盖章再被容量推迟 -->
