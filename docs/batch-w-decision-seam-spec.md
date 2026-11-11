# Batch W · S1 — 交接决策缝：把「判」从「测 / 做」里切出来（方案，已实现待验收）

状态：**S1 已落地（`src/` + `lib/`）并提交（哈希不回写，免得文档与提交互相追赶）、未在宿主重启后验收**。本文经独立只读审计
（`.agents/evidence/2026-11-03-handoff-decision-seam/audit.md`）逐条核对，下列内容已按审计结论修正；
凡与早前版本冲突，以本文为准。

> **行号口径（2026-11-11）**：本文的 `index.ts` / `gate.ts` / `command.ts` / `display.ts` 行号是批次 W 落地与审计时的树。
> 此后批次 Z7、Z8a 改过这四份文件，行号会漂；**按符号名定位，别按行号**。下列事实性的判断不受影响，逐条改正的只有一处
> （`ctx.llm` 的包装，见 ⌘ 标记）。

## 0. 上游动机：一条被我搞错的判断

上一轮我用「三个宿主能力集不同，强行统一只能取交集」否掉了 handoff 参与三合一。用户直接反驳：
**「handoff 条件是确定的，问题在于触发」**。读代码后确认用户对、我错：

- 触发**只有一处**：`src/project-handoff/index.ts:200-224` 的 `session/event` 回调，
  `event.type === "turn/end"` → `attempt(session, event.seq)`；`step/start` 只 `tickPressure`
  （注释原话 "It never hands off."）。另有两个旁路，`user/message` 补续接会话标题、`session/disposed`
  （`index.ts:226-241`）只清状态 —— 后者与触发回调是**两个独立的 `ctx.on`**。
- 条件是一条**有序闸链**，形状与宿主无关（`auto.ts`，`HEAD` 版逐行核对一致）。
- 「子代理 settle」「residency」不是 handoff 的触发条件：settle 是 `pendingSubagentWork` 的**读**，
  residency 属 archiving。我上一轮把两者混进了触发。

结论反转：**handoff 可合** —— 「同一判据链 + 每宿主自己的触发与执行」。

## 1. 目标与判据

- 目标：把「判」（闸 1–5）从「测」（宿主能力读取）、「做」（`performHandoff` 及其副作用）里切出来，
  使判据链成为**不依赖宿主也不依赖 `Session` 的纯函数**。
- 判据：
  1. **行为等价**：`test/logic.test.mjs` 里 9 个 `maybeAutoHandoff` 调用点
     （3147 / 3154 / 3198 / 3267 / 3282 / 3292 / 4031 / 4494 / 4498）与全部既有断言**一行不改**仍全绿。
     ⚠️ 修正：闸链的真实覆盖在 `logic.test.mjs`，**不在** `handoff-decision` / `handoff-relabel`
     （后两份对闸路径各有 0 处调用），早前把这两份列为等价判据是错的。
  2. **核心零宿主依赖**：`lib/project-handoff/decide.js` 的传递 import 中 `@deepseek-ai/*` 计数为 0
     （机械核对见 §5）。
  3. **纯性**：同一 `GateInputs` 连调两次得到深相等的 `Decision`，且不修改输入。
- 明确不做：不动 `performHandoff`（不变量）、不改闸顺序、不改阈值算法、不改触发时机。

## 2. 现状取证（触点全表，按审计补全）

`src/project-handoff/` 里碰宿主的点，按层分三段：

| 层 | 触点 | 现有形态 |
|---|---|---|
| **决策输入** | `gate.ts:48-50` `sessionController` / `tokenMeter` / `sessionProjections`；`gate.ts:52-53` `resolveTarget` 为空的静默出口；`gate.ts:55` `llm.resolveModelInfo`；`guard.ts:149-150` `subagents` / `agents` | 除 `ctx.llm` 外都是 `ctx.get(...)` 可选读，缺失即退出或回落 |
| **触发与接线** | `index.ts:189` `systemPrompt.context`、`:200` `ctx.on("session/event")`、`:226` `ctx.on("session/disposed")`、`:243` `commands.register`、`:93` `inject = ["llm","systemPrompt","commands"]` | 这些是「接线」，不是判据，属 shim |
| **执行副作用** | `perform.ts:125` controller、`:180` `writeAtomic`（HANDOFF.md）、`:139-140` logsDir/sessionIndexFile、`:131`→`assertHandoffDroppable`（`:68-70`）；`child.ts:24/114/116/204/257/281`；`relabel.ts:79` sessionTitle；`watch.ts:75-77`；`index.ts:132-133` `getProjectRoot`+`logError`（写 errors.log） | 直连宿主，无法脱离实机 |
| **决策侧可观察副作用** | `auto.ts:50/59/72` 三行延后/跳过日志；`display.ts` 的 `recordHandoffGate` / `recordHandoffDeferral`；`state.ts` 的 `skippedSince` / `skippedLoggedAt` / `deferredLoggedAt` | 抽链后**必须留在适配器**，核心只产出 `Decision` |
| **命令路径** | `command.ts:84` `settings.update`（写）、`:186` `runManual` 的 controller、`:196` `pendingSubagentWork` | 早期把 `:84`/`:186` 归为「展示」是错的：一个是写，一个是执行 |

