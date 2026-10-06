# 交接的两个未拍板取舍：(b) 触发点、(c) 子会话标题

**状态：只读分析，`src/` 未改动，两项都等用户拍板。** 每条结论都给了可复跑的判据；凡引用行号都是本文件写成时的树（`c630964`），改代码后按符号名重新定位。

---

## (b) 把触发点从只有 `turn/end` 扩到也看 `step/end`

### 动机（可复现）

`54cdf479`（`↪ handoff · a00eb4ce`）在一个**未结束的 turn** 里坐到 316,189/1,000,000 对阈值 157,000（**2.01×**），而触发只在 `turn/end` 评估 —— 它从未被评估过；在 93 个确实交接过的会话里，越线幅度中位数 1.75×、最大 4.28×。批次 M 只把这件事**变成可见**（把越线状态注入上下文让模型转述），**没有**改触发时机。

### 改动面（比看起来小）

- `src/project-handoff/index.ts:194-208` —— `session/event` 过滤器：`turn/end` → `attempt()`；`step/start` → `tickPressure()`（显示层，**永不交接**）。这是唯一要动的地方。
- `attempt()`（`index.ts:100-138`）与触发事件无关：`handedOff`（只交一次）、`inFlight` + `pendingTriggerSeq`（一次一个尝试、期间落地的触发记下来重评）、`failedUntil`（失败退避）都已齐备。
- `maybeAutoHandoff()`（`auto.ts:31-79`）同样与触发事件无关：门禁 → 阈值 → `pendingQuestion`（只对 `defer` 生效）→ `pendingSubagentWork` → `MIN_DROP_TOKENS` → `performHandoff`。

所以最小改动 = 给 `step/end` 加一条 `attempt(session, event.seq)`（更省的做法是与 `step/start` 共用同一次 `resolveHandoffGate`）。

### 已经现成、让 (b) 成立的四件事

1. **`step/end` 是静默边界。** 一条 step 的工具结果都在它的 `step/end` 之前。判据（可复跑，在 `~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/` 上跑）：90 个会话、10,965 个 `step/end` 边界里，只有 4 个在 `step/end` 与下一个 `step/start` 之间出现 `tool/result`，且这 4 个都是**别的轮的**结果被 `compaction/prune` 回放（例如 `step/end{turn:9,step:1}` 之后那条 `tool/result{turn:8,step:8}`）。结论成立，但要在实现时把这个回放形状写进注释，否则下一个人会以为它违反。
2. **切分本来就允许切在轮次中间。** `src/project-handoff/conversation.ts` 的 `handoffSplit` 只在整条消息之间切，注释里明确 pi 的 `093dbf3`（"cut mid-turn so one huge turn cannot block the handoff"）在 dsh **没有对应物** —— 因为不需要。(b) 不需要动切分。
3. **停掉父会话那一轮已经有机制。** 自动路径 `perform.ts:169` 调 `scheduleRetirement(ctx, session, reason === "manual")`；auto 传 `false` → `child.ts:297-303` 立刻 `retireSession` → `archiveSession(id, { stopActivity: true })`（`child.ts:280-289`），而 `stopActivity` 的语义正是"宿主**停掉**该会话仍在跑的东西，而不是因为它在跑就拒绝归档"（`runtime.ts:96-104`）。(b) 不需要发明"停下来"。
4. **`turnStartedAfter` 不会误判。** `guard.ts:91-105` 找的是 `seq > triggerSeq` 的 `turn/start`；途中触发时当前轮的 `turn/start` 序号更小，所以 `perform.ts:83/93/123/132` 的四处 `assertSessionSettled` 不会把"这一轮还开着"读成"用户已经往前走"。反过来，(b) 需要**新增**一个"这一轮还开着"的判据（见下）。

### 代价与风险（这才是要拍板的东西）

1. **在飞的答案是丢掉的。** 途中交接时父会话那一轮没结束，它的下一次模型调用永远不会发生，`stopActivity` 把它停掉。`index.ts:203` 的注释说的就是这件事（"archiving 会停掉正在渲染这一轮的回复"）—— 手动路径为此把 retirement 推到 `turn/end`，而 (b) 是**故意**接受这个代价。副产品：用户可能看到"话说了一半就换了会话"。
2. **两个会话会重叠一个窗口。** 现有顺序是「建子会话 → 配置 → 播种 → 才退休」（`perform.ts:105-169`），所以子会话已经在跑、父会话还没被停。`guard.ts` 的 `pendingSubagentWork` 存在的理由正是"别让两个会话同时改同一个项目"（2026-09-17 事件）。收敛手段：`runtime.ts:16` 已有 `controller.cancel({sessionId})`，在**播种之后**立即取消父会话那一轮（比异步的归档更确定）。**顺序不能反过来** —— 先取消再播种，会让一次失败的播种白杀掉用户那一轮。
3. **每个 step 都要付一次测量。** 显示层的 tick 在 `handoffPressureIsOver` 之后直接跳过（`index.ts:159-177`），也就是**恰好在越线那一刻停止测量**；若触发也按 step 评估，就多一次 `resolveHandoffGate`（含 `llm.resolveModelInfo` + `meter.measure`），被退避的会话（`defer` 的待答问题、`nothing-to-drop`、子代理在跑）会**每个 step 重测一次**。建议与 tick 共用同一次解析，并沿用 `SKIP_LOG_INTERVAL_MS` / `deferredLoggedAt` 那套最小间隔。
4. **`pendingQuestion` 在途中没有意义。** `auto.ts:48` 的 `defer` 门禁读"最后一条会话消息是不是提问"，途中它多半是 tool 结果 → 恒不 defer。语义上没错（助手还没回话），但要写进注释，否则会被读成门禁失效。
5. **偏离 pi 语义。** pi 只在轮次结束时评估；(b) 是 dsh 自己的设计决策，不能记成"移植"。
6. **批次 M 的那一行会几乎失去用处。** (b) 的动机案例在 (b) 下会被直接交接掉，注入行只能在越线的那一步露一下。两者动机重叠、机制互补，拍板 (b) 时要一并决定 M 留不留。

