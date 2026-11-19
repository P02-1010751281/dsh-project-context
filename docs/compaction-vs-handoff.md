# 压缩 vs 交接：边界与规格（2026-11-18）

> 状态：第 3、4 节已落地（W1-C，`src/project-handoff/compaction.ts` + `command.ts` 的 status 行），
> 其余仍是规格。依据：dsh 0.2.2-rc.3 的 `packages/compaction/*`、本仓库
> `src/project-handoff/*` 与 `docs/handoff-candidates-b-c.md` 的既有裁定。
> 结论一句话：**压缩归宿主，交接归本插件；本插件只观察压缩，不实现、不接管、不抢 waterfall。**

## 1. 两个机制

### 1.1 dsh 自带压缩

| 项 | 事实 | 来源 |
|---|---|---|
| 压力线 | `floor(min(W × 0.8, W − reserved − 65536))` | `compaction-basic/src/config.ts` `resolveCompactSpec` |
| 保留量 | `floor((W − reserved) × 0.16)` | 同上 |
| 自动触发 | `agent/pre-step` 的 `compactIfNeeded('pressure')` | `compaction-basic/src/index.ts` |
| 溢出兜底 | `agent/request-error` → 压缩 → `{kind:'retry'}`；`maxOverflowRetries` 默认 1 | 同上 |
| 手动 | `/compact` → `compactNow`，需空闲 agent + `runMaintenance` | `compaction/src/index.ts` |
| 改写 | durable surface replace：`compaction/start|summary|end` + 遮蔽被压缩 span；原文仍在 append-only 日志 | `compaction/src/types.ts` |
| 边界 | 工具调用/结果保持配对；不平衡/非法 range 被拒绝。第三方引擎（如 billion-context）另加活动用户消息、注入文件当前副本、skill 目录保护 | `compaction/src/tool-pairing.ts`、`compaction-basic/src/region.ts`、billion-context README |

一个 realm 只能有一个 `ctx.compaction` 后端。billion-context 这类第三方引擎要接管它，必须禁用
`compaction-basic`；本插件不参与这个选择。

### 1.2 本仓库的交接

- 只在 `turn/end` 评估；阈值 = `min(max(baseline + keep + summarize, quality), usable − margin)`，
  `quality = upstreamUsableInput ?? knee(window)`；
- 门控：`handoffEnabled`、阈值、未答问题（`defer` 才挡）、在跑子代理、本会话未再开新轮；
- 种子：原文尾料 + 文件清单 + 未答问题 + 父/子 meta；**批次 J 起零模型调用**；
- 读取：`handoffSplit` 从 **append-origin 日志**取尾料，压缩遮蔽 surface 不影响种子完整性；
- 旧会话默认退休（`handoffRetireReplaced`）。

### 1.3 为什么不是同一件事

压缩回答「这个会话怎么继续装得下」；交接回答「这个会话该不该结束、下一个从哪开始」。
压缩是**有损视图替换**（可展开、但模型看到的是摘要）；交接是**边界 + 原文尾料**（不写摘要）。
把交接换成压缩，会丢掉「为什么/死路」和可审计的边界；把压缩换成交接，会在每次压力时切会话，
摩擦不可接受。正确关系是分层，不是替代。

### 1.4 它们不冲突（三个接触点，各有归属）

先给结论：**机制上不冲突**。压缩改的是「模型可见的 surface」，交接读的是「append-origin 日志」
并改「会话边界」——两层，不是两个竞争者。真会冲突的是**同一 realm 里两个 `ctx.compaction` 后端**
（billion-context 必须先禁用 `compaction-basic` 才装得下），而本包从不注册那个服务。

会互相碰到的只有三处，每一处都有明确归属：

1. **压力**（唯一共享的量）。压缩把 `tokenMeter` 的占用降下来，而交接的触发读同一个数；压缩先发生，
   `turn/end` 上的测量就自然低于阈值，交接不触发。这是**组合**而不是争用：减压阀开了，就不需要换房间。