`ctx.logger` 共 16 处（auto 109/111/122、child 30/123/169/243/262/285/287、index 125/130、
perform 206/210/219、relabel 102），是全局设施、不是能力，但它承载了决策侧的三行日志，因此列入上表。
（auto 的三处行号是**本批落地后**的现值；落地前为 50/59/72。）

⚠️ 修正：`ctx.llm` **不是**静默失败 —— 它在 `inject` 里，reject 会穿到 `index.ts` 的 attempt catch，
留下一次 warn + `FAILED_UNTIL` 5 分钟退避。这是**响亮失败**。

⌘ **2026-11-11 更正（Z8a）**：`gate.ts` 现在**有**包装了 —— `withRouteFailure`（`src/project-handoff/route-failure.ts`）
把 `resolveModelInfo` 的非取消异常包成 `HandoffRouteError`，同一个包装点也给 `/handoff status` 用。它仍然是响亮失败，
只是**多了一个用户可见的出口**（`handoff-pressure` 注入行 + 回执那行），见 `docs/batch-z-six-problems-spec.md` §11.10(a)。

执行状态（与宿主无关）：`state.ts:13-50` 的 `handedOff`（一次性）、`inFlight` + `pendingTriggerSeq`
（单飞 + 记忆落下的 trigger）、`failedUntil`（5 min）、`skippedLoggedAt`/`deferredLoggedAt`（日志节流）、
`skippedSince`（回执用的首次跳过时间，**不是**节流）、`pendingRetire`（`:50`，交接后按轮次结束退场）。

闸链顺序（`HEAD` 逐行核对一致，**不可重排**）：

```
auto.ts:41  recordHandoffGate（写状态；低于阈值时 display.ts:63-67 会删除 crossing）
auto.ts:43  闸2  totalTokens >= threshold.tokens
auto.ts:48  闸3  pendingQuestion + config 的 defer
auto.ts:56  闸4  pendingSubagentWork 非空
auto.ts:63  闸5  handoffSplit 的 olderTokens >= MIN_DROP_TOKENS（8 000，threshold.ts:16）
auto.ts:79  执行 performHandoff
```

上面是**本批落地前** `HEAD` 的行号。落地后闸链在 `decide.ts:89-107`（阈值 → 未答问题 → 子代理 →
丢弃下限 → 交接，五个判断分别在 `89/90`、`96`、`102`、`105`、`107`），`recordHandoffGate` 仍在
`auto.ts:105`（决策之前），执行仍在 `auto.ts:138`；`HEAD` 一旦前移，这一块的行号只作为历史对照，
读现值请看 `decide.ts`。

## 3. 契约

### 3.1 输入：`GateInputs`（纯数据，不含 `Session`）

```ts
export interface GateInputs {
	readonly measurement: MeasuredContext;
	readonly contextWindow: number;
	readonly threshold: ThresholdTerms | undefined;
	readonly pendingQuestion: string | undefined;
	readonly pendingSubagents: readonly string[];
	readonly olderTokens: number;
}
```

**`threshold` 是输入，不是内部求解**：适配器 `resolveHandoffGate` 已为压力行与 `/handoff status`
解析过一次；`gate.ts` 的头注释写明它存在的理由就是防止「同一组条件的两次求值」造成用户读到的数字与
决策所用数字漂移。核心只**比较**，不**求解**。

**`refusal` 不进契约**（审计后删除）：它原本作为输入与 `unmeasurable` 的输出成对存在，但全仓唯一的
读者是 `/handoff status` 回执，而回执是自己用 `thresholdRefusal` 从同一份 measurement 算的
（`command.ts:137`）。把它穿过决策只是让一个没人读的字段多走两跳；`unmeasurable` 因此只是「没有可解析
的触发器」，成因由回执自己命名。

**`envelopeSource` 只有两个取值**（`measure.ts:19`：`"projection" | "meter"`）。「不可用」不是第三个
值，而是**字段缺席** —— 此时 `measuredContext` 原样返回 meter 的测量，floor 退回
`keep + MIN_DROP_TOKENS`。回执三态都说（`command.ts:128-132`）。

