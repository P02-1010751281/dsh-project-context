# codex（`codex-project-context`）的状态机与接口面

只读勘查，**本仓库从不修改它**。事实来源是它的 `hooks/hooks.json` 与
`scripts/contextctl.py`，以及 codex 二进制自身承认的协议字段（`grep -ac` 在二进制里能查到
`hook_event_name` / `additionalContext` / `stop_hook_active` / `additionalContextLimit`）。
复核命令在 [README.md](README.md) §4。

- 跨边对照见 [README.md](README.md) §2；我们的 shim 决定见 [integration.md](integration.md)。

---

## 1. 生命周期模型

| | |
|---|---|
| 扩展形态 | **命令式子进程**：每个 hook 事件 fork 一次 `python3 hooks/context_hook.py` |
| 事件来源 | `hooks/hooks.json` 声明 → stdin JSON 进、stdout JSON 出 |
| 进程内状态 | **不可持有**：每次调用都是新进程，状态只能落盘 |
| 注入 | `hookSpecificOutput.additionalContext`，**受契约上限约束** |
| 辅助模型 | **无**：0 处网络/模型调用 |
| 失败姿态 | 顶层 catch → 写 `errors.log` → `print("{}")`，**绝不阻塞宿主** |

最后一行是设计前提，不是实现细节：**hook 失败必须静默**，所以它把每一次调用都当作首调，
所有「记住上次」都变成磁盘上的状态机。

---

## 2. 状态机

```
SessionStart  (matcher: startup|resume|clear|compact)
    ├─ migrate()                       ← 只在 SessionStart
    └─ build_injection() → additionalContext
UserPromptSubmit  ──► build_injection() → additionalContext
PostToolUse       ──► 仅 archive 事件（timeout 60s；hook_response 无该分支）
PreCompact  (manual|auto) ──► write_handoff() + systemMessage
PostCompact (manual|auto) ──► systemMessage（指回 SessionStart 注入与 HANDOFF.md）
Stop              ──► should_maintain() → {"decision":"block","reason":"…"}
SessionEnd        ──► 仅 archive 落盘（timeout 3s）
（每个事件都先 archive_event()，当 archiveEnabled）
```

`Stop` 的 block 是**一次性**的：`stop_hook_active` 已为真时直接返回，且
`maintenance-request.json` 记录 `pending|failed|consumed` 防止重复索取。

---

## 3. 接口面

### 3.1 七个 hook（全部由这个插件自己声明）

| hook | matcher | timeout | 输出 |
|---|---|---|---|
| `SessionStart` | `startup\|resume\|clear\|compact` | 10s | `additionalContext`（`additionalContextLimit: 3000`） |
| `UserPromptSubmit` | — | 10s | 同上 |
| `PostToolUse` | — | 60s（唯一长超时） | 无专属分支，仅 archive |
| `PreCompact` | `manual\|auto` | 10s | `systemMessage` |
| `PostCompact` | `manual\|auto` | 10s | `systemMessage` |
| `Stop` | — | 10s | **`decision: "block"` + `reason`** |
| `SessionEnd` | — | 3s（最短，收尾要快） | 无 |

### 3.2 输出协议（三种，语义完全不同）

| 通道 | 形状 | 作用 |
|---|---|---|
| `hookSpecificOutput.additionalContext` | `{hookEventName, additionalContext}` | 注入；**受 3000 字符契约上限** |
| `systemMessage` | 字符串 | 给用户看的提示，不进 prompt |
| `decision: "block"` + `reason` | `{decision, reason}` | **把整理交回宿主 agent 执行**——codex 侧没有辅助模型调用 |

第三种是整个 spec 里最容易被误读的一条：`block` 不是"阻止"，是"请宿主替我做这件事"。

### 3.3 落盘状态（子进程没有内存，跨事件状态全在这里）

```
session-logs/<session>/maintenance-request.json   # pending | failed | consumed
session-logs/<session>/session-state.json         # offset 等
errors.log                                        # 带轮转与脱敏
```

配置键：`codexHookEnabled`、`archiveEnabled`、`handoffEnabled`、`autoConsolidate`、
`maintenanceMode`、`consolidateTurns`、`maxInjectedChars`。

---

## 4. 三条结构性约束

1. **零模型调用**：`grep -cE 'requests\.|urllib|httpx|openai'` 为 0。整理只能交回宿主 agent。
2. **3000 字符注入上限**：dsh 的 prompt provider 没有这个上限，pi 也没有显式上限；这是 codex 独有的硬约束。
3. **每次调用即首调**：没有进程内状态，所有判断都必须先读磁盘（因此有 `file_lock()` + `atomic_write`）。

---

## 5. codex 侧的 shim（不在本仓库，仅登记以说明差异来源）

| ID | 位置 | 抹平什么 | 拆除条件 |
|---|---|---|---|
| `SH-cdx-1` | `hooks/context_hook.py`（370 B） | 把 hook 入口收敛到 `scripts/contextctl.main_hook` | 无（入口 shim，保留） |
| `SH-cdx-2` | `Stop` 的 `decision: block` | codex 侧没有辅助模型调用能力，只能请宿主 agent 代跑整理 | codex 提供 host 侧模型调用 API |
