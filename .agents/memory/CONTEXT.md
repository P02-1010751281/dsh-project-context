# Project Context

Last updated: 2026-10-11T08:56:02.618Z

## Summary

本会话（`session-d435cad7` 的续接）接手时，上一会话已把**批次 S** 落地并提交（`0bf0b31`：辅助调用盖活会话 id + 只追踪写阶段，门禁 439/0），但尚未在线；同一时段 16:56 的一次 `/memory update` 落盘了**有损**的 `MEMORY.md`（守卫报 7 条消失，逐条核对确认 4 条持久规则真丢）。本轮现跑判据发现宿主已于 17:01:32 重启、最后 `src/` 提交是 16:52:25，因此**六批（N/O/Q/R/Q2/S）全部在线**，整条验收链 `verify.sh` 现跑 `RESULT: PASS` / exit 0；随后按 `dsh-memory-doc-loss-repair` 把那 4 条规则修回 `MEMORY.md`（38784 字符，`sectionDropped 0` / `itemTruncated 0` / 逐字节往返一致 / cap 余 1216），并改掉一条已被批次 N 推翻的「分区硬上限」旧断言。批次 S 唯一不能离线见证的一条（真实路由下 `/memory update` 不再写 `MissingSessionID`）仍待用户跑一次。

## Key points

