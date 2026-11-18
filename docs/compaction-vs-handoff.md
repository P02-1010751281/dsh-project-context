# 压缩 vs 交接：边界与规格（2026-11-18）

> 状态：规格，`src/` 未改。依据：dsh 0.2.2-rc.3 的 `packages/compaction/*`、本仓库
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

### 3.2 纯函数 `compactionStats(events)`

```ts
type CompactionStats =
  | { available: true; completed: number; summarized: number; pruned: number;
      last?: { endSeq: number; shadowedTokens: number; provider?: string; model?: string; error?: string } }
  | { available: false; reason: "unreadable" | "malformed" }
```

规则：

- 按 `compaction/end` 计数；`error` 存在算失败，不计入 `completed`，但进 `last.error`。
- `summary` 与 `prune` 分别计数；同一 `compactionId` 只算一次。
- 事件数组不可读/形状不认识 → `available:false`，**不得当 0**；单条 `summary` 字段缺失只丢字段，
  不让整个统计失败。
- 不从事件推断「压缩后占用」：那需要当时的 `tokenMeter` 快照，日志里没有；只报
  `shadowedTokenCount` 与当前 `context` 行。

## 4. `/handoff status` 压缩行规格

位置：紧接现有 `context <used>/<window> (<pct>%)` 行之后。

| 状态 | 输出 |
|---|---|
| 有完成压缩 | `compactions N (summarized S, pruned P), last shadowed <tokens> tokens[, <provider>/<model>]` |
| 最近一次失败 | 追加 `, last failed: <error ≤ 120 chars>`（去换行/控制字符） |
| 0 次 | `compactions 0 (no compaction recorded)` |
| 不可读 | `compactions unavailable (session log unreadable)` |

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
4. **兜底未证不做**：插件调用 `compactNow` 需要 `ManualCompactAgentContext`（`agent.runMaintenance`）；
   没有探针证明插件能拿到它，就不得写「handoff 被 defer 时自动压缩」。
5. **第三方后端兼容**：只要对方仍发 `compaction/*`，本统计就有效；不依赖 `compaction-basic` 的内部。

## 6. `compactNow` 可调用性探针清单（先证后写）

1. `ctx.get("compaction")` 在插件上下文里是否返回服务（未 inject 时是否 `undefined`）？
2. 插件能否从 `session` 取到 agent（`ctx.agents.get(session.id)` 或等价）？
3. 该 agent 是否暴露 `runMaintenance`，能否构造 `ManualCompactAgentContext`？
4. 在 `turn/end`（agent 刚 idle）调用 `compactNow` 是成功、`busy`、还是 `changed`？
5. 调用产生的 `compaction/start` 是否带 `turn:null` 且无 `sourceCommandId`？会不会被误读成自动压缩？
6. 失败路径（无 route、摘要失败、commit 失败）各返回哪个 `ManualCompactionErrorCode`？
7. 调用是否改变 `turn/end` 之后立刻到来的新 prompt 的顺序（FIFO/唤醒）？

只有 1–4 全部通过，才谈「兜底」；否则结论写「宿主 0.8W 自动压缩就是兜底」。

## 7. 验收（若落地第 3、4 节）

- 合成 0/1/3 次压缩：计数、`summarized/pruned`、`last.shadowedTokens` 与事件逐条一致。
- 乱序/缺 `summary`/`compaction/end` 带 `error`：分别得到 `last.error` 或字段缺失，不抛。
- 事件源不可读：`available:false`，status 显示 `unavailable`。
- 触发路径零 diff：变异「删掉 status 行」只红 status 用例；变异「把 unavailable 改成 0」红防御用例。
- 重启后同一会话的 status 数字不变（从日志折叠）。

## 8. 非目标

- 不实现压缩、不接管 `ctx.compaction`、不改 `thresholdRatio`/`retainRatio`。
- 不做 mid-turn 交接、不为「越线必达」停掉在飞轮次。
- 不把压缩行写进 `HANDOFF.md`、不用压缩次数自动改阈值。
- 不在本规格里实现探针；第 6 节只是清单。
