# 只读审计：`docs/batch-w-decision-seam-spec.md`（task-3 / S3）

- 审计者：spec-auditor（只读；未运行 `pnpm typecheck` / `pnpm build` / `pnpm test`）
- 时间：2026-11-03 23:00–23:10（Asia/Shanghai）
- **审计基线：`HEAD = 3b3e3684d67c103678ac1fc66e6120a40f1bc766`**（"fix(handoff): read the append-origin log …"）。
  本文所有 `file:line` 均指该提交下的文件内容；对工作区正在被 S1 改写的文件，一律用
  `git show HEAD:<path>` 取基线，不用工作区副本。
- **并发改写警告**：审计期间 S1 正在把本 spec 实现进 `src/`。`git status --short` 在 23:07 显示：

  ```
   M lib/project-handoff/auto.d.ts      M lib/project-handoff/auto.js
   M src/project-handoff/auto.ts        M src/project-handoff/runtime.ts
  ?? docs/batch-w-decision-seam-spec.md  ?? lib/project-handoff/decide.d.ts
  ?? lib/project-handoff/decide.js       ?? src/project-handoff/decide.ts
  ?? src/project-handoff/measure.ts      ?? test/handoff-decide.test.mjs
  ```

  因此 spec 里 `auto.ts:28-97` 一类行号在工作区**已经立刻过期**（新 `auto.ts` 已无闸链，只剩
  decide 派发）。下文第 4 条同时给出"对 HEAD 行为"和"对已落地的 `decide.ts`"两个口径的裁定。

## 裁定摘要

| # | 项 | 结论 |
|---|---|---|
| 1 | §2 触点全表 | **不完整**。漏 `index.ts` 的 4 处注册/订阅、16 处 `ctx.logger`、`perform.ts` 的文件写入；并把 `command.ts:84/186` 误归入"展示" |
| 2 | §3.3 四行 | 第 1、4 行实质正确（第 1 行漏 `!target` 出口，`ctx.llm` 失败并非静默）；第 2、3 行**结论对但措辞/归因/行号有错** |
| 3 | §2 闸链顺序 | **逐行一致**（HEAD `auto.ts:37-79`），但漏记 `auto.ts:41` 的 `recordHandoffGate` 写入——它恰是第 4 条变异"看不见"的机制 |
| 4 | §5 变异第 2 条 | **对插件行为等价，判定无效**。只改 `decide.ts` 的返回标签，宿主可观察面只多一行 `logger.info`，不多记任何 deferral。已给出 3 个真正有效的替代变异 |

---

## 1. §2「触点全表」是否漏项

### 1.1 使用的命令

```bash
cd /mnt/Data/Projects/dsh-project-context
grep -rnE 'ctx\.get\("|ctx\.(llm|agents|logger|sessionController|subagents|sessionProjections|tokenMeter|tools)\b' src/project-handoff/*.ts
# 再把"非 logger / 非 ctx.get"的 ctx 用法单独挑出来（get / logger 之外还有注册与订阅）
grep -rn 'ctx\.' src/project-handoff/*.ts | grep -vE 'ctx\.(logger|get)\('
# 逐行核对基线（工作区已被并发改写）
git show HEAD:src/project-handoff/auto.ts | grep -nE 'resolveHandoffGate|recordHandoffGate|totalTokens <|pendingQuestion|pendingSubagentWork|handoffSplit|MIN_DROP_TOKENS|performHandoff'
```

### 1.2 全量清单（HEAD）与 spec 的归类

**spec 已列且正确的（9 处）**

| spec 行 | 实际内容 | 核对 |
|---|---|---|
| 决策输入 `gate.ts:48-50` | `sessionController` / `tokenMeter` / `sessionProjections` | ✅ `gate.ts:48,49,50` |
| 决策输入 `gate.ts:55` | `ctx.llm.resolveModelInfo` | ✅ `gate.ts:55` |
| 决策输入 `guard.ts:149-150` | `subagents` / `agents` | ✅ `guard.ts:149,150` |
| 执行副作用 `perform.ts:125` | `sessionController` | ✅ `perform.ts:125` |
| 执行副作用 `child.ts:24/114/116/204/257/281` | workspaceRegistry / permissionPresets / sessions / agents | ✅ 六处逐一命中 |
| 执行副作用 `relabel.ts:79` | `sessionTitle` | ✅ |
| 执行副作用 `watch.ts:75-77` | `sessions` / `conversation` | ✅ `watch.ts:75,77` |
| 展示 `command.ts:112-115` | meter / projections / llm（`statusText`） | ✅ `command.ts:112,113,115` |

