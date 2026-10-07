# 交接路线取舍：(b) 触发点、(c) 子会话标题、第三条 `agent/pre-step` 路线（结论见文末「判定」，其后是 2026-10-07 的只读补充证据）

**状态：只读分析，`src/` 未改动。** 2026-10-07 用户在「三条路线怎么选」这一问上给出的唯一约束是「**不能丢东西**」，据此 (b) 与第三条路线都因「故意丢掉在飞的答案」判为**不做**（见文末「判定」），(c) 仍待拍板；三条路线的分析原文一律保留，条件变了可直接复用。每条结论都给了可复跑的判据；凡引用行号都是本文件写成时的树（`c630964`），改代码后按符号名重新定位。**(c) 的选项在文末「补充证据」里从 4 个扩到 6 个**：dsh 的 `sessionTitle.refresh` 是服务自述的 unpin，且 `invariant.ts` 证明「带前缀但不 pin」在交接那一刻写不出来。

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

## 第三条路线：把评估挂到 `agent/pre-step`（真·仿自动压缩）

**它和 (b) 不是同一件事，虽然两者都会在轮次中途动手。** (b) 是在 `session/event` 上**新增**一条 `step/end` 分支去调 `attempt()`（`step/start` 那条 tick 不动）——那是**事后通知**：事件已经发生，监听者只能异步反应，改不了这一步要发什么。第三条路线是把动作挂到 agent 级 waterfall `agent/pre-step`，它在**每个 step 进入之前被 await 一次**（同一步内由 `agent/request-error` 触发重试的那次请求不会再跑一遍 pre-step），并且可以在**同一 step** 决定这一步进不进、发什么。

### 依据（dsh 侧，读自宿主实际加载的 `…-dsh-desktop-0.2.0-rc.2/lib/dsh-desktop/repo`）

- 事件声明：`packages/core/agent/src/runtime-types.ts` 的 `'agent/pre-step'(this: Scoped<Agent>, payload: { agent, messages, turn, step, signal }, next)`，`@mode waterfall`；返回 `PreStepDecision = { kind: 'reject' } | { kind: 'enter', messages, startsRequestSeries? }`（注释原文：reject a proposed step or replace the messages that enter it；`next()` 保留原消息）。
- dsh 自己的自动压缩就是这个形状：`packages/compaction/compaction-basic/src/index.ts` 的 `_registerAutomaticCompaction()` 注册**四个 handler**，其中两个是动作点——`agent/pre-step`（`await this.compactIfNeeded(agent, 'pressure', signal)`，只做旁路动作再 `return next()`，抛错只 `warn`）与 `agent/request-error`（`failure.code === CONTEXT_WINDOW_EXCEEDED_CODE` → 压缩 → `{ kind: 'retry' }`，`maxOverflowRetries` 默认 1）；另两个只重置溢出重试计数（`agent/status` 的 `idle`、`session/event` 的新 `assistant/message`）。它静默、模型无关，不消耗也不打断任何 turn。
- 阈值与改写：`ctx.tokenMeter.measure(session).totalTokens` 对 `resolveCompactSpec(policy, contextWindow, reservedCompletionTokens)`（默认 `thresholdRatio 0.8`、`headroomTokens 65536`）；改写是 durable surface replace（`compaction/start|summary|end` + 遮蔽旧节点），不是删消息。
- 自动 vs 手动的判据（`region.ts` 里 `compaction/start` 的写入处）：`owner` 在自动路径是当前 turn 号、在手动路径是 `null`，且只有手动会带 `sourceCommandId`。现跑命令（本工作区归档）：

  `for f in ~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/*/session.v4.jsonl.zstd; do zstdcat "$f" | grep -o '"type":"compaction/start"[^}]*}'; done`

  输出里 `turn` 非 null 且无 `sourceCommandId` 的就是自动路径——因此这台机器上自动压缩是活的（不要引用固定条数）。

### 比 (b) 多拿到的四件事

1. **每个 step 都被评估**，`turn/end`-only 的结构盲区（本文件 (b) 的动机）是被消除，而不是缩小。
2. **同一 step 就能改 `messages`**（`{ kind: 'enter', messages }`）。
3. **测量与门禁复用同一个对象**：`gate.ts` 是唯一门禁入口，不必为触发点另建一条解析。
4. **可以再加硬溢出兜底**：`agent/request-error` 返回 `{ kind: 'retry' }`，与压缩的兜底同形状。

### 代价（第三条是 (b) 没有的）

