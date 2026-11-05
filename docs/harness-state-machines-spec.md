# 三 harness 状态机与接入面 spec

同一件事（项目级持久上下文：会话存档 → 记忆整理 → 技能沉淀 → 交接）在三个宿主上各有自己的
**状态机**和**扩展契约**。本文不改任何一边的代码，只把三边的状态推进方式、可用接口面、我们
已经接进去的位置、以及为了抹平差异而写的 shim 登记成一张可检索的表。

- 仓库归属、远端、分支、语言、发布节奏见 [sibling-repos.md](sibling-repos.md)；本文不重复。
- 本文是**登记表 + 契约**，不是三合一设计文档。任何「要不要统一」的结论另开 spec。
- 每一行都有稳定 ID（`DSH-*` / `PI-*` / `CDX-*` / `SH-*`）。新增接入点或新增 shim 必须先在
  这里登记 ID，再改代码；ID 一旦分配不复用。
- 不写行号、不写文件计数、不写版本号：它们会漂。引用一律用符号名，复核命令见 §9。

---

## 1. 三边的进程与生命周期模型

| | dsh | pi | codex |
|---|---|---|---|
| 扩展形态 | cordis 插件，**进程内**，四个入口共享一个 settings 命名空间 | pi extension，**进程内**，**只有一个**扩展（`jiti` `moduleCache: false`） | **命令式子进程**，每个 hook 事件 fork 一次 `python3 hooks/context_hook.py` |
| 事件来源 | `ctx.on(...)` 事件总线 | `pi.on(...)` host 回调 | `hooks/hooks.json` 声明 → stdin JSON 进、stdout JSON 出 |
| 进程内状态 | 可持有（闭包、队列、节流） | 可持有，但**必须收在同一个扩展内**（模块缓存被关闭） | **不可持有**：每次调用都是新进程，状态只能落盘 |
| 并发控制 | 事件串行；写盘走 `session/flush` | 事件串行；单飞靠扩展内状态 | `file_lock()` + 原子写（`atomic_write`） |
| 辅助模型调用 | `ctx.llm.stream()`（`src/shared/model-call.ts`） | `ctx.modelRegistry.complete()` | **无**：0 处网络/模型调用，整理交回宿主 agent 执行（见 `CDX-P3`） |
| 失败姿态 | 事件处理器内 `warn`/退避 | 处理器内 catch，不阻塞主循环 | 进程内顶层 catch：写 `errors.log` 后 `print("{}")`，**绝不阻塞宿主** |

最后一行是 codex 的设计前提，不是实现细节：**hook 失败必须静默**，所以它把每一次调用都当作
首调，所有「记住上次」都变成磁盘上的状态机。

---

## 2. 状态机

### 2.1 dsh（`dsh-project-context`）

```
session 建立
  ├─ agent/created ────────────► 建立待写队列 / 记录 project root
  │
  ├─ session/event(session, event)   ← 唯一的事件流
  │    ├ type = "turn/end" ────► 存档（project-context）
  │    │                         交接决策：阈值 → 闸门 → 执行（project-handoff）
  │    ├ type = "user/message" ─► 续接会话的首次命名（relabel）
  │    └ 其它 type ────────────► 压力 tick，不触发交接
  │
  ├─ agent/status ─────────────► 空闲判定（idle）
  ├─ session/flush ────────────► pending.flush(session)，把缓冲写盘
  └─ session/disposed ─────────► 清理；retireIfPending（先于 isTopLevel 闸门）
```

**注入不在事件里**：`systemPrompt.context` 注册的是一个 provider，prompt 装配时（每次请求准入）
才被求值，所以「模型看见什么」由 `refreshContext` 时刻决定，不由此前的事件决定。这是 dsh 与
另外两边最大的结构性差异：注入是**拉取式**的，不是**推送式**的。

### 2.2 pi（`pi-project-context`）

