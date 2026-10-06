# Batch M — 让「越线」可见（注入路线，先方案）

状态：**方案待拍板，未写产品代码**。本文只描述改动面、成本与验证方式。
上游动机：`54cdf479`（`↪ handoff · a00eb4ce`）在 **316,189 / 1,000,000** 对阈值 **157,000**（2.01×）处，因为
**只有一个未结束的 turn**，`turn/end` 从未触发，所以自动交接**从未被评估过**，用户只能自己手算才发现。

## 1. 目标与判据

- 目标：会话越过阈值时，**用户可见地**知道「已经越线、为什么还没交接」。
- 判据（本批的验收面）：越线后模型在下一轮能说出占用、阈值与延后原因，且数字与**决策所用**的同一份计算一致。
- 明确不做：不改触发时机（那是候选 (b)，`turn/end` → 也看 `step/end`，属设计决策）。

## 2. 为什么不能"每轮加一行"（已实测，本条推翻了上一轮的口头成本）

在这台 harness 上，注入文本是**运行时上下文快照**（`PromptContext` 的文档原话：*dynamic model context
materialized as a durable user-role snapshot*），而快照是**追加**进 surface 的。实测证据（本仓归档的上一会话）：

```
.agents/memory/session-logs/session-3a19d454-.../session.jsonl
  "Current runtime context" 出现 5 次，全部是 user/message，全部 surfaceOp:"append"
  len 37274 / 37274 / 37761 / 37513 / 37875   （第 1、2 条等长但 sha 不同 → 微小的文本变化也会重新追加）
  该会话 74 个 surface 事件 **全部** 是 append，**零** 个 ranged replace
```

fold 侧对应实现：`@deepseek-ai/dsh-token-meter/src/surface-fold.ts` 的 `planSurfaceTokens` 对
`surfaceOp:"append"` 直接 `deltaTokens = tokens`；只有带 `startSeq/endSeq` 的 ranged op 才会
`commitSurfaceTokens` 里 splice 掉旧节点。既然生产端从不发 ranged op，**被 supersede 的快照不被回收**。

结论：**注入文本每变一次 ≈ 追加一个 ~37 KB 的 user 快照，且永久留在 history 里。**
所以本批的成本口径是「**每次文本变化 ~37 KB**」，不是「每轮几个 token」。设计约束随之变成：
**让文本尽可能少变**（见 §4 的状态机）。

（对照：候选 a4 的客户端 cell 是 UI，**零 history 成本**，代价是 `zod` 依赖 + 两 profile 安装 + 重启。
两条路的成本项不同，不是同一个量纲。）

## 3. 座位与归属

- 座位：`ctx.systemPrompt.context({ name: "handoff-pressure", order, text })`
  （`dsh-system-prompt` 的 `PromptContext`）。**不要**放进 `project-memory` 的两个 context——
  本项目已有 `order: 190` / `210` 两个贡献，第三行属于 handoff 的语义。
- `text` 的类型是 `string | ((context: AssembleContext) => string)`：**同步**，且"Empty text contributes nothing"。
  所以**不能在 `text()` 里现算**（阈值需要 `await ctx.llm.resolveModelInfo(...)`）。
- 归属：由 **project-handoff** 自己注册（它拥有阈值），`inject` 里加 `systemPrompt`。
  `project-memory` 一行不改——避免把 handoff 的公式牵进 memory 的注入路径。
- 顶层门：沿用 `isTopLevel(session)`，子会话不注入。

## 4. 计算时机与状态机

计算与显示分离：

1. **计算**：在已有的 `session/event` 监听里加 `step/start`（不是 `turn/end`）分支，调用 §5 的共享入口，
   把结果按 session 存进内存表（与 `state.ts` 里 `skippedSince` / `deferredLoggedAt` 同风格）。
   选 `step/start` 的理由正是动机案例：**轮次永不结束的会话也有 step**，`turn/end` 分支看不到它。
2. **显示**：`text()` 只做同步读表，未越线返回 `""`。

状态机（用来把 §2 的 ~37 KB 追加压到一两次）：

| 状态迁移 | 文本动作 |
|---|---|
| 未越线 → 越线 | 输出一行（占用 / 阈值 / 延后原因）——**本批要的就是这一次** |
| 越线且原因不变 | 文本**逐字节不变** → 不产生新快照 |
| 越线且原因变了（如 deferred 的开放问题被回答） | 输出更新后的一行（再一次追加） |
| 越线 → 未越线（交接完成 / 压缩后回落） | 输出空串；旧快照**无法回收**（只在模型侧被 supersede 措辞覆盖） |

语言跟随文档检测器（`src/shared/language.ts`），zh/en 两套文案。

## 5. 单一真值（本批最容易写错的地方）

显示的数字必须与决策用的数字同源，否则就是本项目反复出现的 misattribution 缺陷类。做法：
把 `auto.ts` 里"解析服务 → 解析路由 → `contextWindow` → `measuredContext` → `resolveThreshold` → 比大小"
这一整段抽成**一个导出函数**（暂名 `resolveHandoffGate(ctx, session, config)`），让
`maybeAutoHandoff` 与 §4 的计算点都调它。不要各写一遍。

## 6. 改动面

| 文件 | 动作 |
|---|---|
| `src/project-handoff/threshold.ts` | 不动公式 |
| `src/project-handoff/gate.ts`（新） | `resolveHandoffGate`：从 `auto.ts` 抽出的共享入口 |
| `src/project-handoff/auto.ts` | 改为调用共享入口（行为不变，属等价重构） |
| `src/project-handoff/display.ts`（新） | 状态机 + per-session 缓存 + zh/en 文案 |
| `src/project-handoff/index.ts` | `inject` 加 `systemPrompt`；注册 context 贡献；`step/start` 分支 |
| `test/*` | 见 §7 |

不需要：新依赖、profile 改动、客户端改动、`lib/client.js` 重建、配置键（因此无需动两个 profile 的 patch）。

## 7. 验证计划

1. **离线量化**（复用 batch I 的口径）：驱动 `lib/`，对一个模拟会话跑"越线 → 再来 5 个 step → 回落"，
   断言**只有跨线那一次**使文本变化（其余 step 文本逐字节相同 ⇒ 不产生新快照）。
2. **单测 pin**：`resolveHandoffGate` 的返回值与 `/handoff status` 收据同源（同一函数、同一 config）；
   状态机四条迁移各一个用例；顶层门不许子会话注入。
3. **mutation 检查**（仓库规矩）：把"只在变化时改文本"改坏，必须有具名用例转红。
4. **门禁**：`pnpm typecheck` / `pnpm build` / `pnpm test`，读实际计数，`lib/` 与临时目录 `tsc` 产物比对。
5. **上线**：注入是宿主行为，**需要一次重启**才在线（本会话只能跑 `--verify-only`）。

## 8. 已知风险与未决

- **un-cross 会再花一次 ~37 KB**，且旧快照留在 history（模型被告知 supersede，但 token 照付）。
  缓解：只在"原因变化"时更新，不清零。
- `includeRuntimeContext` 默认 `true`；若被设为 false，这条线模型看不到（两 profile 目前未改）。
- 文案是给模型读的、要它转述，**合规性无法离线证明**（与 batch I 同类，属"要真实使用才能证明"）。
- 一行字占用几十 token/轮，但它与快照的 ~37 KB/次是两个量级，别混为一谈。