**`measurement` 整块传入**：`contextBreakdown` 是 `/4` 启发式，与 meter 的 surface 不同底座，
`floor` 不能跨底座相减（不变量）。核心对 `measurement` 的义务是**原样带出**，让报告说得出这条结论
在哪个底座上得出；它影响**结论**的路径在 `resolveThreshold` 的 floor，不在 `decide()` 内。

### 3.2 输出：`Decision`

```ts
export type Decision =
	| { kind: "handoff"; measurement: MeasuredContext; threshold: ThresholdTerms; olderTokens: number }
	| { kind: "defer"; reason: "question" | "subagents" }
	| { kind: "skip"; reason: "nothing-to-drop" }
	| { kind: "below-threshold"; tokens: number; threshold: number }
	| { kind: "unmeasurable" };
```

`unmeasurable` 与 `below-threshold` 在适配器侧是同一个静默 return（旧代码
`if (!threshold || totalTokens < threshold.tokens) return`），因此调用者确实无需区分；拆成两个具名结局
是为了让 `switch` 穷尽，而不是为了让谁分支处理。

### 3.3 缺席语义（逐能力，审计核对后的四行）

| 能力 | 缺席时 | 位置 | 归类 |
|---|---|---|---|
| `sessionController` / `tokenMeter` / 路由目标 / 正窗口 | 静默不决策（`unmeasurable`） | `gate.ts:51-53`、`56-57` | 核心输入缺失 → 不判 |
| `contextBreakdown` 投影 | 三态：投影在 → `"projection"`；投影缺但 meter 自报 → `"meter"`；两者都无 → **字段缺席**，floor 退回 keep+MIN | `runtime.ts:81-83` | 降级可测 → 判，并登记底座 |
| `subagents` / `agents` 列表 | 回落事件日志 `runningContinuableChildren(...) ?? outstandingSubagents(...)`；回落条件不止「能力缺失」：listing 抛错/超时、`diagnostic` 行、无 `mode` 行同样回落 | `guard.ts:183`（函数体；`:182` 是签名） | 降级可读 → 判 |
| 非驻留子会话 | **大声失败**，不回退 RPC | `child.ts:203-209` | 执行侧 → 不判，抛 |
| `ctx.llm` | **响亮失败**：穿到 `index.ts` 记 warn + 5 min 退避 | `gate.ts:55` | 不属静默类 |

规则：核心只接受前两类（不判 / 降级判），第三、四类留在执行侧；适配器不得把「读不到」伪装成「没有」。

### 3.4 副作用留在适配器

`recordHandoffGate` / `recordHandoffDeferral`、三行决策日志、`skippedSince` 等**不进核心**，由适配器按
`Decision` 驱动。⚠️ 修正：`handoffPressureText` 读回的是 `display.ts:72` 依据 gate 的值**新建的副本**
（`crossings.set(key, {...})`），不是同一个对象实例 —— 保证的是「同值」，不是「同一引用」。

## 4. 落地步骤与并行切分（审计后修正）

| 步 | 内容 | 写范围 | 依赖 |
|---|---|---|---|
| S1 | 新建 `decide.ts`（纯）+ `measure.ts`（无 import 的类型宿主），`auto.ts` 改为「取 inputs → decide → 派发」，`runtime.ts` 改为 re-export 测量类型 | `decide.ts`、`measure.ts`、`auto.ts`、`runtime.ts` + 各自 `lib/` 产物 | 本文 |
| S2 | 新建 `test/handoff-decide.test.mjs`（13 条） | 该文件 | 本文 §3 |
| S3 | 只读审计 spec 事实性 | 无 | — |
| S4 | 适配器边界收口（把「取 inputs」聚成一个函数） | `auto.ts`（与 S1 同文件，**串行**） | S1 |
| S5 | 补 §5 的门禁漏洞：适配器级「未越线 ⇒ 不交接」用例（原计划没有这一条，是变异 C 实测暴露后追加的） | `test/logic.test.mjs` | S1 |

落地状态：S1 / S2 / S4 / S5 **已落地并现跑验证**（476 通过 / 0 失败），且已过第二轮代码对抗审查
（两名只读审查者，结论与处置见 §5）；S3 已完成并产出
`.agents/evidence/2026-11-03-handoff-decision-seam/audit.md`；本批已提交（哈希不回写）。