1. **同样丢掉在飞的答案**：交接必须在父会话那一轮还没结束时停掉它——与 (b) 第 1 条是同一件事，而且触发得更早。
2. **与 `compaction-basic` 抢同一个 waterfall**：两者都在 `agent/pre-step` 上，注册顺序决定谁先手。数量级上我们的阈值（用户设置，1M 窗口下 ≈157K）远早于压缩线（`min(0.8W, W − reserved − 64K)`），所以正常是交接先发生；但一个 step 内顶过压缩线时，压缩会先改写表面、压力回落——这正是 (b) 第 6 条（「批次 M 那行会几乎失去用处」）的根源，拍板时必须一并定。
3. **动作必须在 pre-step 的 await 链里完成或妥善异步化**：`compactIfNeeded` 是 await 的；若像现在的 `tickPressure` 一样 `void` 一个 promise，就要自己保证它与 dispose / turn 边界不打架——批次 M 的第 3 个变异体守的正是这类竞态。

### 动手前必须先探针确认的事

- 沿用 (b) 的两条：`archiveSession(id, { stopActivity: true })` 施加在**正在跑的 turn** 上是「停掉并结束」还是「拒绝/排队」；`controller.cancel({ sessionId })` 用在**父会话**上是否等价于取消当前轮。
- 新增一条：我们的 listener 与 `compaction-basic` 在 `agent/request-error` 上都可能返回 `{ kind: 'retry' }` 时，是否互相抢先/覆盖。

### 偏离 pi 语义

pi 只在轮次结束时评估，所以 (b) 与这条路线都是 dsh 自己的设计决策，不能记成「移植」。

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

---

## 判定（2026-10-07，用户给出的约束：「不能丢东西」）

2026-10-07 用户在「本文件这三条路线该怎么选」这一问上只给了一句约束：**「不能丢东西」**。来源要分清：这是对**路线选择**问题的自定义回答，**不是**对父会话那个「超支时先给 session 发消息等待、还是仿照自动压缩」问题的回答（那一问他并未作答）；随后用户在追问里选中了「先把这三条结论补进 brief」，而该选项原文就写着「(b) 与 pre-step 都被判出局」。按**内容完整性**把这句约束对齐到五条路线：

| 路线 | 会丢什么 | 判定 |
|---|---|---|
| (a) 现状 = 批次 M 注入行 | 不丢；触发仍在 `turn/end`，那一轮已经收干净 | 保留（已在线） |
| (b) `step/end` 触发 | **故意**丢掉父会话在飞的那一轮答案（`stopActivity` 停轮，它的下一次模型调用永不发生） | **不做** |
| 第三条 `agent/pre-step` | 同上，而且更早 | **不做** |
| (c) 选项 1/3（保前缀、只换标签） | 只改子会话**标题文本**，不动任何消息 | 仍待拍板 |
| (c) 选项 2（丢前缀） | 丢掉 `watch.ts` 的自动切会话判据 | 不做 |

两条结论：

1. **不存在「中途打断但不丢」的现成接缝。** dsh 没有「暂停—发问—等回答」的原语：要问用户只能靠 step 内的 `ask_user_question`，要「等待」只能等那一轮结束（＝我们已有的 `turn/end`）。mid-turn 的任何动作都只能停掉当前轮，所以在这个坐标系里「越线必达」与「不丢在飞的答案」互斥；**这条约束把触发点钉回 `turn/end`**。
2. 因此若要兼得，只能是一条**新设计**——例如 `agent/pre-step` 只做标记与更强的提示、交接仍等轮次自然结束——它不属于本文档现有三条中的任何一条，尚未开工。

判定的性质：这是**用户口径**，不是插件既有行为；(b) 与第三条路线的分析原文按上面的顺序完整保留，条件变了可直接复用。

---

## 补充证据（2026-10-07，只读复核，未动 `src/`）

**(c) 那一节的选项表**写于「自愈只能由插件自己算标题」的前提下。回源复核后多出两件事，第一件直接改变可选空间。

> 本节引用的 dsh 源码行号读自**当前运行的宿主 store**：`/nix/store/cl7chjvxjw81aizwlxar1k8n9z02yd3b-dsh-desktop-0.2.0-rc.2/lib/dsh-desktop/repo/`。换了 store 路径就按符号名重新定位。

### 新事实一：`refresh()` 是服务自己声明的 unpin