### 动手前必须先探针确认的两件事

- `archiveSession(id, {stopActivity: true})` 施加在一个**正在跑的 turn** 上，是"停掉该轮并结束"还是"拒绝/排队"？现有的证据只有 `runtime.ts:96-104` 的注释与 `WorkspaceActiveSessionError` 的说明，需要一次真实探针（建一个长 turn，中途归档，读它的事件流）。
- `controller.cancel({sessionId})` 用在**父会话**上（现在只用于撤掉子会话的播种，见 `child.ts` 的 `abandonChild`）是否等价于"取消当前轮"。

### 建议的形状（若拍板做）

`step/end` 分支 → 复用 tick 的门禁对象 → 只有越线才 `attempt()` → 途中尝试加最小间隔 → **保持"播种在前"**，播种成功后 `cancel` + retire → 1 条具名用例（途中越线会交接、父会话被退休）＋ 1 个变异体（触发点改回只 `turn/end`，该用例转红）。文档里显式记下"在飞的答案被丢弃"这条**已接受残留**。

---

## (c) 交接子会话标题不会自愈

### 机制（只读核实）

- **写**：`perform.ts:106` 取 `parentLabel = String(session.id).replace(/^session-/, "").slice(0, 8)`；`perform.ts:147-156` 调 `controller.rename({ sessionId: childId, title: `${HANDOFF_TITLE_PREFIX}${parentLabel}` })`；字面量在 `marker.ts:10`。
- **读（浏览器半边）**：`marker.ts:101` 的 `planHandoffWatch` 只判 `row.title.startsWith(HANDOFF_TITLE_PREFIX)`。**前缀之后的部分完全自由** —— 这是本项的杠杆。
- **为什么不自愈**：dsh 标题服务把这次 `rename` 记成 `source.kind = "user"`，而 "A user rename pins the title" 让它此后**永久拒绝自动改名**；种子来源 `dsh-project-context` 本身也不触发自动标题。归档里的形态：每个 handoff 子会话恰好 1 条 `session/title`、来源全是 `user`，而其余会话存在 `fallback → provider` 的升级路径。（两边的计数都随时间增长，不要引用固定值。）
- **前缀族已有三个**：`↪ handoff · `（切会话判据）、`handoff deferred · `、`handoff failed · `（`child.ts:248`，只在失败/放弃时写，不触发切换）。

### 选项

| 选项 | 改什么 | 代价 / 风险 |
|---|---|---|
| 0. 维持现状 | 不动 | 侧栏永远显示旧 id；用户的替代手段是 GUI 手动改名（永久有效，因为它就是 user 改名） |
| 1. 保留前缀、换标签 | `perform.ts:106` 一处 + 一条用例 | 前缀是切会话判据、标签自由；现有测试只断言前缀（`test/logic.test.mjs:3830` 的 `startsWith`），换标签不会打红任何现有用例 |
| 2. 放弃固定前缀 | 要给 `watch.ts` 换判据 | 自动切会话会失效；前缀同时是"哪些会话是交接来的"的唯一标记 —— 不推荐 |
| 3. 让插件按内容算标题 | 同 1，但换标签来源 | 需要一个新的标题来源，见下 |

### 标签取什么（选项 1/3 的核心）

批次 J 已把交接的摘要链**刻意删掉**（交接不再有任何模型调用），所以可用来源只有文本：

- **父会话最后一条人类输入**：`handoffCarry`（`perform.ts:41`）**已经算出来了**，v0.4.2 的工作正是让它把 `ask_user_question` 的答案也认出来。零新增读取，标签就是"续会话要接着做的那件事"（本会话即 `先把其它的都做完`）。代价：用户只打"继续"时标签就是"继续"——不好看，但不是错。
- **父会话第一条人类输入**：`firstUserText` 会跳过交接横幅，但在链式交接里它往往就是"继续"，比上一条更差。
- **父会话自己的标题**：在这个 workspace 里**恒为** `↪ handoff · <更早的 id>`（本会话的父会话就叫 `↪ handoff · c5558568`），只会把 id 往后挪一位。
- **向上走链到第一个非交接祖先**：要加载别的会话，20 层链就是 20 次读取，不划算。

**建议**：选**父会话最后一条人类输入**（截断到约 24 字符），拿不到就退回 `parentLabel`。**不要**引入措辞分类器去识别"这算不算真指令" —— 记忆里的既成教训是措辞启发式改不出收敛，只会把一类错误换成另一类。

### 若要动手

1 条具名用例（标题以 `HANDOFF_TITLE_PREFIX` 开头，且标签等于带入的最后一条人类输入）＋ 1 个变异体（标签退回 `parentLabel`，该用例转红）。不动 `watch.ts`，不动 `marker.ts` 的前缀。