```
session_start ─────────────► 设 run 开关（--no-project-context）
                             恢复 handoff 暂存的 model / thinking
before_agent_start ────────► 注入（memory / context）；archive 记录
turn_end ──────────────────► archive 追加
agent_settled ─────────────► 固定顺序：archive → consolidation → autolearn → handoff
session_before_compact ────► 按需 {cancel:true} 取消压缩，留给 settle 时的 handoff
session_shutdown ──────────► 落盘 / 收尾
```

`agent_settled` 的**注册顺序即执行顺序**，源码里明写了「archive first, then the passes, then the
valve」；altering 顺序会改变行为。注入在这里是**推送式**（在 `before_agent_start` 里给文本）。

### 2.3 codex（`codex-project-context`）

```
SessionStart  (matcher: startup|resume|clear|compact)
    ├─ migrate()                       ← 只在 SessionStart
    └─ build_injection() → additionalContext (≤ 3000 字符)
UserPromptSubmit  ──► build_injection() → additionalContext (≤ 3000)
PostToolUse       ──► 仅 archive 事件（timeout 60s，`hook_response` 无该分支）
PreCompact  (manual|auto) ──► write_handoff() + systemMessage
PostCompact (manual|auto) ──► systemMessage（指回 SessionStart 注入与 HANDOFF.md）
Stop              ──► should_maintain() → {"decision":"block","reason":"…"}
SessionEnd        ──► 仅 archive 落盘（timeout 3s）
（每个事件都先 archive_event()，当 archiveEnabled）
```

`Stop` 的 block 是**一次性**的：`stop_hook_active` 已为真时直接返回，且
`maintenance-request.json` 记录 `pending|failed|consumed` 防止重复索取。

---

## 3. 接口面登记

### 3.1 dsh

| ID | 接口 | 形态 | 可否持有状态 | 备注 |
|---|---|---|---|---|
| `DSH-E1` | `session/event(session, event)` | 事件 | 可 | 唯一事件流；`turn/end` 是交接的唯一触发点 |
| `DSH-E2` | `session/flush(session)` | 事件 | 可 | 缓冲写盘时机 |
| `DSH-E3` | `session/disposed(session)` | 事件 | 可 | 清理点 |
| `DSH-E4` | `agent/created` / `agent/status` / `agent/disposed` | 事件 | 可 | agent 级生命周期 |
| `DSH-S1` | `ctx.systemPrompt.context({...})` | 注册 provider | 可 | **拉取式**；`interpolate: false` 必须显式给 |
| `DSH-S2` | `ctx.commands.register({...})` | 命令 | 可 | 用户命令面 |
| `DSH-S3` | `ctx.llm.stream(GenerateOptions)` | 服务 | 可 | 辅助模型调用 |
| `DSH-S4` | `ctx.get(name)` | 服务读取 | — | 未声明服务**不抛异常**，返回 `undefined` |
| `DSH-P1` | `ctx.sessionProjections.snapshot(session, keys)` | 投影 | — | 带 keys 时只算选中单元 |
| `DSH-C1` | `tools/pre-execute` | 能力 | 可 | **上游存在；我们四处插件均未注册**（`grep -rn 'pre-execute' src/` 为 0，仅散文提及） |

### 3.2 pi

| ID | 接口 | 形态 | 备注 |
|---|---|---|---|
| `PI-E1` | `pi.on("session_start")` | 事件 | 设 run 开关；恢复 handoff 暂存设置 |
| `PI-E2` | `pi.on("before_agent_start")` | 事件 | **推送式**注入点 |
| `PI-E3` | `pi.on("turn_end")` | 事件 | archive 追加 |
| `PI-E4` | `pi.on("agent_settled")` | 事件 | **顺序敏感**：archive → consolidation → autolearn → handoff |
| `PI-E5` | `pi.on("session_before_compact")` | 事件 | **返回 `{cancel:true}` 取消压缩**，把控制权留到 settle 时的 handoff；`reason === "manual"` 与 `overflow + willRetry` 例外（后者让 pi 自己压缩并重试） |
| `PI-E6` | `pi.on("session_shutdown")` | 事件 | 落盘收尾 |
| `PI-I1` | `pi.registerCommand` / `registerFlag` / `getFlag` | 命令与开关 | `--no-project-context` 关全部功能（仅本次运行） |
| `PI-M1` | `ctx.modelRegistry.complete(...)` | 服务 | 辅助模型调用 |
| `PI-C1` | `pi.newSession()` | 控制 | handoff 用；调用后旧 `pi` 句柄失效（见 `SH-6`） |