2. **种子**（交接依赖压缩不倒退）。`handoffSplit` 与 `fileOperations` 都从 append-origin 日志读：
   checkpoint 节点的 `source.kind` 不是 `user`，被摘要掉的 `read`/`write`/`edit` 调用仍留在日志里。
   所以压缩遮蔽任何 span 都不会让种子少一块。代价是种子引用「日志里的对话」，压缩之后它可能带着
   模型当时已经看不到的原文——有意的取舍：保真优先于「复述视图」。
3. **次序**（策略，不是机制）。1M 窗口上我们 157K 交接、宿主 800K 才压缩，于是交接**抢在**压缩前面
   发生——这不是冲突，是同一个目标函数下的排序；想让压缩先来，把 `handoffThreshold` 设到 `0.8` /
   `800k` 即可（代价见 §2）。

**唯一没有守卫的边角**：若将来实现「`agent/status = idle` 时兜底压缩」（§6），同一次 idle 窗口里的
`/handoff now` 可能与压缩事务重叠——交接会退休父会话，压缩的 commit 阶段可能随之失败。父会话反正要
归档、子会话的种子早已落地，所以伤害限于一条失败日志；但要做兜底，先补这个守卫。

## 2. 何时谁先发生（数学）

忽略 `reservedCompletionTokens`（实际会略移），比较：

- 压缩线：`C(W) = min(0.8W, W − 65536)`
- 膝线：`K(W) = round(W − (W − 157000) / (1 + e^(−ln(W/450000)/0.04)))`

| W | K(W) | C(W) | 谁先 |
|---:|---:|---:|---|
| 128K | 128K | ~62K | 压缩 |
| 200K | 200K | ~134K | 压缩 |
| 400K | ~388K | 320K | 压缩 |
| 500K | ~180K | 400K | **交接** |
| 1M | 157K | 800K | **交接** |

交叉点约 **436K**（精确值随 `reservedCompletionTokens` 移动）。含义：

- **≤400K 的窗口，压缩先发生**，auto handoff 往往到不了膝线；这是宿主在替我们减压，不是 bug。
- **≥500K 的窗口，膝线先到**，我们在压缩线之前交接；这是质量优先的故意选择。
- 1M 上压缩后保留约 16% ≈ 160K，接近膝线；也就是说宿主也认为 ~160K 是有用工作集，只是允许
  先在 160K→800K 之间降质换连续。

## 3. 可观测：只读 `compaction/*`

压缩事件是 session event，本插件在 `session/event` 上已经能看到，不需要新服务、不需要改触发。

### 3.1 事件形状（dsh 0.2.2-rc.3）

| 事件 | 必填 | 可选 | 用途 |
|---|---|---|---|
| `compaction/start` | `compactionId`, `turn` | `sourceCommandId` | 开始；`turn:null` 是非自动路径（手动 `/compact`） |
| `compaction/summary` | `compactionId`, `summary`, `shadowedRange`, `shadowedSeqs`, `shadowedTokenCount`, `provider`, `model` | `sourceCommandId`, `maxTokens`, `usage`, `rawOutput`, `llmStreamCall` | 摘要完成；`shadowedTokenCount` 是回收量 |
| `compaction/end` | `compactionId`, `turn` | `sourceCommandId`, `error` | 结束；`error` 存在即失败 |
| `compaction/prune` | `shadowedRange`, `shadowedSeqs`, `shadowedTokenCount` | — | 无模型的 prune |

### 3.2 核心与 shim（已实现）

两个文件，一只 shim（`SH-10`）：

| 文件 | 角色 | 知道什么 |
|---|---|---|
| `src/project-handoff/compaction.ts` | **core**，纯 | `CompactionRecord` DTO、折叠、回执行；不 import `@deepseek-ai/*`，不接 `ctx`/`Session`/`fs` |
| `src/project-handoff/compaction-events.ts` | **shim**，`SH-10` | 唯一知道 `compaction/*` 四种宿主形状的地方；`unknown → CompactionFeed`，认不出的形状在这里变成 `unavailable` |