### 1.3 漏项（点名）

```bash
# 1) index.ts 的宿主接线：四条，spec 一条都没提
grep -n 'ctx\.' src/project-handoff/index.ts | grep -vE 'ctx\.(logger|get)\('
```

- `src/project-handoff/index.ts:189` `ctx.systemPrompt.context({...})` —— 注入压力行（展示面注册）
- `src/project-handoff/index.ts:200` `ctx.on("session/event", ...)` —— **唯一触发器**（spec §0 提到了这个行号，但 §2 全表没收录）
- `src/project-handoff/index.ts:226` `ctx.on("session/disposed", ...)` —— 状态清理
- `src/project-handoff/index.ts:243` `ctx.commands.register({...})` —— 命令注册
- `src/project-handoff/index.ts:93` `export const inject = ["llm", "systemPrompt", "commands"]` —— 宿主依赖声明本身

> spec §2 声称列的是"`src/project-handoff/` 里碰宿主的点"，而这三行正好是"触发 + 展示 + 命令"
> 三条宿主接线。§0 已单独讲触发，但 §2 的全表按自己的定义应把它们归类收录（属"展示/接线"）。

- **16 处 `ctx.logger`** 全部未列：`auto.ts:50,59,72`、`child.ts:30,123,169,243,262,285,287`、
  `index.ts:125,130`、`perform.ts:206,210,219`、`relabel.ts:102`。
  这一条**对本批有实质影响**：§3.4 只说 `recordHandoffGate` / `recordHandoffDeferral` 不进核心，
  但 `auto.ts:50`（question 延后）、`auto.ts:59`（subagents 延后）、`auto.ts:72`（skip）这三行日志
  同样是"决策侧的可观察副作用"，抽链后必须留在适配器里（现有 `decide.ts` 落地方案正是由
  `Decision.kind` 驱动它们）。全表不含 logger，就漏掉了"核心必须只回 fact、由适配器发声"这条约束的证据。

- **文件写入（执行副作用）** 未列：`perform.ts:12` 引入 `writeAtomic`、`perform.ts:180`
  `await writeAtomic(file, document)`（写 HANDOFF.md）、`perform.ts:139-140`
  `logsDir` / `sessionIndexFile`（归档路径）、`index.ts:132-133`
  `getProjectRoot` + `logError`（写 `errors.log`）。
  spec 的"执行副作用"行只写了 `perform.ts:125` 的 controller 一处；若该表真的是"副作用清单"，
  写文件这一大类缺失。

### 1.4 归类错误

- `command.ts:186` 被放在"展示 / `/handoff status` 回执"。实际它属于
  `runManual`（`command.ts:178` 起）里的 `sessionController` 读取——**手动交接的执行路径**，
  不在回执渲染里：

  ```bash
  grep -nE '^(export )?(async )?function ' src/project-handoff/command.ts
  # 105 statusText … 178 runManual ；186 行落在 runManual 内
  ```

- `command.ts:84` 被放在"展示"。实际它在 `writeSetting`（`command.ts:83` 起）里，做的是
  `settings.update(...)`（`command.ts:87` `await settings.update(SETTINGS_NAMESPACE, patch)`）——**写**，
  属执行副作用；真正的"展示"读只有 `112-115`（`statusText`）。

### 1.5 措辞问题

§2 决策输入行的说明是"全是 `SomethingLike | undefined`，读不到即退出或回落"。对 `ctx.get`
的三处成立；对 `ctx.llm` **不成立**：

- `llm` 是 `inject` 声明过的服务（`index.ts:93`），不是可选 `ctx.get`，不存在"读不到"；
- `gate.ts:55` 没有 try/catch。`resolveModelInfo` 一旦 reject，异常会穿到
  `index.ts:119` 的 `maybeAutoHandoff(...)`，由 `index.ts:129-130` 记
  `failedUntil = now + FAILURE_BACKOFF_MS`（5 分钟，`state.ts:7`）并打 `warn`。
  这是**响亮的失败 + 退避**，既不是"退出"也不是"回落"。