### 3.3 codex

| ID | 接口 | 形态 | 约束 |
|---|---|---|---|
| `CDX-H1` | `SessionStart` | hook | matcher `startup\|resume\|clear\|compact`；timeout 10s；`additionalContextLimit` 3000 |
| `CDX-H2` | `UserPromptSubmit` | hook | timeout 10s；`additionalContextLimit` 3000 |
| `CDX-H3` | `PostToolUse` | hook | timeout 60s（唯一长超时） |
| `CDX-H4` | `PreCompact` | hook | matcher `manual\|auto`；timeout 10s |
| `CDX-H5` | `PostCompact` | hook | matcher `manual\|auto`；timeout 10s |
| `CDX-H6` | `Stop` | hook | timeout 10s；block 一次性 |
| `CDX-H7` | `SessionEnd` | hook | timeout 3s（最短，收尾要快） |
| `CDX-P1` | stdout `hookSpecificOutput.additionalContext` | 输出协议 | 注入通道，**受 3000 字符上限** |
| `CDX-P2` | stdout `systemMessage` | 输出协议 | 给用户看的提示 |
| `CDX-P3` | stdout `decision: "block"` + `reason` | 输出协议 | **把整理交回宿主 agent 执行**——codex 侧没有辅助模型调用 |
| `CDX-S1` | 磁盘状态（`.agents/memory/` + `session-logs/`） | 存储 | 子进程无内存，跨事件状态只能落盘 |

---

## 4. 我们的接入点登记

「我们」= 本仓库（dsh 侧四个插件）。另两边的接入点是它们自己仓库内的实现，用于对照，
**本仓库从不修改它们**。

| 接口 | 我们的接入点（符号） | 作用 |
|---|---|---|
| `DSH-E1` | `src/project-context/index.ts` `session/event` → `turn/end` | 会话存档 |
| `DSH-E1` | `src/project-handoff/index.ts` `session/event` → `turn/end` | 交接触发（阈值 → 闸门 → 执行） |
| `DSH-E1` | `src/project-handoff/index.ts` `session/event` → `user/message` → `relabelHandoffChild` | 续接会话首次命名 |
| `DSH-E2` | `src/project-memory/index.ts`、`src/project-autolearn/index.ts` → `pending.flush` | 写盘 |
| `DSH-E3` | `src/project-context/index.ts`、`src/project-handoff/index.ts` | 清理 / `retireIfPending` |
| `DSH-E4` | `src/project-{context,memory,autolearn}/index.ts` | agent 生命周期与 idle 判定 |
| `DSH-S1` | `src/project-memory/index.ts` `registerLiteralContext` | 注入 MEMORY/CONTEXT（`interpolate: false`） |
| `DSH-S1` | `src/project-handoff/index.ts` `ctx.systemPrompt.context({...})` | 注入交接提示 |
| `DSH-S2` | 四个插件各自的 `ctx.commands.register` | `/memory`、`/autolearn`、`/handoff`、`/project-context` |
| `DSH-S3` | `src/shared/model-call.ts` `requestPluginTextWithMeta` | 辅助模型调用（唯一入口） |
| `DSH-S4` | `src/project-handoff/{gate,command,child,guard,watch,runtime,relabel}.ts` | 读 `agents`/`subagents`/`sessions`/`sessionController`/`tokenMeter`/`settings`/`conversation`/`sessionTitle` |
| `DSH-P1` | `src/project-handoff/runtime.ts` `projectionEnvelope` | 读 `contextBreakdown` 作为交接 floor |

---

## 5. shim 登记

shim = 为抹平「宿主没给我们想要的形状」而写的适配层。每条都记**为什么存在**与**拆除条件**，
否则它会悄悄变成永久架构。