```ts
type CompactionRecord =
  | { kind: "start" }
  | { kind: "summary"; id: string; shadowedTokens?: number; provider?: string; model?: string }
  | { kind: "end"; id: string; error?: string }
  | { kind: "prune"; shadowedTokens?: number }

type CompactionFeed =
  | { kind: "records"; records: readonly CompactionRecord[] }
  | { kind: "unavailable"; reason: "unreadable" | "malformed" }

function foldCompactions(records): { summarized; pruned; failed; reclaimedTokens; lastSuccess?; lastError? }
function compactionStatusLine(feed: CompactionFeed, language): string
```

规则（与实现一致）：

- `summarized` 数**不同的** `summary` id——重放的同一条记录仍是同一次压缩；
  `pruned` 数 prune 记录（它没有 id，因为 prune 不是一次事务）。
- 标题数字 `N = summarized + pruned`：只有真正回收了上下文的动作才算一次压缩。
  成功的 `end` 不再单独计一遍——它的 summary 已经计过。
- `failed` 数**带 `error`** 的 `end` id；失败的尝试不回收任何东西，所以不进 `N`。
  空白 error 不构成「有原因」，不计入失败。
- `reclaimedTokens` 只累加**日志里写出来的** `shadowedTokenCount`；字段缺失就是缺失，
  不读作 0，也不影响其余计数。
- 事件源不是数组 → `unreadable`；认识前缀但不认识的 `compaction/*` 类型、或
  `summary`/`end` 没有 `compactionId`、`data` 不是对象 → `malformed`。两者都**不得当 0**：
  未来宿主新增一种压缩事件时，静默少数比具名缺口更糟。
- 不从事件推断「压缩后占用」：那需要当时的 `tokenMeter` 快照，日志里没有；只报
  `shadowedTokenCount` 与当前 `context` 行。

拆成两半的理由是**拆除面**：宿主形状变了只改 shim，核心的折叠与措辞仍可用普通 DTO 测；
将来按 `SH-10` 的拆除条件把 shim 换成类型导入时，核心一行都不用动。

## 4. `/handoff status` 压缩行（已实现）

位置：紧跟「占用组」（`context <used>/<window> (<pct>%)` 及其阈值行）之后；当路由或 meter 不可用、
没有 `context` 行时**仍然输出**——那正是用户打开回执的场景，压缩历史与路由是否可用无关。

| 状态 | 输出（en） |
|---|---|
| 有成功压缩 | `compactions N (summarized S, pruned P)[, last shadowed <tokens> tokens][, <provider>/<model>]` |
| 同时有失败 | 追加 `, failed <count>[：<error ≤ 120 chars>]`（去换行/控制字符） |
| 0 次、无失败 | `compactions 0 (no compaction recorded)` |
| 0 次、有失败 | `compactions 0 (no successful compaction)` 再追加失败段 |
| 不可读 | `compactions unavailable (session log unreadable)` |
| 形状不认识 | `compactions unavailable (unrecognized compaction record)` |

zh 回执用同一组事实的中文措辞（`压缩 N 次（摘要 S 次、prune P 次），最近回收 T token，p/m，失败 F 次：…`）。

约束：

- 只用 `session.snapshotEvents()` 的只读折叠；不改阈值、不改注入、不写盘。
- 数字必须与日志逐条一致；重启后从日志折叠仍一致。
- 失败文案只报 `error` 字段，不推断原因；没有 `error` 不写「失败」。
- 不在 `HANDOFF.md` 里写压缩行（那是种子产物，不是诊断）；需要时另开字段。

## 5. 交互原则

1. **不接管 `ctx.compaction`**：不注册后端、不改 `compaction-basic`、不碰 `agent/pre-step`。
2. **不新增触发**：交接仍只在 `turn/end`；压缩事件只进 status。
3. **用户杠杆已存在**：把 `handoffThreshold` 设成 `0.8` 或 `800k`，交接就退化为「压缩兜不住时」，
   不需要新配置键；文档要写明代价（157K→800K 的质量衰减）。