- 批次 S 的现证（不引用 prose）：`.agents/memory/errors.log` 两行（本地 +08 07:40:40 / 07:46:19）都是 `plugin model call failed (INVALID_REQUEST): 400: {"type":"MissingSessionID",…}`，栈指向 `lib/shared/model-call.js` 的 `requestPluginTextWithMeta` 与 `lib/project-memory/consolidate.js` 的 `call`。
- 链路五环：本会话路由 `opencode-go`/`deepseek-v4.1-flash`（profile `agent-default-model`，`~/.dsh/profiles/desktop/cordis.patch.yml`）→ pi-ai 的 opencode provider 只在 `options.sessionId` 存在时挂 `x-opencode-session`（`@earendil-works/pi-ai@0.87.1/dist/providers/opencode-headers.js`）→ dsh 自己的两个辅助调用都盖章 → 我们的调用没盖 → 网关 400。
- 本轮修法（B1）：`src/shared/model-call.ts` 的辅助调用入口接受并下发 `sessionId`；`src/project-memory/index.ts` 与 `src/project-autolearn/index.ts` 把 `agent.session` 的 id 传进去，并只把**模型调用之后的写阶段**交给 `pending.track`；`src/shared/lifecycle.ts` 的 `SessionWorkTracker` 语义是「注册的 span 里不能 await 模型调用」，否则该请求自己的 checkpoint flush 会去 await 它正在派发的调用。
- 写阶段切分的自检：`consolidateProject` 捕获到写阶段异常时仍走 `logDetail` + `status:"failed"`，且当 `wroteMemory` 已为真时**不**释放 version（否则下一次强制 pass 会对一个从未落盘的写回答「已是最新」）。
- 批次 S 探针 `.agents/evidence/2026-10-11-batchS-aux-route/aux-route-probe.mjs`（现跑，非引用）：batchS 半段打印 memory/autolearn 两行的 `parked`、`sessionId`、`checkpointFlushes`、`flushReturnedBeforeDispatch`、`passFinished`、`writeLanded`；对照件是 `1-pre-fix-probe.txt`（`sessionId=undefined`、`checkpointFlushes=0`、`flushReturnedBeforeDispatch=false`）与 `2-post-fix-probe.txt`（`sessionId="session-probe-memory"` / `"session-probe-autolearn"`、`checkpointFlushes=1`、`flushReturnedBeforeDispatch=true`）。
- 本轮最终门禁（现跑命令、不引用旧数）：`pnpm typecheck` 0；`pnpm build` 0，`built ./lib/client.js (28575 bytes)`；`pnpm test` **439 pass / 0 fail**；`git diff --exit-code -- lib` 为 0，且 `diff -rq lib $TMP`（新鲜 `node_modules/.bin/tsc --outDir $TMP`）只有 `lib/client.js` 例外——两条加载判据齐。
- 五次门禁数字都在长：批次 M 404 → 批次 N **419** → 批次 Q2 **436** → 本轮 **439**，这是新增用例而非既有用例数量变化；写下来的计数一定会过期，判据是现跑。
- **加载状态真相（2026-10-11 17:0x 现跑）**：宿主在 17:01:32 重启过，最后 `src/` 提交 `0bf0b31 @ 16:52:25` 早于它 ⇒ **六批 N/O/Q/R/Q2/S 全部在线**；`check.mjs` 逐批打印 `IN the holder (live)`（`0bf0b31`/`9edd119`/`ee2e3b9`/`1b18799`/`d405708`/`a3977c9`/`2462d59`，另含 `bb8bc2a`/`085eb03`）。任何「一批是否在线」的结论都必须在 `check.mjs` 里逐批现跑，不得从一次判据外推。
- `ss -ltnp | grep 19387` 的持有者是 electron 的 **node 子进程**；同机上还有第二个 store 活着（DSH-AV），所以 `dsh-desktop-restart.sh --verify-only` 会独立地报 FAIL——判据只认 `check.mjs` 的「持有者启动晚于最后 `src/` 提交」，**不要记录 pid 或启动时刻**，每次现读。
- `.agents/evidence/2026-10-11-post-restart-five-batch-accept/verify.sh` 现跑整脚本 `RESULT: PASS` / exit 0：第 1 步判据 PASS、第 2 步 `title-load verify` PASS、第 3 步行为见证为 `UNOBSERVABLE`（exit 2，不算失败）、第 4 步 Q2 / share-fit / 批次 S 三探针 3/3 PASS。此前那次整脚本 exit 1 只是因为当时判据为负，不是脚本拼接缺陷。
- `CONTEXT.md` 的份额现跑（`.agents/evidence/2026-10-07-context-section-balance/measure.mjs`）：`Summary` 1900/6000 = 31.7%、`Key points` 3856/11077 = 34.8%、`Open tasks` 1732/7912 = 21.9%，stored = rendered = 7729 字符、byte-identical 往返 true——**旧的「份额地板」已不复存在**：16:56 那次 pass 把这份文档从 19557 压到 7729，`Open tasks` 里已落地批次的叙事属于它允许压缩的 closed-batch detail，权威副本在 `docs/`、`CHANGELOG.md` 与归档会话里。
- **16:56 那次 `/memory update` 是有损落盘，已修**：`.agents/memory/errors.log` 记 `adopted an externally edited MEMORY.md` + `memory regression: 7 Invariants/Pitfalls entry(ies) are no longer present`（守卫只报不断——`removedSectionEntries` 故意不阻塞）；用 `memory.jsonl` 倒数第二条（`op=replace`，即该 pass 读到的版本）逐条复算，7 条里 **4 条是真丢**（另 3 条是改写误报）：teammate 树归属纪律、`A teammate that dies mid-mutation …`、`The central defect class … misattribution`、`A hidden-character count …`。已按 `dsh-memory-doc-loss-repair` 修回。
- `MEMORY.md` 现跑：38784 字符（cap 40000，余 1216 ≈ 3.0%），`sectionDropped 0` / `droppedItems 0` / `itemTruncated 0` / 逐字节往返一致；分区占目标比 `Invariants` 97.7%、`Pitfalls` 99.9%、`Index` 102.5%。
- 16:56 那次落盘的可用性反常：`errors.log` 在 08:54:50/51Z 仍记两条 400 `MissingSessionID`，08:56:02Z 却成功落盘，说明当时在飞的路由与更早两次不同（判据是现跑 `tail`，不要外推）。17:01 重启后批次 S 在线，`opencode-go` 路线不再需要绕行。
- 批次 S 的规格与裁决口径在 `docs/batch-s-opencode-aux-route-brief.md`：用户 2026-10-11 明确 B1 为首选、B2（非活会话路由键）为 B1 不可行时的兜底，两者**都要**。
- `errors.log` 是 append-only，读尾部现跑并按前缀分类：`adopted an externally edited MEMORY.md` 是 `/memory update` 落盘，`would have been stored lossily (…)` 才是 `lossy-refused` 的压缩被拒。
- 本会话的续接链（`… 141152c3 → 5e929a82 → … → a19333fc → 50983ded → 7b280e03 →`）里没有任何 `/handoff` 命令，客户端也只有设置卡片和 `watchHandoffSwitch`：这条链是**自动交接**出来的而不是用户手点的，时间线里有几小时空档是因为轮到不越线的小轮次就停。
- 批次 M 注入行每变一次文本就追加一份约 37 KB 的 `user/message` 快照且不被回收（实测 `session-3a19d454` 5 次 `Current runtime context`），所以文案与数字在跨线时一起冻结（`display.ts` 语言与数字同冻、`gate.ts` 是唯一门禁入口）。