- `packages/session/session-title/src/index.ts:392-394`（`rename()` 的 doc）：`user` 源会 pin，原话是 `"...an explicit {@link SessionTitleService.refresh} remains the deliberate unpin"`。
- `refresh()` 本体（同文件 424-451）：注册了 provider 且会话已有可用人类输入时**走 provider**；没有 provider（或没有人类输入）时 `appendFallback`，用首条人类输入现推。
- 这台机器上 provider 确实挂着：`packages/bundle/base/cordis.patch.yml:55-68` 同时挂 `@deepseek-ai/dsh-session-title`（`fallbackMaxWords: 5` / `fallbackMaxBytes: 40` / `maxTitleBytes: 80`，字节）与 `@deepseek-ai/dsh-session-title-first-prompt-llm`（patch 的 `config` 是 `targetWords: 5` / `targetCjkCharacters: 10` / `maxInputBytes: 4096` / `maxOutputTokens: 64` / `timeoutMs: 60000`；`automatic: 'first-prompt'` **不是 patch 键**，是该包的 `apply` 调 `registerSessionTitleLlmProvider(..., 'first-prompt', ...)` 时传的 cadence；未配 provider/model → 走 `request/header` 记录的会话路由）。`maxInputBytes` 在档 4 里是硬失败面：框好的输入按 UTF-8 字节比它，超了**直接抛**（`session-title-llm/src/index.ts:249-252` 的 `input is <n> bytes, exceeding maxInputBytes <m>`），不裁剪。
- 服务键名是 `sessionTitle`：`packages/api/session-controller/src/commands.ts:195` 就是 `this.ctx.get('sessionTitle')`；插件可用同一条 `ctx.get`（未挂载时返回 `undefined`，不抛）。
- 子会话对插件可见：它的日志 header **没有 `origin` 字段**（实测 `session-f7e001b6`），所以 `src/shared/lifecycle.ts:12` 的 `isTopLevel`（只排除 `'subagent'`）为真，`session/event` 本来就收得到；该子会话的 `request/header`（seq 16）早于它第一条人类输入（seq 100），路由可用。

### 新事实二：「带前缀但**不** pin」在交接那一刻写不出来（硬约束）

- `packages/session/session-title/src/invariant.ts`：`(messageSeqs.length === 0) !== (source.kind === 'user')` 即判失败，且每个被引用的 seq 必须是一条**更早的**、`source.kind === 'user'` 的 `user/message`。
- 交接那一刻子会话里还没有任何人类消息（种子是 `source.kind = dsh-project-context`，本 workspace 66/93 个新子会话实测如此），所以插件不可能自行 append 一条非 pin 的 `session/title`。
- 推论：**前缀 ⟺ pin**。前缀的唯一功能读者是 `marker.ts:101` 的切换判据，所以「自愈」只能发生在切换**之后**——事后再动标题。

### 因此 (c) 在原有 0/1/2/3 之外多出三档

| 档 | 触发点 | 标题变成 | 前缀 | 代价 |
|---|---|---|---|---|
| 1/3（上一轮建议） | 交接那一刻（`perform.ts:106` 一处） | 父会话最后一条人类输入；算不出就退回父 id | 保留 | 无模型调用；标签质量见下 |
| 4 真·自愈 | 子会话第一条**人类**输入时 `ctx.get('sessionTitle')?.refresh(child)` | dsh 自己的 provider 生成（≤5 词 / ≤10 CJK 字 / ≤80 字节）；失败则原样保留 pin 标题 | 之后消失 | 多一次 ~64 token 的标题调用；多一个触发点；需要子会话已有一条 `request/header`（种子那一轮产出）；异步失败必须自己吞掉 |
| 5 折中 | 同上触发点，但自己 `rename`(`${HANDOFF_TITLE_PREFIX}${首条人类输入}`) | 机械标签（子会话自己的首条人类输入） | 保留 | 无模型调用；多一个触发点；仍是机械标签 |
| 6 自己算（新，见下） | 由我们选：交接那一刻，或子会话首条人类输入时 | 我们自己算的文本，输入面自选（可以看父会话日志） | 保留 | 交接路径上多一次模型调用（政策反转：批次 J 刚把它删掉）；无 route / 调用失败 / 空标题三种失败都必须自己吞 |
| 0 现状 | — | 父会话前 8 位 id | 保留 | 侧栏永远显示旧 id |

档 4/5 的触发条件必须是 `source.kind === 'user'`：实测 **27/93 个旧子会话的第一条 `kind=user` 消息其实就是交接横幅本身**（旧播种路径把种子写成 `user`），现行种子是 `dsh-project-context`，不会误触发。

### 标签质量的真实分布（只读普查，可复跑）

