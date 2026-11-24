# Project Context

Last updated: 2026-11-23T11:24:16.593Z

## Summary

本会话从 session-dec39c6d 续接（handoff-seed fd2d75ac51e2），上一轮把八项残余收口到 `f46c801`。 本轮用户答「all」，于是把四条并列路线一次推进：先补掉 SH-10 最后一个未证点的**运行期**半边 （`.agents/evidence/2026-11-24-sh10-runtime-reachability/`），确认能经 `agentPresets.serviceFor(agent,"compaction")` 拿到真引擎、根域 `root.get("compaction")` 是 `undefined`、样本 agent 处于 `running`；顺带发现并实测一条门禁盲区——`src/shared/settings.ts:24` 值依赖 `../host/dsh/lifecycle.js`，而 `check-boundary.mjs` 只查反方向，把路径改错后门禁仍 `0 failure(s)`、只有 `tsc` 报错。据此写出接第二宿主 2c-1 的规格 `docs/host-context-2c1-settings-port-spec.md`（`SettingsPort` + 补门禁 + 正负控制），并把 `docs/batch-ac-settings-split-spec.md` §8.1 漏掉的第 6 个拍板点（是否移除 `SegmentedTabs`）补上， 使待裁决项由 5 条回到文档索引声称的 6 条。宿主已于 14:31:40 重启，晚于最后一次 `src/` 提交 （20:42 前一日），驻留模块与磁盘一致；归档不变量 221 = 221 仍对齐。

## Key points

- 本轮运行期取证（`2026-11-24`）：宿主 pid 5876 启动 `14:31:40`，store `0.2.2-rc.5`，Inspector `9230`；`prompt.js` / `reply.js` / `consolidate.js` / `autolearn/reasons.js` 四个模块驻留 sha256 与磁盘逐字节相同（`consolidate-types.js` 未被该 isolate 解析，属正常），`git show 4fbb972:lib/…` 是它们共同的来源。
- Inspector 的 `Runtime.evaluate` 落在 `dsh-desktop-host` 主 realm，**那里没有 cordis 根**（139 个全局无 `loader`/`ctx`，符号键只有 cost-meter、mounted-plugins 空表等）。可达入口是 `globalThis[Symbol.for("dsh.inspector.realm-object-registries")]` → `RealmObjectRegistry.retained` 里 `keys` 含 `root`/`registry`/`events` 的那个对象。
- SH-10 运行期读数：`root.get("compaction")` 与 `root.get("commandCompact")` 均 `undefined`（宿主平面被 web-app patch 关掉），`root.get("agentPresets").serviceFor(agent,"compaction")` 返回 `engine(function)`；样本 agent `status = running` 且 `whenIdle`/`runMaintenance` 都在。**未调用 `compactNow`**，所以 `compaction-vs-handoff.md` §9 的重开条件 3 仍不满足。
- 门禁盲区（已实测）：`check-boundary.mjs` 只实现「`src/host/` 不得依赖 core/shared」，没有反向的「`src/shared/` 不得依赖 `../host/dsh/`」。把 `settings.ts:24` 指向不存在的模块后，门禁仍印 `boundary check: 126 source file(s), 0 failure(s)`，只有 `tsc` 以 `TS2307` 报红——拦住它的是类型解析，不是分层规则。新判据不能一刀切禁 `../host/`：`src/shared/` 对 `contract.js` 有 6 处值导入，是合法的中立依赖。
- `docs/batch-ac-settings-split-spec.md` 的拍板项实为 6 条而 §8.1 只列 5 条，第 6 条（移除 `SegmentedTabs`，见 §2.6）藏在正文里，`docs/README.md` 的「6 个待拍板点」才是对的；已补进 §8.1 并写明代价（同批改掉现有卡片外观与 `test/card-render.test.mjs` 断言）。
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

- 待拍板（`docs/batch-ac-settings-split-spec.md` §8.1，6 条）：四份 schema 还是三份、共用卡放哪、`provider`/`model` 成对检查、`maxMemoryChars` 归属、迁移执行人、是否同批移除 `SegmentedTabs`。定案后才动 `src/`。
- 待拍板（`docs/host-context-2c1-settings-port-spec.md`）：2c-1 是否开工。规格已含门禁补丁、正负控制与 4 条用例，落地时先加检查后修代码（顺序反了就证明不了门禁会响）。
- SH-10 仍差两件才能谈接线：真的调一次 `compactNow`（会压缩本会话并花一次模型调用），以及 `agent/status = idle` 窗口里与 `retireIfPending` 的竞态实测。二者都需用户点头与一个空闲窗口。
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