| ID | 位置 | 抹平什么 | 拆除条件 |
|---|---|---|---|
| `SH-1` | `src/project-handoff/runtime.ts` 的结构化视图（`SessionProjectionsLike` 等） | dsh 未把投影 registry 的类型导出到我们能 import 的位置 | 上游导出该类型，或我们改为声明注入 |
| `SH-2` | 各处 `ctx.get("name")` | 服务未声明；`ctx.foo` 未注入会抛，`ctx.get` 只返回 `undefined` | 对应服务出现在我们的注入声明里 |
| `SH-3` | `isTopLevel(session)` 闸门 | `SessionHeader.origin` 只有闭字面量 `subagent`，没有「顶层」正向标记 | 上游提供显式顶层判据 |
| `SH-4` | `interpolate: false`（两处注册） | 0.2.x 起 prompt context 默认做变量插值，我们的文档是散文 | 上游默认不插值，或提供只对模板生效的开关 |
| `SH-5` | `registerLiteralContext` 包装 | 把「散文文档」与「模板」在注册处区分开 | 同 `SH-4` |
| `SH-6` | pi `restoreHandoffSessionSettings` + `session-settings.ts` | `newSession()` 之后旧 `pi` 句柄失效，只能在 `session_start` 恢复 model/thinking | pi 提供跨会话的设置移交 |
| `SH-7` | pi 单扩展承载四个 feature | `jiti` `moduleCache: false`：跨文件共享状态不安全 | pi 允许扩展间共享模块实例 |
| `SH-8` | codex `hooks/context_hook.py`（370 B） | 把 hook 入口收敛到 `scripts/contextctl.main_hook` | 无（这是入口 shim，保留） |
| `SH-9` | codex `decision: block` 当作「请宿主跑整理」的通道 | codex 侧没有辅助模型调用能力 | codex 提供 host 侧模型调用 API |

---

## 6. 跨 harness 语义对照

同一个概念在三边不叫同一个名字，也不在同一个时刻发生。这张表是「统一实现」时唯一必须逐行确认的东西。

| 概念 | dsh | pi | codex |
|---|---|---|---|
| 会话开始 | `agent/created` + `session/event` | `PI-E1 session_start` | `CDX-H1 SessionStart`（带 matcher） |
| 模型调用前 | prompt 装配时**拉取** `DSH-S1` | `PI-E2 before_agent_start` 推送 | `CDX-H2 UserPromptSubmit` |
| 一轮结束 | `session/event` `type === "turn/end"` | `PI-E3 turn_end` / `PI-E4 agent_settled` | `CDX-H6 Stop` |
| 空闲/稳定 | `agent/status` | `agent_settled` | `Stop` |
| 压缩前 | 不经过我们的事件面（压缩由 dsh 自己的服务驱动） | `PI-E5 session_before_compact`（取消压缩） | `CDX-H4 PreCompact`（写 HANDOFF.md） |
| 压缩后 | — | — | `CDX-H5 PostCompact` |
| 关闭 | `DSH-E2 session/flush` + `DSH-E3 session/disposed` | `PI-E6 session_shutdown` | `CDX-H7 SessionEnd` |
| 工具调用后 | `DSH-C1`（我们未用） | `toolCall` / `toolResult` | `CDX-H3 PostToolUse` |
| 注入通道 | `ctx.systemPrompt.context`，装配处无显式字符上限（`interpolate` 之外无截断） | `before_agent_start` 返回的 `systemPrompt` 追加文本 | `additionalContext`，**3000 字符上限** |
| 辅助模型 | `ctx.llm.stream` | `ctx.modelRegistry.complete` | **无**（`CDX-P3` 交回宿主） |
| 用户命令面 | `ctx.commands.register` | `pi.registerCommand` | 无（hook 协议没有命令面） |
| 开关粒度 | profile 设置（`cordis.patch.yml`） | `--no-project-context`（单次运行） | 配置键 `codexHookEnabled` / `archiveEnabled` / `handoffEnabled` |

三条**不能想当然**的差异：