- 探针：`.agents/evidence/2026-10-07-handoff-title-label-survey/survey.mjs`（`node` 直接跑；只读、无网络；含 README）。它 fold 本 workspace 的 107 个归档会话。
- 93 个 handoff 子会话，按**档 1/3**（父会话最后一条人类输入）：31 条是有意义的指令；38 条无来源（父会话没有任何人类消息 → 退回父 id）；7 条 ≤4 字（如「要」「好了」）；6 条是旧交接横幅；6 条是注入的状态行（如 `handoff Auto handoff ON · context 761495/1000000 …`）；5 条是「继续」。
- 按**档 4/5**（子会话自己第一条人类输入）：55 个子会话有人类输入（标签可用），38 个从未被输入过（与今天一样停在父 id）。
- 计数随会话增长，引用必须现跑；`survey.mjs` 的打印输出就是判据。

### 档 4/5 的输入面：标题模型只看一条人类消息（2026-10-07 补测）

- `session-title-first-prompt-llm/src/index.ts` 的 `apply` 只做一件事：取 `messages[0]`、`return [first]`；`session-title-llm/src/index.ts` 的 `systemPrompt` / `frameMessages` 把**这一条**数组 JSON 框进 system 指令（"Create a concise title … from the supplied human messages"）交给模型，没有别的上下文。`session-title/src/index.ts` 的 `collectSessionTitleMessages` 会收集该会话**全部**人类消息，但 first-prompt 档只取第 0 条。
- 因此**档 4 相对档 5 的全部增益 = 把同一条消息润色成 ≤5 词 / ≤10 CJK 字**；它补不出那条消息里本来没有的上下文。子会话首条人类输入是「继续」时，档 4 与档 5 一样没用。
- 实测（同一探针新增第三块）：55 个有自己人类输入的子会话里，**27 条首条 `kind=user` 其实是旧横幅**（历史遗留，现行种子不会产生），其余 28 条：19 条真指令、4 条「继续」、3 条 ≤4 字、2 条注入状态行 —— 即**只有用户真的回话时才触发**，触发后约 2/3 有用。
- 与档 1/3 对比（同一批子会话）：档 1/3 会改 55 个标题（31 有用 / 24 噪声），档 4/5 只在用户回话后改（今天 19 个变有用），两者都有 39 个从头到尾不变。

### 新档 6：插件自己算标题（自己调一次 LLM 再 `rename()`）— 2026-10-07 补测

- **机制**：`SessionTitleService` 的公开方法只有 `get` / `rename` / `refresh` / `register`（`session-title/src/index.ts` 的 public 面）。`rename(session, title)` 的文本由调用方给，append 一条 `source: { kind: 'user' }` 的 `session/title`（同文件 412-415），所以**不需要 unpin 也能写自己的标题**：插件自己算出文本 → `rename()`。`refresh()` 的文本来源只能是已注册的 provider 或内置 fallback，插件的自由度止于触发时机。
- **与档 4 的差别**：档 4 的文本由 dsh 的 provider 生成，输入面只到「一条人类消息」（上一节）；档 6 的输入由我们自己选（父会话最后一条人类输入、子会话首条人类输入、父会话日志里的一段……），**这才是「总结」而不是「润色」**——用户 2026-10-07 的原话正是「unpin 后加个 llm 总结」。
- **代价一，政策反转**：文本要自己产出，现成机件是 `src/shared/model-call.ts` 的 `resolveTarget(agent, config)`（显式配置 → `agent.session.requestHeader()?.config` → `agent.options`，都不行返回 `undefined`）＋ `requestPluginText(ctx, target, maxTokens, prompt, signal)`，不用从零写；但批次 J 刚把交接路径上的摘要模型调用**刻意删掉**（`src/project-handoff/summary.ts` 文件头原话：「Neither carries a generated summary … so this module holds no model call」），档 6 等于把它加回来。
- **代价二，失败必须自己吞**：`requestPluginText` 在 `error` / `aborted` finish 上抛（`src/shared/model-call.ts:213`），`resolveTarget` 可能返回 `undefined`（无 route）。两种都必须留在插件里并保留 pin 标题，否则交接路径上多一个可抛点。dsh 自己那条路的同类失败面是 `session-title-llm` 的 `resolveRoute`：没有显式 provider/model 且没有 `request/header` 路由时抛 `no logged request route is available`（`session-title-llm/src/index.ts:180-191`）。
- **代价三，`rename()` 自身的约束**：标题 normalize 后为空会抛 `SessionTitleInvalidError`，会话不 live 也会抛；文本要先截断/兜底（退回 `parentLabel`）。
- **没验的部分**：档 6 没有对应探针，多出来的那次调用在交接那一刻的延迟只有真做出来才知道；本档只记录「这是唯一能让标题看更多上下文的路线」，不替用户选。

