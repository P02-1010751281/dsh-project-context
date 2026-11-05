# dsh（`dsh-project-context`）的状态机与接口面

只读勘查，不改上游。**每个数字都要现读**，复核命令在
[README.md](README.md) §4；本文只记录形状与约束。

- 我们接入的位置与 shim 决定见 [integration.md](integration.md)。
- 三边语义对照见 [README.md](README.md) §2。

---

## 1. 生命周期模型

| | |
|---|---|
| 扩展形态 | cordis 插件，**进程内**；四个入口共享一个 settings 命名空间 |
| 事件来源 | `ctx.on(...)` 事件总线（不是回调表，也不 fork 子进程） |
| 进程内状态 | 可持有（闭包、按会话登记的待写队列、节流） |
| 注入 | `ctx.systemPrompt.context({...})` 注册 provider，**拉取式**：prompt 装配时求值 |
| 辅助模型 | `ctx.llm.stream()`（本仓库经 `src/shared/model-call.ts` 收口） |
| 失败姿态 | 事件处理器内 `warn` / 退避，不阻塞主流程 |

**拉取式注入是 dsh 与另两边的根本差异**：注入不在事件里发生，而是在每次请求准入时由
`refreshContext` 重新求值。所以「改了记忆文件，下一轮一定生效」在 dsh 成立。

---

## 2. 状态机

```
session 建立
  ├─ agent/created ────────────► 建立待写队列 / 预热 project root 缓存
  │
  ├─ session/event(session, event)   ← 唯一的事件流（14 种类型，见 §3.2）
  │    ├ type = "turn/end" ────► 存档（project-context）
  │    │                         交接决策：阈值 → 闸门 → 执行（project-handoff）
  │    ├ type = "user/message" ─► 续接会话的首次命名（relabel）
  │    └ 其它 type ────────────► 压力 tick，不触发交接
  │
  ├─ agent/status ─────────────► 空闲判定（idle）
  ├─ session/flush ────────────► pending.flush(session)，把缓冲写盘
  └─ session/disposed ─────────► 清理；retireIfPending（先于 isTopLevel 闸门）
```

**没有「压缩前」钩子**。dsh 的 `compaction/*` 只有 `compaction/summary-error`，压缩本身由
dsh 自己的服务驱动，不经过我们的事件面。所以 pi 的 `session_before_compact`、codex 的
`PreCompact` 在 dsh **没有对应物**——这不是遗漏，是结构差异（见 [README.md](README.md) §2）。

---

## 3. 接口面

### 3.1 事件（`ctx.on`，共 63 个）

按域分组，**★ = 我们注册的（6 个）**：