4. **兜底：技术可行，裁定不做**（2026-11-18）。第 6 节的探针证明插件能拿到 `Agent` 并直接调
   `compactNow`，但 `turn/end` 那一刻驱动器仍持有 agent（`busy`），只有 `agent/status = idle` 或
   命令处理器可行。理由与重开条件见 §9；本轮不改任何行为。
5. **第三方后端兼容**：只要对方仍发 `compaction/*`，本统计就有效；不依赖 `compaction-basic` 的内部。

## 6. `compactNow` 可调用性（2026-11-18 已探，源码级）

来源：store 里的 `dsh-desktop-0.2.2-rc.3` 检出（`/nix/store/xbbn6inj2q64j88gsmjrljqkh1m572sy-dsh-desktop-0.2.2-rc.3/lib/dsh-desktop/repo/`）。
全部结论都是**读声明与实现**得到的，不是从调用路径猜的。

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | `ctx.get("compaction")` 在插件上下文里是否返回服务？ | **返回**（未声明时 `undefined`，不抛） | `Context.compaction: CompactionEngine` 由 `compaction/src/index.ts` 声明；`compaction-basic` 提供实现 |
| 2 | 插件能否从 session 取到 agent？ | **能**：`ctx.agents.get(session.id): Agent \| undefined` 是公开方法 | `core/agent/src/index.ts` 的 `AgentRegistry.get`，`agents` 就是服务名 |
| 3 | `Agent` 是否满足 `ManualCompactAgentContext`？ | **满足**：`session`、`options: AgentOptions`（`provider?`/`model?`）、`runMaintenance` 都在 | `runtime-types.ts` 的 `interface Agent`；`AgentOptions` 的字段是 `{provider?, model?, reasoningEffort?, maxTokens?}`，结构上是 `ManualCompactAgentContext` 要求的超集 |
| 4 | 插件要自己构造 maintenance 上下文吗？ | **不要**：`compaction-basic.compactNow` 内部就 `agent.runMaintenance(...)`；调用方只传一个**空闲**的 `Agent` | `compaction-basic/src/index.ts` 的 `override compactNow` |
| 5 | 在 `turn/end` 调用会怎样？ | **`busy`**：`turn/end` 在驱动器的 `finally` 里追加，而 `setPhase({kind:"idle"})` 在 `kick()` 的 `finally`、**晚于**整轮循环；`runMaintenance` 在 `phase.kind !== "idle"` 时同步抛错 | `agent-loop/src/agent.ts`：`session.append('turn/end', …)`（`turn()` 的 finally）与 `kick()` finally 的 `setPhase({kind:'idle'})` |
| 6 | 那哪个时机可行？ | **`agent/status = idle`**：`setPhase` 在状态变化时发这个事件，此时 phase 已是 idle；命令处理器里的 `invocation.agent` 也是 idle 的 `Agent` | 同上；宿主自己的 `/compact` 就是 `ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)` |
| 7 | 产生的 `compaction/start` 会不会被误读成自动压缩？ | `turn: null` 标示非自动路径（手动/插件触发），与 `/compact` 同形；`sourceCommandId` 只有命令路径才带 | `compaction/src/types.ts` 的 `compaction/start` 注释 |

**所以「兜底」在技术上不是空想**，但两个边界要先说清：

1. **不能在 `turn/end` 做**：那一刻驱动器仍持有 agent，`runMaintenance` 同步拒绝（`busy`）。可行的时机是紧接着的 `agent/status = idle`（本插件已经监听这个事件做归档）。
2. **要不要做仍未裁定**（D3）：技术上可行 ≠ 应该做。它会带来一次额外的摘要模型调用、一条 `compaction/*` 事务，以及「交接被 defer 时先压缩」这种新的行为组合；在用户没有明确要求之前，本仓库只保留观测（第 3、4 节）。

**仍未证的**：`agent/status = idle` 监听器里调用 `compactNow` 的**实测**是否稳定（本探针只读源码，没有在真实宿主上开火）。若要做兜底，第一步是把这个实测补上，按「探针先于承诺」的纪律。