### 「换成 `all-prompts`」不是插件的选项（profile 级）

- 服务只允许**一个** provider：`register()` 在 `this.registration !== undefined` 时抛 `session-title provider "<id>" is already registered`（`session-title/src/index.ts:471-475`，doc 原话是 "Register the sole optional title provider"）。
- 本机基础 bundle 只挂一个：`packages/bundle/base/cordis.patch.yml:62-63` 的 `id: session-title-llm` → `name: '@deepseek-ai/dsh-session-title-first-prompt-llm'`；`packages/bundle/` 里 **0 处** 提到 `all-prompts`。
- 所以「给标题模型看全部人类消息」= 把 base bundle 那一条的 `name` 换成 `@deepseek-ai/dsh-session-title-all-prompts-llm`（两个包的 `Config` schema 与 `inject: ['sessionTitle', 'llm', 'sessions']` 相同，`first-prompt` 的 selector 是 `messages => [messages[0]]`、`all-prompts` 是 `messages => messages`，`automatic` 由 wrapper 各自传 `'first-prompt'` / `'all-prompts'`）。这是 **profile 级、影响所有会话** 的替换，不属于 (c) 的插件改动面；记在这里以免再被当成「加一个插件就行」。

### 这一步不替用户选

上面各档（1/3、4、5、6）都满足「不丢东西」（这是该约束下唯一还站得住的家族）；差别只在标题质量、是否保留前缀、以及是否多花一次模型调用（档 4 是 dsh 自带的 ≤64 token 标题调用，档 6 由我们决定喂多少上下文）。原选项 0/1/2/3 的分析原文一律保留。

### 定案与落地：档 1/3（2026-10-07）

**用户拍板选档 1/3**，理由是成本最低、与 pi 的取向一致（pi 的标题也是纯文本、无 LLM），且同时改善侧栏与 `session-logs/INDEX.md` 两处显示。**已落地 `162b12d`**：

- `conversation.ts` 新增 `handoffLabel(session, fallback)`：取父会话最后一条 `role === "user" && source.kind === "user"` **且不满足 `isHandoffContinuationText`** 的文本，`clipTitle` 到 20 字符；没有则退回父 id。零模型调用。
- `perform.ts` 的唯一改动是把 `title: \`${HANDOFF_TITLE_PREFIX}${parentLabel}\`` 换成 `...${handoffLabel(session, parentLabel)}`；`watch.ts` 与 `marker.ts` 的前缀一字未动，`handoff deferred · `/`handoff failed · ` 保持父 id。
- `shared/text.ts` 新增 `clipTitle`，`project-context/session-index.ts` 的私有 `clip` 改为复用它（索引标题与侧栏标题同一套裁剪）。
- 具名用例 `the child's title is named after the parent's own last input, and falls back to its id`（`test/handoff-decision.test.mjs`）+ 1 个变异体（标签退回父 id，只打红该条）；全量门禁 405 通过 / 0 失败。
- 20 字符这个上限是**按字节**定的：dsh 服务把标题静默裁到 `maxTitleBytes: 80`，`↪ handoff · ` 占 15 字节，20 个全 CJK 字符（含 `…`）合计 78 字节。
- **事后修复（同日，落地后独立复核发现）**：`source.kind === "user"` 单独不够——旧播种路径走 prompt RPC，那条横幅是**人类 kind** 的消息。真实语料 97 个交接子会话里 **6 个**的父会话最后一条 `kind=user` 就是这种横幅，按原判据会得到 `↪ handoff · 从会话 session-<另一个会话>…`（点名父会话的上一棒，比父 id 更误导）。已复用 `isHandoffContinuationText`，由独立具名用例 + 变异体 + 语料探针 `.agents/evidence/2026-10-07-handoff-label-banner-repro/` 钉住。旧注入状态行（`handoff Auto handoff ON · context …`）仍是噪声标签，**有意不修**：没有现成谓词，不为它们新写一个措辞启发式。

**仍未采用的档**：4/5（触发点晚、4 还会让前缀消失）、6（要在交接路径上加回模型调用）。**待办**：宿主重启后这条才会在线，判据照旧（19387 持有者启动晚于最后一个 `src/` 提交）。