| 域 | 事件 |
|---|---|
| session | ★`session/event`、`session/created`、★`session/disposed`、★`session/flush` |
| agent | ★`agent/created`、★`agent/disposed`、★`agent/status`、`agent/assistant-stream`、`agent/error`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping` |
| tools | `tools/change`、`tools/execute`、`tools/post-execute`、`tools/pre-execute`、`tools/ptc-dispatch-log`、`tools/result` |
| llm | `llm/adapters-updated`、`llm/models-updated`、`llm/stream` |
| compaction | `compaction/summary-error` |
| subagent | `subagent/end`、`subagent/provider-added`、`subagent/provider-removed`、`subagent/start` |
| workflow | `workflow/agent-end`、`workflow/agent-start`、`workflow/end`、`workflow/log`、`workflow/phase`、`workflow/start` |
| goal / schedule | `goal/activation-changed`、`goal/changed`、`schedule/changed`、`schedule/resolve-agent` |
| workspace | `workspace/session-activity`、`workspace/session-stop` |
| settings / commands / skills | `settings/document-updated`、`commands/change`、`skills/change` |
| fs | `fs/delete-intent`、`fs/edit-intent`、`fs/observed`、`fs/write-intent` |
| approval / auth | `approval/request`、`authorization/settled` |
| cordis / hmr | `cordis/dynamic-package`、`cordis/dynamic-retract`、`cordis/inspect-query`、`cordis/inspect-query-resolved`、`cordis/request-run`、`cordis/request-run-resolved`、`hmr/change`、`hmr/reload` |
| 其余 | `connection/request`、`credentials/record-updated`、`credentials/reference-updated`、`domain/changed`、`feedback/committed`、`forge/providers-changed`、`webserver/index-inject` |

**未接入但容易误认的一条**：`tools/pre-execute` 上游存在，`PreToolDecision` 是
`allow | deny | cancel | ask`，也就是说插件**有能力否决一次工具调用**；我们四个插件都没有注册它
（`src/` 0 命中，只有散文提及）。登记在这里正是为了防止下次被当成「已接」。

### 3.2 `session/event` 的 14 种类型

`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`developer/message`、
`system/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、
`request/header`、`request/context`、`session/end-seed`。

我们只用 `turn/end`（存档 + 交接）与 `user/message`（续接会话命名）。

### 3.3 服务与投影

`ctx.get(name)` 读未声明服务：**返回 `undefined`，从不抛异常**。`ctx.foo` 是调用方作用域绑定，
未注入会抛。这个差别是 SH-2 存在的全部理由。

| 服务 | 在**我们已依赖的包**里声明了吗 |
|---|---|
| `agents` | 是（`dsh-agent`） |
| `sessions` | 是（`dsh-session`） |
| `settings` | 是（`dsh-settings`） |
| 其余 8 个（`subagents`、`sessionController`、`tokenMeter`、`conversation`、`sessionTitle`、`sessionProjections`、`permissionPresets`、`workspaceRegistry`） | 否——来自我们没有依赖的包 |

投影：`sessionProjections.snapshot(session, keys?)` 返回 `{asOfSeq, values}`，同步，
只计算选中的单元。它的类型在 `@deepseek-ai/dsh-session-projection` 里**有导出**，但那个包
不在我们的依赖里——见 [integration.md](integration.md) 的 `SH-1`。

### 3.4 注入与命令

| 接口 | 形状 | 约束 |
|---|---|---|
| `ctx.systemPrompt.context({...})` | 注册 provider，装配时求值 | **无字符上限**：装配处除了变量插值没有截断 |
| `interpolate` | 段落级选项，**默认 `true`** | `false` 保留字面文本；这是文档化的选项，不是绕过 |
| `ctx.commands.register({...})` | 用户命令面 | 无 |

---

## 4. 我们用到哪些

| 接口 | 我们的接入点（符号） | 作用 |
|---|---|---|
| `session/event` | `src/project-context/index.ts` → `turn/end` | 会话存档 |
| `session/event` | `src/project-handoff/index.ts` → `turn/end` | 交接触发（阈值 → 闸门 → 执行） |
| `session/event` | `src/project-handoff/index.ts` → `user/message` → `relabelHandoffChild` | 续接会话首次命名 |
| `session/flush` | `src/project-memory/index.ts`、`src/project-autolearn/index.ts` → `pending.flush` | 写盘 |
| `session/disposed` | `src/project-context/index.ts`、`src/project-handoff/index.ts` | 清理 / `retireIfPending` |
| `agent/created` / `agent/status` / `agent/disposed` | `src/project-{context,memory,autolearn}/index.ts` | agent 生命周期与 idle 判定 |
| `systemPrompt.context` | `src/project-memory/index.ts` `registerLiteralContext` | 注入 MEMORY/CONTEXT（`interpolate: false`） |
| `systemPrompt.context` | `src/project-handoff/index.ts` | 注入交接提示 |
| `commands.register` | 四个插件各自 | `/memory`、`/autolearn`、`/handoff`、`/project-context` |
| `llm.stream` | `src/shared/model-call.ts` `requestPluginTextWithMeta` | 辅助模型调用（唯一入口） |
| `ctx.get` | `src/project-handoff/*.ts`（11 个服务） | 见 §3.3 |
| `sessionProjections.snapshot` | `src/project-handoff/runtime.ts` `projectionEnvelope` | 读 `contextBreakdown` 作为交接 floor |