## Open tasks

- **批次 S：B1 已在线，B2 未落地且需用户确认**：brief §3 写的是「本批只落一个」，所以上一会话按探针证据落 B1-a，并在 brief §6 与 `CHANGELOG.md` 记了「B2 未采用」的理由；CONTEXT.md 早先记的用户口径是「B1 首选、B2 兜底且两者都要」——**若本意是两个都落，需重新裁定**。B2 的形状（非活会话时用哪个 key、是否退回不带 id）与代价见 `docs/batch-s-opencode-aux-route-brief.md`。
- **批次 S 的端到端见证（用户操作）**：在本仓库跑一次 `/memory update`，`.agents/memory/errors.log` 不得再出现 `MissingSessionID`；探针只证明加载的 `lib/` 具备该行为，这是唯一无法离线取证的一环。
- **`MEMORY.md` 余量薄（下次写入前先压缩，不要靠删条目腾位）**：现跑 38784/40000（余 1216），分区占目标比 `Invariants` 97.7% / `Pitfalls` 99.9% / `Index` 102.5%；自批次 N 起分区配额是**目标值**、只有整篇到达 cap 才丢条目，但再长一点下一次 pass 就会被 tier C 拒（`lossy-refused`）。可压缩的是已落地批次的叙事（权威副本在 `CHANGELOG.md` 与 `docs/batch-*-brief.md`）；判据现跑 `share-fit.mjs`。
- **与批次 S 同源、未裁定的两条**：用户已裁定 B1+B2 都要，但 B2 的具体形状（非活会话时用哪个 key、是否退回不带 id）需要写 spec 后再动手；批次 P（dispose 逃生）已裁定不端口、通知半边（无宿主侧通道）已裁定按残留收档，都**不要重开**。
- **仍未离线可证的合规项**：批次 I 的合规（模型是否真的对索引段发 `read`）与批次 J 的 `MIN_DROP_TOKENS` 在真实上下文里的行为；批次 M 的「模型是否总是转述注入行」同类。不要为这些重新论证加载问题。
- **记录在案但不做**：固定阈值模式忽略自适应 `usable` headroom（F8/Q5）；`tool-ask-user` 的定时晚回复以 `user-question-reply` 到达而不被读（两 profile 都不设 `mode: timed`）；嵌套在代码运行时（PTC）的询问只记 `tool/ptc-dispatch`、对 `deriveMessages` 不可见；`handoffBudgetRecentTokens > 0` 时最新输入也会出现在携带尾部（仅重复，两 profile 都用 0）。
- **交接子会话标题的两条已落地档**：档 1/3（`handoffLabel` 取父会话最后一条非续接人类文本、裁到 20 字符、取不到退回父 id，写入前用 `hasVisibleText` 兜底）与档 5（把 `relabel` 的写放进出微任务以离开 `Session.append` 的派发信封）都已在线；上一轮重启后三态探针 `2026-10-07-handoff-retitle-accept/` 报 `RESULT: PASS`，且本轮现跑有 4 个续接会话各自获得第二条 `session/title`。档 2（丢自动切会话判据）与档 4/6 未采用，三条取舍 (a)/(b)/(c) 的现状见 `docs/handoff-candidates-b-c.md`。
- Standing guard：不经用户点名，不改 profile、不重启宿主、不动 `/etc/nixos`；桌面重启脚本与 `/memory update` 始终由用户运行。

<!-- latest-session-title: Batch S landed and committed (0bf0b31): auxiliary calls carry the live session id; write phase tracked -->
