# pi（`pi-project-context`）的状态机与接口面

只读勘查，**本仓库从不修改它**。事实来源是 pi 自己的 API 包
（`@earendil-works/pi-coding-agent` 的 `dist/core/extensions/types.d.ts`），不是我们的调用点。
复核命令在 [README.md](README.md) §4。

- 我们（dsh 侧）的接入点与 shim 决定见 [integration.md](integration.md)。
- pi 侧的差异为什么无法平移到 dsh，见 [dsh.md](dsh.md) §2 与 [README.md](README.md) §2。

---

## 1. 生命周期模型

| | |
|---|---|
| 扩展形态 | pi extension，**进程内**；每个扩展在**自己的模块注册表**里（`jiti`、`moduleCache: false`） |
| 事件来源 | `pi.on(...)` host 回调（41 个事件） |
| 进程内状态 | 可持有，但**必须收在同一个扩展内**——跨文件共享模块实例不安全 |
| 注入 | `before_agent_start` 返回 `systemPrompt`，**推送式**；另有 `context` / `context_with_system` 两条消息级通道 |
| 辅助模型 | `ctx.modelRegistry.complete(...)` |
| 失败姿态 | 处理器内 catch，不阻塞主循环 |

---

## 2. 状态机

```
session_start ─────────────► 设 run 开关（--no-project-context）
                             恢复 handoff 暂存的 model / thinking
before_agent_start ────────► 注入（memory / context）；archive 记录
turn_end ──────────────────► archive 追加
agent_settled ─────────────► 固定顺序：archive → consolidation → autolearn → handoff
session_before_compact ────► 按需返回 {cancel:true} 取消压缩，留给 settle 时的 handoff
session_shutdown ──────────► 落盘 / 收尾
```

`agent_settled` 的**注册顺序即执行顺序**，源码里明写「archive first, then the passes, then the
valve」。`session_before_compact` 有两条例外不取消：`reason === "manual"`，以及
`reason === "overflow" && willRetry`（后者是 pi 唯一能回到被打断那一轮的路径）。

---

## 3. 接口面

### 3.1 事件（41 个）

| 域 | 事件 |
|---|---|
| session | ★`session_start`、`session_info_changed`、`session_before_switch`、`session_before_fork`、★`session_before_compact`、`session_compact`、`session_compact_failed`、★`session_shutdown`、`session_before_tree`、`session_tree` |
| agent | ★`before_agent_start`、`agent_start`、`agent_end`、`agent_before_settle`、★`agent_settled` |
| turn / message | ★`turn_end`、`turn_start`、`message_start`、`message_update`、`message_end` |
| 工具 | `tool_call`、`tool_result`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`、`user_bash` |
| 上下文 | `context`、`context_with_system`、`before_provider_request`、`before_provider_headers`、`after_provider_response`、`provider_stream_event` |
| 其它 | `project_trust`、`resources_discover`、`mcp_servers_change`、`cache_warming_decision`、`ui_prompt_start`、`ui_prompt_end`、`model_select`、`thinking_level_select`、`input` |

★ = 我们的扩展注册的（6 个）。

**两条我们没用但值得记的通道**：`context` / `context_with_system` 是**消息级**注入
（`messages` 数组，后者含 system 消息），与 `before_agent_start` 的 systemPrompt 替换是两条
不同的路。它们的存在说明 pi 的注入面比 dsh 宽——dsh 只有 prompt 段落 provider 一条。

### 3.2 方法（33 个）

| 类别 | 方法 |
|---|---|
| 事件 | `on`（41 个重载）、`events` |
| 命令与开关 | `registerCommand`、`registerShortcut`、`registerFlag`、`getFlag`、`getCommands` |
| 注入扩展点 | `registerMarkdownTransformer`、`registerToolRenderer`、`registerEntryRenderer`、`registerMessageRenderer`、`registerTool`、`registerProvider`、`registerVirtualModel`、`unregisterProvider`、`unregisterVirtualModel`、`registerMcpServer`、`unregisterMcpServer`、`getMcpServers` |
| 会话 | `setSessionName`、`getSessionName`、`setLabel`、`appendEntry`、`exec` |
| 消息 | `sendMessage`、`sendUserMessage` |
| 工具与设置 | `getActiveTools`、`getAllTools`、`setActiveTools`、`getSettings`、`setModel`、`getThinkingLevel`、`setThinkingLevel` |

`newSession()` **不在** `ExtensionAPI` 上，而在 `ExtensionCommandContext` 上——所以 handoff 必须以
命令上下文调用它。这是 pi 侧的 `SH-pi-1`（见 §5）。

### 3.3 返回值契约（决定行为的三个）

```ts
BeforeAgentStartEventResult  = { message?, systemPrompt? }   // systemPrompt 替换整段系统提示
SessionBeforeCompactResult   = { cancel?, compaction? }      // cancel 即"别压缩"
BoundaryResult               = （turn_end / agent_before_settle 的边界结果）
```

`tool_call` 的 `ToolCallEventResult` 用 `{ block, reason }` 拦一次工具调用——dsh 里对应的是
`tools/pre-execute` 的 `deny`，两边语义同构但形状不同。

### 3.4 配置与开关

| | |
|---|---|
| 运行级开关 | `--no-project-context`（`registerFlag`），只关**本次运行** |
| 四个 feature 开关 | `memory` / `autolearn` / `handoff` / `archive`，见 `FEATURE_FIELDS` |
| 配置文件 | `configFile(...)` + `DEFAULT_CONFIG`，项目级 |

---

## 4. 我们（pi 侧）用到哪些

| 接口 | 接入点 | 作用 |
|---|---|---|
| `session_start` | `index.ts`（设 run 开关）、`archive/archive.ts`、`autolearn/pass.ts`、`handoff/run.ts`、`memory/report.ts` | 五处注册，各自恢复自己的状态 |
| `before_agent_start` | `archive/archive.ts`、`memory/report.ts` | 注入 MEMORY/CONTEXT |
| `turn_end` | `archive/archive.ts` | 追加会话存档 |
| `agent_settled` | 四个 feature 各一处 | 顺序敏感的主循环 |
| `session_before_compact` | `handoff/run.ts` | 按需 `{cancel:true}` |
| `session_shutdown` | `archive/archive.ts`、`memory/report.ts` | 收尾 |
| `modelRegistry.complete` | `shared/llm.ts` | 辅助模型调用 |
| `newSession` | `handoff/run.ts`（命令上下文） | 交接 |

---

## 5. pi 侧的 shim（不在本仓库，仅登记以说明差异来源）

这些是 pi 仓自己写的适配层。**本仓库不维护它们**，登记只为说明「三边差异里哪部分是被宿主逼出来的」。

| ID | 位置 | 抹平什么 | 拆除条件 |
|---|---|---|---|
| `SH-pi-1` | `handoff/session-settings.ts` | `newSession()` 没有 model/thinking 选项，旧 `pi` 句柄在切换后失效，只能在 `session_start` 恢复 | pi 提供跨会话的设置移交 |
| `SH-pi-2` | 单扩展承载四个 feature | `jiti` `moduleCache: false`，跨文件共享模块实例不安全 | pi 允许扩展间共享模块实例 |