⚠️ 修正：S1 的范围必须含 `measure.ts` 与 `runtime.ts`，因为判据 1.2（核心不加载宿主包）与
「`MeasuredContext` 来自 `runtime.ts`」互相冲突 —— `runtime.ts` import `dsh-session`，而
`verbatimModuleSyntax` 下 type-only import 仍发射 `import {}`，是**真加载**。把两个纯类型搬进
`measure.ts` 才让「零宿主依赖」成立；这一点是实做时才发现的，原 §4 漏了这两个文件。

并行规则：S1 与 S4 同文件串行；S2 只写新测试、S3 只读，可并行；**任何时刻只允许一个 owner 跑
`pnpm typecheck` / `build` / `test`**（并发构建会互相踩 `lib/`）。

## 5. 等价判据与变异点

等价：`logic.test.mjs` 全部既有断言 + 全套 476 条（现跑见 §5.2）。

| 变异 | 实测红（2026-11-03 现跑） |
|---|---|
| A：闸5（drop minimum）提到闸4（subagents）之前 | **只红** `handoff-decide.test.mjs` 的「running subagent defers before the nothing-to-drop skip」。我先前预期它还会红 `logic.test.mjs` 的回执用例 —— **没红**，因为既有夹具里没有「越线 + 有在跑子代理」的组合。 |
| B：`guard.ts:183` 的 `?? outstandingSubagents(...)` 改为 `?? []` | 红 3 条**既有**用例：`a manual handoff refuses while a background subagent is still running`、`subagent work is read as turn activity, not as residency`、`the automatic handoff waits for background subagents to settle` |
| C：删掉闸2的未越线早退 | 红 5 条：4 条新写的 `handoff-decide.test.mjs`（子代理/未答问题/自适应/阈值闸各一）＋ **1 条新增的适配器级门禁** `logic.test.mjs`「the automatic handoff never runs under its trigger, however droppable the session is」。**既有 461 条仍一条没红** —— 补的那条是本批新加的，所以「既有用例零覆盖」这一事实不变，只是不再是「整套零覆盖」。 |
| D：`olderTokens < MIN_DROP_TOKENS` → `<=` | 只红 8 000 边界用例 |
| E：`Decision.handoff.measurement` 折成裸 `totalTokens` | 红 **3** 条：`carries the envelope`、`the drop minimum is inclusive`、`the envelope is never derived by subtracting`（后两条也 `deepEqual` 整个 measurement 块）。原稿写「只红一条」是错的，审查复跑纠正。 |
| F：删掉 `decide.ts` 里 `config.handoffPendingQuestion === "defer" &&` | 红 1 条：`under \`wait\`, an open question does not defer`。**补这条用例之前它是 0 红** —— 而两个 profile 都用 `wait`，即生产唯一被读的配置分支当时零覆盖。 |

**结论必须如实写**：五个变异里只有 **B** 被**既有**用例独立抓到。A/C/D/E 只红本批新写的文件，属于「自己写的测试验证自己写的实现」，证明力弱于 B。C 曾证实审计的判断 —— 删掉阈值闸，全套既有测试一次都红不了，即「未越线 ⇒ 不交接」当时**没有适配器级门禁**。这不是 S1 引入的缺陷（旧代码里同样的缺口），但 S1 把它显式化了。

**该缺口已补**（随后一轮）：新增适配器级用例 `logic.test.mjs`「the automatic handoff never runs under its trigger, however droppable the session is」，双边对照 —— 同一条会话、同一份可丢内容，只改 `tokenMeter` 读数（50 000 对 80 000 触发器，对 120 000 作正控），断言未越线时 `controller.create` 调用数为 0、越线时为 1。变异 C 打在最终代码形态上复跑，实测 `1 !== 0` 变红，恢复后 0 标记。它的证明力来自正控：没有正控，「0 次创建」可能只是一个根本交接不了的夹具。

**第二轮：代码本身过独立对抗审查**（两名只读审查者，攻击面不重叠：行为等价性 / 测试判别力）。
这一轮改掉的真缺陷，逐条都是先复现再改：

1. **读序被交换了**（真行为差异，非成本）：旧形态是「读未答问题 → `await` 子代理列表 → 取 split」，
   抽链后变成「取 split → `await` → 读未答问题」，两头都反了。跨 `await` 虽无写入，但事件循环仍可
   跑（子代理结算的 notice 是已排队微任务），所以两种顺序决定每个输入看到哪一版会话快照。已恢复旧
   顺序，并把「这个顺序不能顺手整理」写进 `gatherDecisionInputs` 的注释。
2. **`refusal` 是条死链**：`gate.ts` 产出 → `GateInputs` → `Decision.unmeasurable`，全仓无人读；
   唯一显示成因的 `/handoff status` 自己算（`command.ts:137`）。直接删掉整条链，而不是给一个没人用的
   分支补测试。附带省掉每次 `turn/end`（及每次压力 tick）一次 `thresholdRefusal` 纯计算。