---

## 2. §3.3 缺席语义四行是否与代码一致

### 第 1 行：`tokenMeter` / `sessionController` / 窗口 → 静默不决策（`unmeasurable`），`gate.ts:51-58`

**结论：实质正确，但不完整。**

```bash
sed -n '48,58p' src/project-handoff/gate.ts
```

- `gate.ts:51` `if (!controller || !meter) return undefined;` —— 静默 ✅
- `gate.ts:56-57` `resolved.context?.contextWindow` 缺失或 `<= 0` → `return undefined` —— 静默 ✅
- **漏一个同类静默出口**：`gate.ts:52-53` `resolveTarget(...)` 为 `undefined`（没有显式
  provider/model、会话也没有已路由请求）时同样 `return undefined`。它由配置 + `session`
  决定，不是宿主能力，但它和上面两行是同一个"量不出"出口，缺席语义表按能力逐条声明时会漏掉这一种。
- 另：`ctx.llm` 的失败不属本行（见 1.5），应作为第 4 种结局单列或明确排除。

### 第 2 行：`contextBreakdown` 投影缺失 → 回落 meter 包络并在回执里说出 `envelopeSource`

**结论：结论对，"回落到 meter 包络"这句只描述了两种子情形中的一种；§3.1 的"三种取值"是按类型写的错话。**

```bash
git show HEAD:src/project-handoff/runtime.ts | sed -n '56,84p'
sed -n '117,133p' src/project-handoff/command.ts   # 回执三态
```

`measuredContext`（HEAD `runtime.ts:74-84`）实际三态：

| 情形 | 返回 | `envelopeSource` |
|---|---|---|
| 投影可读（`runtime.ts:81`） | `{...measured, overheadTokens: envelope}` | `"projection"` |
| 投影缺失、**metre 自报了 `overheadTokens`**（`runtime.ts:83`） | `{...measured}` | `"meter"` |
| 投影缺失、meter **也没报**（`runtime.ts:83` 的三元另一支） | `measured` 原样 | **`undefined`（无该字段）**，floor 退回 `keep + MIN`（`runtime.ts:37`、`threshold.ts:59`） |

回执确实三态都说（`command.ts:128-132`）：`harness envelope <n>` /
`meter envelope <n> — not the harness composition` / `harness envelope unavailable — no contextBreakdown projection`。
所以"并在回执里说出"✅；但"回落到 meter 包络"只在第二态成立，第三态根本没有包络。

§3.1 写"`envelopeSource` 有三种取值（harness envelope / meter envelope / 不可用）"——**类型上是错的**：
`EnvelopeSource = "projection" | "meter"`（HEAD `runtime.ts:56`；S1 已把它原样挪到 `measure.ts`），
两个字面量；"不可用"是字段 `undefined`，不是第三种取值。回执层面才有三段文案。建议改成
"字段两个取值 + 一个缺席态"，否则 S2 的测试作者会按三值枚举去写断言。

### 第 3 行：`subagents` 列表投影缺失 → `runningContinuableChildren(...) ?? outstandingSubagents(...)`，`guard.ts:182`

**结论：实质正确；行号差一行，且"缺失"的触发条件比写的宽。**

```bash
sed -n '148,184p' src/project-handoff/guard.ts | grep -n 'return\|ctx.get\|=== undefined'
sed -n '182,184p' src/project-handoff/guard.ts
```

- `guard.ts:182` 是**函数签名**行；`??` 回落表达式在 **`guard.ts:183`**：
  `return await runningContinuableChildren(ctx, session) ?? outstandingSubagents(ownEventsOf(session), Date.now());`
- `runningContinuableChildren` 返回 `undefined` 的条件不止"`subagents` 缺失"，还有：
  `agents` 缺失（`guard.ts:154`）、listing 抛错/超时（`guard.ts:166-169`）、
  `kind: "diagnostic"` 行（`guard.ts:160`）、行里没有 `mode`（`guard.ts:161`）。
  所以这行的归因应写"实时注册表读不出（服务缺失 / 抛错 / 行不可分类）→ 回落事件日志"，
  否则会让人以为只有服务缺席才走日志；现有测试恰好逐条钉了这几种
  （`test/logic.test.mjs:3158` 的 `no live registry falls back to the log`、`a listing that throws`、
  `a diagnostic listing`、`an unreadable row shape` 四个 case）。

