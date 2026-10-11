# Project Context

Last updated: 2026-10-11T08:56:02.618Z

## Summary

本会话（`session-d435cad7` 的续接）接手时，上一会话已把**批次 S** 落地并提交（`0bf0b31`：辅助调用盖活会话 id + 只追踪写阶段，门禁 439/0），但尚未在线；同一时段 16:56 的一次 `/memory update` 落盘了**有损**的 `MEMORY.md`（守卫报 7 条消失，逐条核对确认 4 条持久规则真丢）。本轮现跑判据发现宿主已于 17:01:32 重启、最后 `src/` 提交是 16:52:25，因此**六批（N/O/Q/R/Q2/S）全部在线**，整条验收链 `verify.sh` 现跑 `RESULT: PASS` / exit 0；随后按 `dsh-memory-doc-loss-repair` 把那 4 条规则修回 `MEMORY.md`（`sectionDropped 0` / `itemTruncated 0` / 逐字节往返一致），并改掉一条已被批次 N 推翻的「分区硬上限」旧断言；再往后一轮只切「已落地批次叙事」把余量做宽（占用与余量现跑 `wc -m` + `share-fit.mjs`，本文不写死）。批次 S 唯一不能离线见证的一条（`opencode-go` 路由下 `/memory update` 不再写 `MissingSessionID`；在当前的 `command-code` 上跑是**假通过**，见 Open tasks）仍待用户跑一次。

## Key points