## 7. 验收（第 3、4 节已落地，W1-C）

- `test/handoff-compaction.test.mjs` 10 条：空日志、单次完成、重放去重、prune 分计、失败具名、
  超长失败裁剪到 120、不可读/形状不认识、字段缺失、回执位置、无路由/meter 时仍然输出。
- 变异轮（有效 4 个，每个只红目标用例）：删 id 去重 → 重放用例；未知 `compaction/*` 静默跳过 →
  防御用例；缺失金额读作 0 → 字段缺失用例；把行挪回「有路由才输出」→ 无 meter 用例。
  （第 5 个变异 `const empty = true || stats.failed === 0` 因 `TS2339` 编译失败，按纪律不计入。）
- 全量门禁：`pnpm typecheck` 0、`pnpm test` 627/627、`pnpm build` ok、`lib/` 与源码一致。
- 触发路径零 diff：本批没有碰 `index.ts` 的事件面、阈值、注入或任何写路径。

## 8. 非目标

- 不实现压缩、不接管 `ctx.compaction`、不改 `thresholdRatio`/`retainRatio`。
- 不做 mid-turn 交接、不为「越线必达」停掉在飞轮次。
- 不把压缩行写进 `HANDOFF.md`、不用压缩次数自动改阈值。
- 不实现自动兜底压缩（§9 的裁定）；不在本规格里实现探针，第 6 节只是结论。

## 9. 裁定：不实现「handoff 被挡时自动压缩」（2026-11-18）

探针把「能不能」答了（§6：能，时机是 `agent/status = idle` 或命令处理器）。这一节回答「要不要」：
**不做**。四条理由，按分量排序：

1. **它推翻一条既有契约**。交接自批次 J 起**零模型调用**；`compactNow` 走 `compaction-basic` 的
   `compactSurfaceRegion`，必然发一次摘要模型调用。为一个没被真实会话证明需要的路径，在失败分支上
   引入模型调用，等于把「交接不花钱」这条承诺改成「平时不花钱」。
2. **它在最不该动手的时刻改写视图**。被 `defer` 挡住的最常见原因正是**模型在等用户回答**；此时把上下文
   摘要掉，是替用户做了一次他没要求的 surface 替换，而用户下一步要回答的正是被摘要的那段。反复压缩还会
   叠加 ACE 的 context collapse。
3. **上线成本是六面 + 一条兼容面**。安全起见它必须默认关闭 ⇒ 新配置键走 batch H 的六面
   （`config.ts` / `settings.ts` / `client/card-fields.ts` / `locales.ts` / 所有 reader / 测试，且字段必须
   `volatile`）；同时把 `ctx.compaction` 的可用性与 `ManualCompactionError` 语义带进版本兼容面——为一个
   猜出来的需求。
4. **未实测，且有一个未守卫的竞态**（§1.4 末段）。探针只到源码级；`agent/status = idle` 里调
   `compactNow` 的稳定性、以及它与「交接退休父会话」的重叠都没验证过。

**替代（都已存在，不新增代码）**：

- 宿主自己的 0.8W 压缩仍是兜底：被挡住的会话最终会被压缩，只是晚一些；
- 手动杠杆是真的：dsh `base` bundle 带 `command-compact`，`/compact` 需要空闲 agent，正好用户读完回执
  决定「先减压」时用；
- 观测已就位：`/handoff status` 同时报占用、阈值与压缩历史，用户能看到自己在「不安全带」里。

**重开条件**（任一出现再谈，仍按「先证后写」）：

1. 归档里出现「越过膝线后被 defer 很久、且后续质量明显下降」的会话（用 `/handoff status` 的
   skipped/deferral 记录 + 会话时长交叉判断）；
2. 宿主提供**不需要模型调用**的压缩入口（例如可单独调用的模型无关 prune）；
3. `agent/status = idle` 调 `compactNow` 的实测通过，并证明不与退休竞态。

判定的性质：这是**本插件的产品裁定**，不是上游能力判定；§6 的探针结论不因它改变。