### 第 4 行：非驻留子会话 → 大声失败，不回退 RPC（`child.ts` 不变量）

**结论：完全正确（spec 未给行号，补上：`child.ts:203-209`）。**

```bash
sed -n '202,210p' src/project-handoff/child.ts
grep -n 'a non-resident handoff child fails the seed loudly' test/logic.test.mjs
```

- `child.ts:204` `const agents = ctx.get("agents") ...`；`child.ts:205` `agents?.get?.(childId)`
- `child.ts:206-208` 拿到 `undefined` 或没有 `followup` → `throw new Error("the handoff child ... is not resident in this process, so its continuation prompt was not admitted")`
- 无 RPC 回落（`child.ts:190-197` 的注释明说这是故意的）
- 现存用例：`test/logic.test.mjs:1000` "a non-resident handoff child fails the seed loudly instead of falling back to the RPC" ✅

---

## 3. §2 闸链顺序是否与 `auto.ts` 逐行一致

**结论：完全一致。** 命令与逐行对照：

```bash
git show HEAD:src/project-handoff/auto.ts | sed -n '31,80p'
```

| spec 闸 | spec 写的内容 | HEAD `auto.ts` | 判定 |
|---|---|---|---|
| 1 | `resolveHandoffGate` 量不出 → `undefined`（静默） | `37` 调用、`38` `if (!gate) return` | ✅ |
| 2 | `totalTokens < threshold` 未越线 → return | `43` `if (!threshold \|\| measurement.totalTokens < threshold.tokens) return;` | ✅ |
| 3 | `pendingQuestion` + defer → defer | `48` `config.handoffPendingQuestion === "defer" && pendingQuestion(session) !== undefined` | ✅（注意它同时受 config 门控，spec 只写"pendingQuestion + defer"，够用） |
| 4 | `pendingSubagentWork` 有在跑子会话 → defer | `56` 调用、`57` `if (pending.length > 0)` | ✅ |
| 5 | `handoffSplit + MIN_DROP_TOKENS(8000, threshold.ts:16)` 无可丢 → skip | `63` split、`64` `Math.round(split.older.length / CHARS_PER_TOKEN) < MIN_DROP_TOKENS`；`threshold.ts:16` `export const MIN_DROP_TOKENS = 8_000;` | ✅（值 8000 正确，源码写法是 `8_000`） |
| 6 | `performHandoff` | `79` | ✅ |

补充两点（都不是错，而是"顺序即语义"的遗漏）：

1. **闸 1 与闸 2 之间有一次状态写**：`auto.ts:41` `recordHandoffGate(session, gate, language)`。
   它在闸 2 之前执行，而 `display.ts:63-67` 会在 `totalTokens < threshold.tokens` 时
   `crossings.delete(key)`。**这条写就是第 4 条变异"看不见"的机制**：低于阈值时冻结的
   crossing 被删掉，之后 `recordHandoffDeferral`（`display.ts:85-86`）因拿不到 crossing 而直接 no-op。
   spec 的闸链列表没有这一步，读的人会以为"闸 3/4 先于闸 2"只是顺序差别。
2. 闸 5 分支还带 `skippedSince` / `skippedLoggedAt` 两个节流表的写（`auto.ts:69-73`），
   它们会出现在 `/handoff status` 回执里；这也是第 4 条替代变异要利用的可观察面。

---

## 4. §5 变异第 2 条：「把闸 2 移到闸 3/4 之后」

spec 原文：`把闸 2 移到闸 3/4 之后 | 红「未越线时即使有未答问题也不 defer」类用例`

### 4.1 裁定：**该变异对插件行为等价，作为"等价判据"变异无效。**

对 HEAD 代码逐项推理（不需要跑测试）：

1. 未越线时，`auto.ts:41` 已调 `recordHandoffGate`；`display.ts:63-68` 在
   `threshold === undefined || totalTokens < threshold.tokens` 时执行 `crossings.delete(key)` 并 return。
   于是**没有 crossing**。