- 批次 S 的现证（现跑，不引用 prose）：`grep -n MissingSessionID .agents/memory/errors.log`——**行数与时刻一律现读**；时间戳是 **UTC**（带 `Z`，本机 +08 要 +8 小时，别再当本地时间读），内容都是 `plugin model call failed (INVALID_REQUEST): 400: {"type":"MissingSessionID",…}`，栈指向 `lib/shared/model-call.js` 的 `requestPluginTextWithMeta` 与 `lib/project-memory/consolidate.js` 的 `call`。
- 链路五环（**路由是 per-session 且会变，写下来的必然过期：现读会话日志的 `model/selection`**）：2026-10-11 16:30 之前那条链跑 `opencode-go`/`deepseek-v4.1-flash`，之后（含当前链，也与 profile 的 `agent-default-model` 条目一致）是 `command-code`/`deepseek/deepseek-v4.1-flash`；两者都是 `- id: llm-pi-ai` 连接（`~/.dsh/profiles/desktop/cordis.patch.yml`）→ 只有 opencode 路线要会话 id：pi-ai 只把它包在 `opencode.js` / `opencode-go.js` 上（`@earendil-works/pi-ai@0.87.1/dist/providers/opencode-headers.js` 的 `withOpenCodeSessionHeader`）→ dsh 自己的两个辅助调用都盖章、我们的调用没盖 → 网关 400；`command-code` 拿不到那个包装，**这条错在它上面永远不会出现**。
- 本轮修法（B1）：`src/shared/model-call.ts` 的辅助调用入口接受并下发 `sessionId`；`src/project-memory/index.ts` 与 `src/project-autolearn/index.ts` 把 `agent.session` 的 id 传进去，并只把**模型调用之后的写阶段**交给 `pending.track`；`src/shared/lifecycle.ts` 的 `SessionWorkTracker` 语义是「注册的 span 里不能 await 模型调用」，否则该请求自己的 checkpoint flush 会去 await 它正在派发的调用。
- 写阶段切分的自检：`consolidateProject` 捕获到写阶段异常时仍走 `logDetail` + `status:"failed"`，且当 `wroteMemory` 已为真时**不**释放 version（否则下一次强制 pass 会对一个从未落盘的写回答「已是最新」）。
- 批次 S 探针 `.agents/evidence/2026-10-11-batchS-aux-route/aux-route-probe.mjs`（现跑，非引用）：batchS 半段打印 memory/autolearn 两行的 `parked`、`sessionId`、`checkpointFlushes`、`flushReturnedBeforeDispatch`、`passFinished`、`writeLanded`；对照件是 `1-pre-fix-probe.txt`（`sessionId=undefined`、`checkpointFlushes=0`、`flushReturnedBeforeDispatch=false`）与 `2-post-fix-probe.txt`（`sessionId="session-probe-memory"` / `"session-probe-autolearn"`、`checkpointFlushes=1`、`flushReturnedBeforeDispatch=true`）。
- 本轮最终门禁（现跑命令、不引用旧数）：`pnpm typecheck` 0；`pnpm build` 0，`built ./lib/client.js (28575 bytes)`；`pnpm test` **439 pass / 0 fail**；`git diff --exit-code -- lib` 为 0，且 `diff -rq lib $TMP`（新鲜 `node_modules/.bin/tsc --outDir $TMP`）只有 `lib/client.js` 例外——两条加载判据齐。
- 五次门禁数字都在长：批次 M 404 → 批次 N **419** → 批次 Q2 **436** → 本轮 **439**，这是新增用例而非既有用例数量变化；写下来的计数一定会过期，判据是现跑。
- **加载状态真相（判据每次现跑，不记录时刻）**：`.agents/evidence/2026-10-11-pre-restart-readiness/check.mjs` 的判据是「19387 持有者的启动晚于最后 `src/` 提交」——最后 `src/` 提交 `0bf0b31 @ 16:52:25`，现跑 POSITIVE ⇒ **六批 N/O/Q/R/Q2/S 全部在线**；逐批打印 `IN the holder (live)`（`0bf0b31`/`9edd119`/`ee2e3b9`/`1b18799`/`d405708`/`a3977c9`/`2462d59`，另含 `bb8bc2a`/`085eb03`）。任何「一批是否在线」的结论都必须在 `check.mjs` 里逐批现跑，不得从一次判据外推，也不得把持有者的 pid/启动时刻写进来（判据本身不认它们）。
- `ss -ltnp | grep 19387` 的持有者是 electron 的 **node 子进程**；同机上还有第二个 store 活着（DSH-AV），所以 `dsh-desktop-restart.sh --verify-only` 会独立地报 FAIL——判据只认 `check.mjs` 的「持有者启动晚于最后 `src/` 提交」，**不要记录 pid 或启动时刻**，每次现读。
- `.agents/evidence/2026-10-11-post-restart-five-batch-accept/verify.sh` 现跑整脚本 `RESULT: PASS` / exit 0：第 1 步判据 PASS、第 2 步 `title-load verify` PASS、第 3 步行为见证为 `UNOBSERVABLE`（exit 2，不算失败）、第 4 步 Q2 / share-fit / 批次 S 三探针 3/3 PASS。此前那次整脚本 exit 1 只是因为当时判据为负，不是脚本拼接缺陷。
- `CONTEXT.md` 的份额判据现跑 `.agents/evidence/2026-10-07-context-section-balance/measure.mjs`（要求 fixpoint + 无 clip marker + 每段 ≤ 自身份额的 90% + 逐字节往返一致）；**每段占用一律现读、本文不写死数字**。已确立的事实：16:56 那次 pass 把这份文档从 19557 压掉近一半，**旧的「份额地板」已不复存在**；`Open tasks` 里已落地批次的叙事属于它允许压缩的 closed-batch detail，权威副本在 `docs/`、`CHANGELOG.md` 与归档会话里。
- **16:56 那次 `/memory update` 是有损落盘，已修**：`.agents/memory/errors.log` 记 `adopted an externally edited MEMORY.md` + `memory regression: 7 Invariants/Pitfalls entry(ies) are no longer present`（守卫只报不断——`removedSectionEntries` 故意不阻塞）；用 `memory.jsonl` 倒数第二条（`op=replace`，即该 pass 读到的版本）逐条复算，7 条里 **4 条是真丢**（另 3 条是改写误报）：teammate 树归属纪律、`A teammate that dies mid-mutation …`、`The central defect class … misattribution`、`A hidden-character count …`。已按 `dsh-memory-doc-loss-repair` 修回。
- `MEMORY.md` 的现跑判据是 `.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs`：`sectionDropped 0` / `droppedItems 0` / `itemTruncated 0` / 逐字节往返一致；字符数、余量与分区占目标比**一律现读、本文不写死**（16:56 之后已经历过一轮压缩，写下来的数字当场过期）。
- 16:56 那次落盘的可用性反常（**未结**）：`errors.log` 在 08:54:50/51Z 仍记两条 400 `MissingSessionID`，08:56:02Z 却成功落盘。现读到的线索：那两条发生在 `session-d435cad7` 于 16:53:32 `aborted(disposed)` 之后的 dispose 期 pass，而该会话的 `model/selection` 在 16:30:23 已切到 `command-code`——**辅助调用并不等于跟着会话的当前选择走**（`src/shared/model-call.ts` 的 `resolveTarget` 顺序是 config → `session.requestHeader()` → `agent.options`，后两者都可能落后于选择）。这是「opencode 那条错为何在 16:5x 仍出现」的一条假设，**没有证实、别当结论**。
- 批次 S 的规格与裁决口径在 `docs/batch-s-opencode-aux-route-brief.md`：用户 2026-10-11 把两个选项**都选了**（多选），口径是 B1 为首选形状、B2（非活会话路由键）只在 B1 不可行时兜底、最终只留一个所有者——**不是「两条并存」**（详见 Open tasks 那条与 brief §6）。
- `errors.log` 是 append-only，读尾部现跑并按前缀分类：`adopted an externally edited MEMORY.md` 是 `/memory update` 落盘，`would have been stored lossily (…)` 才是 `lossy-refused` 的压缩被拒。
- 本次自动交接链（链尾现读 `.agents/memory/session-logs/INDEX.md`，不要写死具体 id）里没有任何 `/handoff` 命令，客户端也只有设置卡片和 `watchHandoffSwitch`：这条链是**自动交接**出来的而不是用户手点的，时间线里有几小时空档是因为轮到不越线的小轮次就停。
- 批次 M 注入行每变一次文本就追加一份约 37 KB 的 `user/message` 快照且不被回收（实测 `session-3a19d454` 5 次 `Current runtime context`），所以文案与数字在跨线时一起冻结（`display.ts` 语言与数字同冻、`gate.ts` 是唯一门禁入口）。