1. **注入时机**：dsh 是拉取式（请求准入时求值），pi 与 codex 都是推送式（事件里给文本）。
   所以「改了记忆文件，下一轮一定生效」在 dsh 成立，在 codex 要看 `additionalContext` 的
   3000 字符上限，在 pi 要看 `before_agent_start` 的调用点。
2. **整理由谁执行**：dsh/pi 调辅助模型；codex 让**宿主 agent 自己**去跑维护命令。这决定了
   「整理失败」在三边的归因完全不同（模型失败 / 扩展异常 / 宿主没执行命令）。
3. **跨事件状态**：dsh/pi 有进程内状态；codex 每次都是新进程，状态必须落盘并用文件锁串行化。

---

## 7. 落盘契约

三边产出同构的目录，这是唯一真正共享的契约：

```
.agents/memory/{MEMORY.md, CONTEXT.md, HANDOFF.md}   # 渲染产物
.agents/memory/memory.jsonl                          # 追加式权威源（dsh/pi）
.agents/memory/session-logs/INDEX.md + <session>/     # 会话存档
.agents/skills/<name>/SKILL.md                       # 技能沉淀
```

差异：codex 额外有 `session-logs/<session>/maintenance-request.json` 与 `session-state.json`
（子进程状态机的落盘）、`skill-candidates/`、`errors.log`（带轮转与脱敏）。dsh/pi 的等价状态
在内存里。

---

## 8. 登记协议

1. 新接入点：先在 §3 取一个新 ID（`<HOST>-<类><n>`，类取 `E`事件 / `S`服务 / `P`投影 / `I`接口 /
   `C`控制 / `H`hook / `M`模型），再在 §4 登记符号，最后改代码。
2. 新 shim：必须同时写**拆除条件**；没有拆除条件的 shim 不收。
3. 本文件不记行号、不记计数、不记版本。要写「现在是什么」就写读取它的命令，放进 §9。
4. 改动三边任何一边的接口面时，同一次提交里更新本文件；只改代码不改这里视为未完成。

---

## 9. 复核命令（现读，别信本文的快照）

```sh
# dsh：我们注册了哪些事件 / 读了哪些服务
grep -rnE 'ctx\.on\("[a-z/]+"' src/
grep -rnoE 'ctx\.get\("[a-zA-Z]+"\)' src/
grep -rn 'ctx\.systemPrompt\.context(\|ctx\.commands\.register(' src/

# dsh：确认我们没有注册 tools/pre-execute
grep -rn 'pre-execute' src/ || echo "0 hits"

# pi：事件集合与顺序敏感的 agent_settled 注册顺序
grep -rhoE 'pi\.on\("[a-z_]+"' /mnt/Data/Projects/pi-project-context/extensions/project-context/ | sort | uniq -c
grep -n 'registerArchive\|registerConsolidation\|registerAutolearn\|registerHandoff' \
  /mnt/Data/Projects/pi-project-context/extensions/project-context/index.ts

# codex：七个 hook 事件、matcher 与超时
python3 -c 'import json,sys;d=json.load(open("/mnt/Data/Projects/codex-project-context/hooks/hooks.json"));print({k:[(h.get("matcher"),h["hooks"][0].get("timeout")) for h in v] for k,v in d["hooks"].items()})'

# codex：确认没有模型/网络调用（这是 CDX-P3 的前提）
grep -cE 'requests\.|urllib|httpx|openai' /mnt/Data/Projects/codex-project-context/scripts/contextctl.py
```

---

## 10. 本文不覆盖

- **不判断该不该统一**：三个仓库各自独立发布、各自有自己的测试与发布约定（见
  [sibling-repos.md](sibling-repos.md)）。要不要合并实现是另一份 spec 的事。
- **不枚举上游事件全集**：只登记我们真正接入或明确不接入的面。dsh 的 `tools/pre-execute`
  就是这个例子的反面——能力存在，我们未用，仍然登记，以免下次被当成「已接」。
- **不记录行为细节**：每条规则的行为语义留在 `MEMORY.md` 的 Invariants，本文只记接口形状与
  接入位置。