2. `recordHandoffDeferral`（`display.ts:84-88`）第一句就是
   `const crossing = crossings.get(sessionId); if (crossing === undefined ...) return;`
   ——**没有 crossing 就什么都不记**。现有用例已经把这条钉死了：
   `test/handoff-pressure.test.mjs:159` "a reason with no visible crossing is dropped, not queued"。
3. `handoffPressureText`（`display.ts:117-119`）同样 `crossing === undefined` 就返回 `""`；
   `crossings` 的 `reason` 全仓只有这一个读者（
   `grep -rn 'handoffPressureText\|recordHandoffDeferral' src/` → 只有 `auto.ts` 与 `index.ts`）。
4. 两种顺序都**不交接**、都不写 `skippedSince`、都不动 `failedUntil`/`handedOff`/`inFlight`。

所以把闸 2 挪到闸 3/4 之后，宿主侧**唯一**的差别是：

- 未越线且带未答问题时，多一行 `ctx.logger.info("… handoff deferred — the last assistant message is a pending question")`（HEAD `auto.ts:50`）；
- 未越线且无未答问题时，多一次 `pendingSubagentWork(ctx, session)` 宿主读（HEAD `auto.ts:56`，5s 超时、内部 catch）。

两者都不是 deferral 被记录，也不是回执/压力行/日志语义的变化。**"未越线时即使有未答问题也不 defer"
这句话今天本来就恒真**（因为低于阈值时根本没有 crossing 可记），移动一个分支不可能让它变假；
变异能改的只是**出口的名字**。因此这条变异既不能证明"顺序即语义"，也不能兑现 §7 说的
"用来抓静默少交接"——它抓不到任何真实的行为改变。

对既有测试的后果（推理，未运行）：现存唯一断言 deferral 日志/回执的两个用例
（`test/logic.test.mjs:3243`、`:4401`）夹具都**在阈值之上**（`totalTokens: 199_000` / `190_000`，
窗口 200 000）；`grep -o 'totalTokens: [0-9_]*' test/logic.test.mjs | sort | uniq -c` 显示
调用 `maybeAutoHandoff` 的夹具只用了 `190_000` / `199_000`。**没有一条既有用例是"未越线"的自动路径夹具**，
所以该变异对既有 23+9+9 与全绿门禁**一个都不会红**。

### 4.2 唯一"能红"的地方是 S2 新写的标签断言，而这是循环证据

工作区已落地的 `test/handoff-decide.test.mjs` 确实为这条变异准备了负控：

```bash
sed -n '87,107p' test/handoff-decide.test.mjs
# :87 test("under the trigger, an open question does not defer — the threshold gate is first")
# :98 assert.deepEqual(decided, { kind: "below-threshold", tokens: TRIGGER - 1, threshold: TRIGGER })
# :99 // Negative control: §5 row 2 (gate 2 moved behind gates 3/4) turns this into `defer(question)`
```

把闸 2 后移后，`decideAutoHandoff` 对该 inputs 返回 `{kind:"defer", reason:"question"}`，
`:98` 会红。但这个红只证明"新核心按名字分支"，不证明"抽取没有改变行为"——那条断言是本批
自己引入的标签，属于用新写断言验证新写标签。§5 把这条与"等价判据"并列，措辞上**言过其实**。

（若把变异打在 `decide.ts`，它确实是有效**标签**变异：tsc 0 错、能进 `lib/`、只红对应具名用例。
问题不在"能否红"，而在"红意味着什么"——它不意味着行为变了。）

### 4.3 真正有效的替代变异（三个，按推荐度）

**替代 A（同族、可观察、最小改动）：把闸 5 提到闸 4 之前**

- 改法：`decideAutoHandoff` 里 `olderTokens < MIN_DROP_TOKENS` 的 `skip` 分支挪到
  `pendingSubagents.length > 0` 之前。
- 为什么有效：两者都在**阈值之上**才可达，此时 crossing 存在，所以
  `recordHandoffDeferral` 真的会改写已冻结的 `reason` → 压力行文案从
  "仍有后台子代理在运行，会延后交接" 变成 "当前没有足够旧的内容可丢弃，会跳过交接"
  （`display.ts:130-143`），且 `skip` 分支会写 `skippedSince`，`/handoff status` 多出
  `auto skipped since …`（`test/logic.test.mjs:3243` 的断言面）。**用户可见面真的变了。**
