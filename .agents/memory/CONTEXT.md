# Project Context

Last updated: 2026-11-11T06:16:25.938Z

## Summary

本会话（session-4c23d245，父会话 5f3fb68a，任务 z8-acceptance）收掉 Z8 的两项遗留，并把 id 记账的约束补硬。① 回归误报（批次 Z8d 前半）：`removedSectionEntries` 逐字比较新旧条目，而 Z2 的 id 盖章会在计划与回写之间变化，于是把未改动条目报成删除——errors.log 里 107 条，实测 96 条只差 id、11 条真改写；修法是两侧先 `stripEntryTid` 再归一化，守卫仍只报告、不阻断，Project/Index 仍排除，`batch Z8d` 用例在 4000 字符 cap 下复现该不对称。② id 机制（用户裁定 A）：`retireWithinBudget` 改部分盖章——带 id 渲染不干净、不带 id 干净时，按 Invariants → Pitfalls → Project → Index 用剩余字符盖多少算多少，两份都脏才保留全部 id，没有任何条目盖得上才 `stamped:false`。修这一版时复核又揪出三个真问题并已修：正文 + 6 超过 800 单条上限的条目会拖垮整个前缀（现在直接跳过，只推迟自己）；id 派生曾用 sidecar 播种，导致未盖章条目撞到自己的旧 id 换盐、年龄重置（现在纯正文派生）；`entries.json` 的裁剪改用 `keepIds`（文档拥有的全部 id，含未盖章条目），推迟盖章不再重置年龄。写这段时在 `fe5dfed` 的文档上测得：44,589 字符 / 140 条（17/64/44/15），cap 45,000，剩 411 → 68 个 id；随后一次自动 pass 已把该文档重写为 44,997 字符 / 131 个 id，本轮又压到 44,825（175 剩余），所以数字只是测量快照，引用前现读。门禁：typecheck 0、`pnpm test` 609/609、build ok（lib/client.js 38274）。宿主 pid 71971 启动 10:41:56 早于全部 src 提交，**需要重启才生效**。

## Key points

- Z7 已由真实交接证明：本会话 meta 带 `task: "z8-acceptance"`、`kind: "handoff"`、`parentId: session-5f3fb68a…`，父会话 meta 也带同一个 task——绑定随交接继承，不是只有测试钉住。
- 回归误报的根因与修法：`removedSectionEntries` 现在比较前两侧都 `stripEntryTid` 再 `normalizeMemoryEntry`；报告仍不阻断、Project/Index 仍排除。真实一对文档的实测是报 107、其中 96 条只差 id、11 条真改写。
- 部分盖章规则：带 id 渲染干净 → 全量；不带 id 干净而带 id 不干净 → 按 Invariants → Pitfalls → Project → Index 用剩余字符盖多少算多少；两份都脏 → 保留全部 id；零条目可盖 → `stamped:false`（新语义：真的零个 id 落地）。
- 边界约束一：正文 + 6 字符超过 800 单条上限的条目直接跳过。否则一条近上限条目会让每个包含它的前缀被渲染器拒绝，预算一路降到 0，旁边装得下的条目一个 id 都没有（`a near-cap entry postpones only itself` 钉住）。
- 边界约束二：id 派生不再用 `entries.json` 播种。把 sidecar 已有 id 当作「被占用」会让未盖章条目撞到自己的旧 id、换盐换 id，年龄必然重置（`the pass keeps the clock of an entry its partial stamp could not mark` 钉住）。
- 年龄裁剪：`entries.json` 的 `keep` 改用 `keepIds`（文档拥有的全部 id，含未盖章但仍在文档里的条目），所以推迟盖章不重置年龄；`stamped:false` 时同样只裁掉真正离开文档的 id。
- 变异矩阵：预算归零 → 部分盖章用例红；优先级反转 → 只有优先级用例红；`keepIds` 退化成 carried ids → 单元 + 端到端时钟用例红；id 派生退回 sidecar 播种 → 端到端时钟用例红；去掉近上限过滤 → 只有边界用例红。
- 门禁本次实跑：`pnpm typecheck` 0 错、`pnpm test` 609 / 609 pass、`pnpm build` ok（`lib/client.js` 38274 bytes），0 个变异标记残留。
- 数字是快照：`MEMORY.md` 在 `fe5dfed` 时 44,589 字符 / 140 条 / 68 个 id，14:21 的自动 pass 重写为 44,997 字符 / 131 个 id，本轮校正后又压到 44,825 字符；引用前现读 `renderMemoryDocument`。
- 生效判据：宿主 pid 71971 启动于 10:41:56，最后一条 `src/` 提交晚于它，所以本批尚未生效；重启后下一次 pass 才会部分盖章。

## Open tasks

- 重启宿主（用户）：重启后触发一次整理 pass，确认 `MEMORY.md` 的 id 按优先级出现（条数现读渲染器）、`errors.log` 无新的 `memory regression:` 行。
- 决定是否补做方案 D（3-hex id）：A 已让 id 不再吞事实，D 只增加余量并会重置现有年龄，默认不做。
- 观察 `context-injection.test.mjs` 的偶发失败是否在无并发写入时复现（旧项，仍未定性）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档（旧项）。

<!-- latest-session-title: 批次 Z8d 收口：回归误报 + 部分盖章 + 约束补硬 -->
