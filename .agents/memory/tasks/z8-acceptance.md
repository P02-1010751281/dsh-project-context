# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-11 · title z8-acceptance: Z8d landed — regression fix, partial id stamping, constraints (fe5dfed + 287888b)

## Summary

本会话（session-4c23d245，父会话 5f3fb68a，任务 z8-acceptance）收掉 Z8 的两项遗留并补硬 id 记账约束。① 回归误报：`removedSectionEntries` 逐字比较新旧条目，而 Z2 的 id 盖章会在计划与回写之间变化（计划装得下、回写装不下就整份去掉），于是把未改动条目全报成删除（errors.log 107 条，实测 96 条只差 id、11 条真改写）；修法两侧先 `stripEntryTid` 再归一化，守卫仍只报告、Project/Index 仍排除。② 用户裁定 A：`retireWithinBudget` 改部分盖章——带 id 渲染不干净、不带 id 干净时按 Invariants → Pitfalls → Project → Index 用剩余字符盖多少算多少，两份都脏保留全部 id，零个落地才 `stamped:false`。③ 独立复核（subagent 53d21d42）的 3 条 blocking 全部复现并修：CHANGELOG/注释里的 44,276/139/782/130/95 是 03:33 那版快照，现读 44,589 字符 / 140 条（17/64/44/15），剩 411 → 68 个 id；正文 + 6 超过 800 单条上限的条目会让每个含它的前缀被拒、预算降到 0（现在直接跳过，只推迟自己）；`stampEntryIds` 用 sidecar 播种使未盖章条目换盐换 id、年龄重置（id 改纯正文函数，`entries.json` 裁剪改用 `keepIds`）。两条 nit 也修：退休实际跑四个 section（Project/Index 排后是因为每轮重写），测试里「a few hundred ids」实为 113。门禁实跑：typecheck 0、`pnpm test` 609 / 609、build ok（lib/client.js 38274）、0 变异标记；5 个变异各只红自己的目标。落地 `fe5dfed`（代码/测试）+ `287888b`（CONTEXT.md、任务文档、CHANGELOG、MEMORY.md），HEAD = origin/main。`.agents/memory/tasks/` 从 `??` 改为入库（项目状态、不在记忆 .gitignore 里），/tmp 探针与备份清空，工作树干净。宿主 pid 71971 启动于 10:41:56，早于最后一条 `src/` 提交，**本批尚未生效，需重启**。另发起了一个只读闭合复核 subagent 69845585，报告尚未回。

## Key points

- Z7 与部分盖章的活体验证：本会话 meta 带 `task: z8-acceptance` / `kind: "handoff"` / `parentId: session-5f3fb68a…`，任务绑定随交接继承。
- 部分盖章规则：带 id 干净 → 全量；不带 id 干净而带 id 不干净 → 按 Invariants → Pitfalls → Project → Index 花剩余字符；两份都脏 → 保留全部 id；零个落地 → `stamped:false`。
- 边界一：**盖好之后**仍超过 800 单条上限（正文 ≥ 795）的条目直接跳过盖章——条目在预算前已被盖章，不能重复加 6；794 + 标记 = 800 照常盖章。用例 `a near-cap entry postpones only itself`。
- 边界二：id 由正文 sha256 派生、不读 sidecar，因此推迟盖章不改变身份；`entries.json` 裁剪用 `keepIds`（含未盖章条目），推迟盖章不重置年龄；用例 `the pass keeps the clock of an entry its partial stamp could not mark`。
- 退休范围纠正：`retireSections` 对四个 section 都跑 anchor drift + 180 天/未确认规则，Project/Index 条目也可能被判未确认退休；盖章顺序的理由是「Project/Index 每轮重写」，不是「退休只读两节」。
- 变异矩阵 5 个：预算归零 → 部分盖章用例红；优先级反转 → 只有优先级用例红；`keepIds` 退化成 carried ids → 单元 + 端到端时钟用例红；id 派生退回 sidecar 播种 → 端到端时钟用例红；去掉近上限过滤 → 只有边界用例红。
- 门禁本次实跑：`pnpm typecheck` 0 错、`pnpm test` 609 / 609 pass、`pnpm build` ok（`lib/client.js` 38274 bytes）、0 变异标记残留。
- 数字是快照：`MEMORY.md` 在 `fe5dfed` 时 44,589 字符 / 140 条 / 68 个 id，14:21 自动 pass 后 44,997 / 131，本轮压到 44,825；引用前用构建后的 `renderMemoryDocument` 现读。
- 文档改写走插件渲染器：`CONTEXT.md` 2,619 字符（3 节）、任务文档 2,736 字符，已不再把完成的回归修复与机制裁定列为待办。
- 生效判据有了新证据：14:21 的自动 pass 已按部分盖章写入 131 个 id（64+44+17+6，正是优先级顺序），说明宿主至少载入了 13:54 那版；但 `entries.json` 里只有 131 个 carried id、不是 `keepIds` 的 140，说明 14:17 的 keepIds 版尚未载入——仍需重启才能保证最新构建生效。

## Open tasks

- 重启宿主（用户）：重启后触发一次整理 pass，确认 `MEMORY.md` 的 id 按优先级出现（条数现读渲染器）、`errors.log` 无新的 `memory regression:` 行。
- 处理只读闭合复核 subagent 69845585 的报告：回来后逐条复现其发现，阻塞项当场修。
- 决定是否补做方案 D（3-hex id）：A 已让 id 不再吞事实，D 只增加余量并会重置现有年龄，默认不做。
- 观察 `context-injection.test.mjs` 的偶发失败是否在无并发写入时复现（旧项，仍未定性）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档（旧项）。

<!-- latest-session-title: z8-acceptance: Z8d landed — regression fix, partial id stamping, constraints (fe5dfed + 287888b) -->