- 应红：`test/handoff-decide.test.mjs:119` "over the trigger, a running subagent defers before the
  nothing-to-drop skip"；`test/logic.test.mjs:4401`（两种日志门）在同一夹具下也会换文案。

**替代 B（改真正的执行结果，且既有具名用例会红）：`guard.ts:183` 的 `??` 回落断掉**

- 改法：`return await runningContinuableChildren(ctx, session) ?? [];`
- 为什么有效：服务缺失/抛错/行不可分类时不再回落事件日志 → 有 continuable 子代理在跑时
  会真的交接（创建子会话），正是 §7 说的"静默少交接/多交接"那一类真实回归。
- 应红（现存用例）：`test/logic.test.mjs:3158` 的四个回落 case
  （`no live registry falls back to the log`、`a listing that throws`、`a diagnostic listing`、
  `an unreadable row shape`）全部断言 `createsFor(...) === 0`，变异后变成 1。
  它同时钉住 §3.3 第 3 行——比第 2 条变异更对得上本批真正要钉的契约。

**替代 C（堵住真实空洞）：删掉「未越线早退」**

- 改法：`decide.ts` 里删去 `if (measurement.totalTokens < threshold.tokens) return {kind:"below-threshold"…}`。
- 为什么有效：未越线且可丢 ≥ `MIN_DROP_TOKENS` 的会话会返回 `handoff`，适配器真的
  `performHandoff` → 创建一个子会话。这是"阈值闸根本没生效"的最直接回归。
- **注意**：这条变异**今天没有任何既有用例能红**（同上，自动路径没有未越线夹具）。这本身是
  §5 的漏洞：门禁里没有一条"未越线 ⇒ 不交接"的适配器级断言，所以"删掉阈值闸"这种最严重的
  回归可以全绿通过。建议 S2 补一条适配器级用例（未越线夹具 → 不创建子会话），再把 C 作为变异。

---

## 5. 其他事实性错误 / 言过其实（按严重度）

### 5.1 §6「`/handoff now`（命令路径，检查零个闸）」——**错**

`runManual`（`command.ts:178-228`）至少检查了四个条件：

```bash
sed -n '178,210p' src/project-handoff/command.ts
```

- `command.ts:180` `inFlight` 单飞（"A handoff is already running for this session."）
- `command.ts:186-189` `sessionController` 缺失 → 明确报错
- `command.ts:196-204` **`pendingSubagentWork`（就是闸 4）** → 点名拒绝：
  "Handoff refused: N background subagent(s) still running …"
- `perform.ts:68-70` `assertHandoffDroppable` → 空 span 拒绝（在 `perform.ts:131` 被调用；`perform.ts:64`
  的注释明说自动路径"refuses a span below `MIN_DROP_TOKENS` first"，即手动路径只挡空 span、不挡 8 000 以下）

`guard.ts:173-177` 的注释也明说该函数"two callers act on it — the automatic path defers,
the manual path refuses"。所以命令路径不是"零个闸"，它**共享闸 4**；它跳过的是
`handoffEnabled`、阀值（闸 2）、pendingQuestion（闸 3）。对应既有用例：
`test/logic.test.mjs:3681`（手动路径拒绝空 span）、`:3716`（不检查 auto 开关与阈值）、
`:3766`（运行中子代理时拒绝）。措辞应改为"命令路径与核心唯一共享的是子代理闸，跳过
auto 开关/阈值/未答问题三闸"。

### 5.2 §1 判据 1 / §5 等价行引的三份文件，基本没有覆盖闸链

spec 写"既有 `test/handoff-decision.test.mjs`（23 条）、`test/handoff-pressure.test.mjs`（9 条）、
`test/handoff-relabel.test.mjs`（9 条）**断言一行不改**仍全绿"，把它当作抽链行为等价的证据。

```bash
grep -c 'maybeAutoHandoff\|resolveHandoffGate' test/handoff-decision.test.mjs test/handoff-pressure.test.mjs test/handoff-relabel.test.mjs
# handoff-decision: 0   handoff-pressure: 3   handoff-relabel: 0
```