## Open tasks

- **批次 S：B2 已按 §6 被否，不是未决项、不要再问**：用户 2026-10-11 那次 ask-user 是**多选**，两个选项的标签原文是「B1：盖活会话 id 并解掉 checkpoint 死锁」与「B2：我实现「非活会话路由键」（**备用兜底**）」（载荷见 `session-logs/session-b2a9894b-…/session.jsonl` 的选项与 `selected`）；当轮 agent 已当面把口径写成「B1 首选形状、B2 是 B1 不可行时的兜底，最终只留一个所有者」并追加「若你要的是两条并存/可配置，说一声我改口径」，此后五轮用户发言全是「继续」、从未反悔。B1-a 的探针证明代价可接受 ⇒ 落 B1-a、否 B2，理由与已接受代价见 brief §6 与 `CHANGELOG.md`。
- **批次 S 的端到端见证（用户操作，只在 `opencode-go` 路由上有诊断力）**：把会话模型切到 `opencode-go`/`deepseek-v4.1-flash` 再跑一次 `/memory update`，`.agents/memory/errors.log` 不得再出现 `MissingSessionID`。⚠️ 在当前默认的 `command-code` 上跑同一个命令**必然**不出现该错（那条路线拿不到 `withOpenCodeSessionHeader` 包装，见 Key points），那是**假通过**、不构成见证；探针只证明加载的 `lib/` 具备该行为。
- **`MEMORY.md` 余量薄（下次写入前先压缩，不要靠删条目腾位）**：余量、分区占目标比与整篇是否到达 cap 一律现跑（`wc -m .agents/memory/MEMORY.md`、`share-fit.mjs`），不写死数字；自批次 N 起分区配额是**目标值**、只有整篇到达 cap 才丢条目，但再长一点下一次 pass 就会被 tier C 拒（`lossy-refused`）。可压缩的是已落地批次的叙事（权威副本在 `CHANGELOG.md` 与 `docs/batch-*-brief.md`）；判据现跑 `share-fit.mjs`。
- **已裁定、不要重开的两条**：B2 随批次 S 被否（见上一条，用户口径与证据都在那里）；批次 P（dispose 逃生）已裁定不端口、通知半边（无宿主侧通道）已裁定按残留收档。
- **仍未离线可证的合规项**：批次 I 的合规（模型是否真的对索引段发 `read`）与批次 J 的 `MIN_DROP_TOKENS` 在真实上下文里的行为；批次 M 的「模型是否总是转述注入行」同类。不要为这些重新论证加载问题。
- **记录在案但不做**：固定阈值模式忽略自适应 `usable` headroom（F8/Q5）；`tool-ask-user` 的定时晚回复以 `user-question-reply` 到达而不被读（两 profile 都不设 `mode: timed`）；嵌套在代码运行时（PTC）的询问只记 `tool/ptc-dispatch`、对 `deriveMessages` 不可见；`handoffBudgetRecentTokens > 0` 时最新输入也会出现在携带尾部（仅重复，两 profile 都用 0）。
- **交接子会话标题的两条已落地档**：档 1/3（`handoffLabel` 取父会话最后一条非续接人类文本、裁到 20 字符、取不到退回父 id，写入前用 `hasVisibleText` 兜底）与档 5（把 `relabel` 的写放进出微任务以离开 `Session.append` 的派发信封）都已在线；上一轮重启后三态探针 `2026-10-07-handoff-retitle-accept/` 报 `RESULT: PASS`，且本轮现跑有 4 个续接会话各自获得第二条 `session/title`。档 2（丢自动切会话判据）与档 4/6 未采用，三条取舍 (a)/(b)/(c) 的现状见 `docs/handoff-candidates-b-c.md`。
- Standing guard：不经用户点名，不改 profile、不重启宿主、不动 `/etc/nixos`；桌面重启脚本与 `/memory update` 始终由用户运行。

<!-- latest-session-title: Batch S landed and committed (0bf0b31): auxiliary calls carry the live session id; write phase tracked -->