3. **`wait` 分支零覆盖**（审查判 blocking）：见上表 F。
4. **`switch` 缺穷尽守卫**：加 `assertNever(decision)`（参数类型 `never`），新增第六种结局变成编译错，
   而不是在 `switch` 末尾静默返回「不交接」。运行时零开销、零新失败路径。
5. **我的注释数字算错**：适配器那条用例写「~15 000 token / `/4` 启发式」。实为
   `CHARS_PER_TOKEN = 3.5`、会话被 `MAX_CONVERSATION_CHARS = 50 000` 截断后 50 042 字符 → **14 298**。
   结论（≥ 8 000，正控成立）不变，但数字与推导都改对了。
6. **锚点与失效引用**：`gate.ts:55` 实为非正窗口判断在 `:56-57`（且 `decide` 从不读
   `contextWindow`，归因也错）；用例注释里的「§5 row 1/2/4」指向已不存在的编号表，其中一条引的还是
   本文件自己判为**无效**的变异。已改为直接描述那处编辑，不再引行号。
7. **c12 的负控写错了**：它实际钉的是「floor 忽略 envelope」，不是「把决策输出折成裸数」——
   后者对它是绿的。已改正并写明为什么。

审查还判了两条**不算缺陷**的：`decision.refusal` 死字段随第 2 条一并消除；`7/13 条用例不比较
threshold 数值`属正常——单条用例只钉一个闸，文件头的声称已按此收窄。

⚠️ 修正（审计裁定）：原 §5 第 2 条「把闸2移到闸3/4之后」**对插件行为等价，是无效变异**：
低于阈值时 `recordHandoffGate` 已让 `display.ts:63-67` 删掉 crossing，`recordHandoffDeferral` 随即
no-op（`display.ts:85-86`），两种顺序都不交接；自动路径的既有夹具全在阈值之上（190k/199k 对 200k
窗口），所以它一条既有用例都不会红。已用上表 A 替换。

### 5.2 现跑门禁

`pnpm typecheck` 0；`pnpm test` **476 通过 / 0 失败**（S1 前 461，S2 新增 13，补门禁 1，第二轮补 `wait` 用例 1）；`pnpm build` 0
（`lib/client.js` 28575 B）；`lib/` 与新鲜 `tsc --outDir` 只剩 `client.js`；`decide.js` 的传递
`@deepseek-ai/*` import 计数 **0**。

## 6. 明确不做

- 不拆 `performHandoff`（不变量）。
- 不改闸顺序、阈值算法、触发时机（`turn/end` 不变）。
- 不在本批引入第二宿主的适配器；本批只保证「核心已可被复用」。
- ⚠️ 修正：`/handoff now` **不是**「检查零个闸」。`runManual` 至少检查 `inFlight`（`command.ts:180`）、
  controller（`186-189`）、**闸4 `pendingSubagentWork`（`:196`）**、以及
  `assertHandoffDroppable`（`perform.ts:68-70`，`:131` 调用）；`guard.ts:173-177` 的注释明写
  「two callers… the manual path refuses」。它跳过的只是 `handoffEnabled`、阈值与未答问题。
  早前那句「检查零个闸」来自项目记忆，属**记忆错误**，已在此更正。

## 7. 风险与残留

- **最高风险**：抽链会移动代码位置但不改行为；一旦顺序或短路被改动，症状是「静默少交接」，测试未必红
  —— 因此 §5 的变异必须真跑。§5 的门禁漏洞**已补**（适配器级未越线用例，见 §5）。
- 残留①：`below-threshold` / `unmeasurable` 两个具名结局首次有名字，但没有新行为，也不加日志。
- 残留②：`triggerSeq` 仍在适配器侧传递（`attempt` → `maybeAutoHandoff` → `performHandoff`），核心
  不需要它。
- 残留③：`auto.ts` 现在每次 `turn/end` 都会算一次 `handoffSplit` 与一次子代理列表（旧形态只在闸3/4
  通过后才算）。这是**真实成本前移**，不是「无可观察副作用」——原稿那句被审查证伪：两个读**自身**无持久
  写入（上游 `listChildren` 对活会话走同步 live 分支，只做投影快照），但未越线时多一次宿主观测、且
  读序一变就改变决策看到的快照（读序已恢复，见 §5 第二轮第 1 条）。若日后要省，唯一正确的做法是让核心
  接受惰性输入，而不是把闸搬回适配器（那会重新造出两处判据）。