- `handoff-decision.test.mjs`（23 条，数量 ✅）实际测的是 `ask_user_question` 的携带/配对/标题/种子，**没有一条**驱动 `maybeAutoHandoff` 或 `resolveHandoffGate`；
- `handoff-relabel.test.mjs`（9 条 ✅）同理，0 条；
- 只有 `handoff-pressure.test.mjs`（9 条 ✅）的 3 处沾到 `resolveHandoffGate`（`gateFor` 夹具 + 一条 `apply()` 接线用例）。

闸链真正的覆盖在 `test/logic.test.mjs`（`maybeAutoHandoff` 9 个调用点：`:3147,3154,3198,3267,3282,3292,4031,4494,4498`），
而 `logic.test.mjs` 有 159 条顶层用例、**不在**"断言一行不改"的三份名单里。
结论：这条等价判据**指向了错误的文件**，它无法支撑"抽链不改行为"。应改为把
`test/logic.test.mjs` 里那 9 个调用点（尤其 `:3117` 子代理、`:3158` 注册表/回落、`:3948` settle、
`:4401` 日志门、`:4458` 未答问题）列为等价面。

### 5.3 §5「全套 461 条」——数字对不上，需重取

```bash
grep -hE '^test\(' test/*.test.mjs | wc -l     # 473
grep -hE '^describe\(' test/*.test.mjs | wc -l # 0
```

静态顶层 `test(` 是 **473** 条（0 个 `describe`）。"461"我没有跑测试（禁令），所以不能断言它错
——`node --test` 的计数可能因跳过/条件用例与静态数不同——但**它是一个写死在文档里的数字**，
按本仓规矩（"Gate numbers written down always expire"）应由实际运行重取，或写成"以门禁实跑为准"。

### 5.4 §3.1 `GateInputs` 无法产出 §3.2 承诺的两个结局——契约自相矛盾

§3.1 的 `GateInputs` 只有 `measurement` / `contextWindow` / `pendingQuestion` /
`pendingSubagents` / `olderTokens`，**没有 `threshold`，也没有 `refusal`**；但 §3.2 的
`Decision` 里有 `below-threshold { tokens, threshold }` 和 `unmeasurable`。纯函数没有
`threshold.tokens` 就无法判闸 2，没有 `refusal` 就无法命名"量到但被护栏拒绝"那一种
`unmeasurable`。另外闸 3 还依赖 `config.handoffPendingQuestion`，而 `GateInputs` 不含 config。

实际落地被迫补齐（可作对照，不是要求 spec 追代码）：

```bash
sed -n '35,60p' src/project-handoff/decide.ts   # 新增 threshold / refusal，并把 config 作第二参
```

建议：§3.1 补 `threshold: ThresholdTerms | undefined` 与 `refusal?: ThresholdRefusal`，
并明确 `handoffPendingQuestion` 是"适配器折算进 `pendingQuestion`"还是"核心收 `config`"——
现在两种都存在（spec 无 config，落地有 config 默认参）。

### 5.5 §4 写范围漏了两个文件（有工作区证据）

§4 给 S1 的写范围是 `decide.ts` + `auto.ts`（+ `lib/`）。实际落地还必须新增
`src/project-handoff/measure.ts` 并改 `src/project-handoff/runtime.ts`：

```bash
git status --short | grep -E 'measure|runtime|decide'
```

原因是 §3.1 让核心携带 `MeasuredContext`，而该类型定义在 `runtime.ts`，`runtime.ts` 里
`import { type Session } from "@deepseek-ai/dsh-session"` 在 `verbatimModuleSyntax` 下仍会真的
加载宿主包——`measure.ts` 的模块注释原话就是这么写的（"a decision module taking the type from
`runtime.ts` would therefore load the host's session package at runtime"）。
这不是实现者加戏，而是 §1 判据 2（"`decide.ts` 不 import `@deepseek-ai/dsh-session`"）与
§3.1（类型来自 `runtime.ts`）**互相冲突**的必然结果。§4 的并行写范围因此是错的：S1 的写范围
必须含 `runtime.ts` 与新的 `measure.ts`，否则"S1 与 S4 串行、其余并行"的冲突分析漏掉一个共享文件。

### 5.6 §2「执行状态」段的枚举错误

spec："`state.ts:13-50` 的 `handedOff`（一次性）、`inFlight` + `pendingTriggerSeq`（单飞…）、
`failedUntil`（`FAILURE_BACKOFF_MS = 5min`）、三个日志节流表。"

```bash
grep -n 'export const' src/project-handoff/state.ts
```

- `FAILURE_BACKOFF_MS = 5 * 60_000` ✅（`state.ts:7`）
- "三个日志节流表"不准：`skippedLoggedAt`（`:29`）与 `deferredLoggedAt`（`:40`）是**日志节流**；
  `skippedSince`（`:37`）不是日志节流，它的注释明说是给 `/handoff status` 回执留"第一次跳过时间"
  （"keeping the first occurrence stops the timestamp from looking like 'just now' on every read"）。
  即 **2 个日志节流 + 1 个回执时间戳**。
- **`pendingRetire`（`state.ts:50`）被漏掉**——它就在所引的 13-50 范围内，是"手动交接在自己的
  回合里完成后，等 `turn/end` 再 retired"的执行状态（`state.ts:42-49` 注释、`index.ts:221`
  `retireIfPending`）。抽链时它同样留适配器，属"执行状态"，不该漏。

### 5.7 §3.4「`handoffPressureText` 读回的仍是决策所用那份对象」——措辞不准

`recordHandoffGate` 在 `display.ts:72` 是**新建**一个 `Crossing` 对象
（`{tokens, threshold, contextWindow, language, reason: undefined}`），值抄自 gate 的数字；
`handoffPressureText` 读的是这个 frozen copy，不是 `ResolvedHandoffGate` 本身。
"同一份数字/同一份冻结值"成立，"那份对象"不成立。

### 5.8 §0 行号小偏差

"`src/project-handoff/index.ts:200-225` 的 `session/event` 过滤"——回调体是 `200-224`；
`session/disposed` 是**另一个** `ctx.on`（`index.ts:226-241`），不在 200-225 内。
"三个事件不是三条状态迁移，是一个触发点加两条旁路"这个判断本身正确（`turn/end` → attempt；
`step/start` → tickPressure；`user/message` → relabel；`session/disposed` 单独一个 handler）。

---

## 6. 我核不了的

1. **全套用例的真实条数**（spec 写 461，静态 473）。禁令内不能跑 `pnpm test` / `node --test`。
2. **S1 落地后的最终行号**：审计期间 `auto.ts`（23:01）、`runtime.ts`（23:04）、
   `decide.ts`（23:03）、`test/handoff-decide.test.mjs`（23:06）仍在变。本文对工作区文件的
   描述仅代表 23:03–23:07 的快照。
3. **`node --test` 是否会对 `test/client-*.test.mjs` / `card-render.test.mjs` 的条件分支跳过**：
   这可能是 461 与 473 差额的来源，需实跑才能定。
4. **变异实跑**：以上"应红"全部是读源码 + 读测试的推理，未执行（按禁令）。

## 附：本文用到的可复现命令

```bash
cd /mnt/Data/Projects/dsh-project-context
git rev-parse HEAD                                  # 3b3e3684d67c103678ac1fc66e6120a40f1bc766
grep -rnE 'ctx\.get\("|ctx\.(llm|agents|logger|sessionController|subagents|sessionProjections|tokenMeter|tools)\b' src/project-handoff/*.ts
grep -rn 'ctx\.' src/project-handoff/*.ts | grep -vE 'ctx\.(logger|get)\('
git show HEAD:src/project-handoff/auto.ts | sed -n '31,80p'
sed -n '42,70p' src/project-handoff/gate.ts
sed -n '56,84p' src/project-handoff/runtime.ts          # 工作区已变，取 git show HEAD: 同一区段
sed -n '182,184p' src/project-handoff/guard.ts
sed -n '202,210p' src/project-handoff/child.ts
sed -n '60,145p' src/project-handoff/display.ts
sed -n '1,50p' src/project-handoff/state.ts
sed -n '105,135p' src/project-handoff/command.ts
sed -n '178,210p' src/project-handoff/command.ts
sed -n '55,72p' src/project-handoff/perform.ts
grep -c 'maybeAutoHandoff\|resolveHandoffGate' test/handoff-decision.test.mjs test/handoff-pressure.test.mjs test/handoff-relabel.test.mjs
grep -hE '^test\(' test/*.test.mjs | wc -l
grep -o 'totalTokens: [0-9_]*' test/logic.test.mjs | sort | uniq -c
sed -n '87,107p' test/handoff-decide.test.mjs
```
