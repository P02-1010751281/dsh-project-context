# 接入点与 shim 的决定（dsh 侧）

本文回答一个问题：**看过三边的状态机与接口面之后，我们决定接哪些、不接哪些，哪些 shim 留、
哪些其实不是 shim。**

事实来源：[dsh.md](dsh.md)、[pi.md](pi.md)、[codex.md](codex.md)。本文只写**决定**，不重复事实。

---

## 1. 判定规则

一条接口进入我们的代码之前，先判它属于哪一类。分类决定它后面怎么维护：

| 类别 | 判据 | 例 |
|---|---|---|
| **接** | 我们的 feature 需要它，且宿主没有更窄的替代 | `session/event` |
| **不接** | 宿主提供、但我们没有需求 | `tools/pre-execute` |
| **不是 shim** | 用的是文档化选项/正常 API，只是形状不是我们最想要的 | `interpolate: false` |
| **是 shim** | 宿主**没有**给我们需要的形状，只能自己补一层 | `isTopLevel` |

第三类和第四类的区别是本文的重点：把「正常用 API」记成 shim，会让技术债表虚高，也会掩盖
真正的 shim。

---

## 2. 接口决定（dsh，63 个事件里我们注册 6 个）

| 接口 | 决定 | 理由 |
|---|---|---|
| `session/event` | **接** | 唯一事件流。`turn/end` 是交接唯一触发点，`user/message` 供续接会话命名 |
| `session/flush` | **接** | 缓冲写盘时机；没有它就要在每个事件里同步落盘 |
| `session/disposed` | **接** | 清理点 |
| `agent/created` / `agent/status` / `agent/disposed` | **接** | agent 级生命周期与 idle 判定 |
| `systemPrompt.context` | **接** | 注入的唯一通道（拉取式），装配处**无字符上限** |
| `commands.register` | **接** | 用户命令面，四个插件各一组 |
| `llm.stream` | **接**（经 `requestPluginTextWithMeta` 收口） | 辅助模型调用 |
| `ctx.get` | **接** | 未声明服务返回 `undefined`，不抛——这是可选 feature 的承重行为 |
| `sessionProjections.snapshot` | **接** | `contextBreakdown` 是 floor 的唯一来源，见 [dsh.md](dsh.md) §3.3 |
| `tools/pre-execute` | **不接** | 能力存在（`PreToolDecision` = `allow\|deny\|cancel\|ask`），但我们四个插件都没有「否决一次工具调用」的需求。**登记为不接，防止下次误认为已接** |
| `compaction/*` | **不接（无可用钩子）** | dsh 只有 `compaction/summary-error`，**没有压缩前钩子**。压缩由 dsh 自己的服务驱动，不经过我们的事件面——pi 的 `session_before_compact`、codex 的 `PreCompact` 在 dsh 没有对应物 |
| `workflow/*`、`goal/*`、`schedule/*`、`fs/*`、`cordis/*`、`hmr/*` 等 | **不接** | 与项目级持久上下文的四件事无关；接进来只增加随上游漂移的面 |
| `llm/stream` / `agent/request` / `agent/pre-step` | **不接** | 我们要的是「调用一次辅助模型」，不是「拦截每一次请求」 |

### 决定背后的两条原则

1. **接窄不接宽**：63 个事件里只注册 6 个，是因为每多接一个就多一个随上游漂移的兼容面，
   而我们的四个 feature 没有一个需要更宽的面。
2. **「上游存在」不等于「我们已接」**：`tools/pre-execute` 就是例子——能力真实、文档真实，
   但我们 0 处注册。不登记这一类，下次审计就会凭「文档里有」误判成已接。

---

## 3. shim 决定

### 3.1 是真 shim 的（3 条，都在 dsh 侧）

| ID | 位置 | 抹平什么 | 决定 | 拆除条件 |
|---|---|---|---|---|
| `SH-1` | `src/project-handoff/runtime.ts` 的结构化视图（`SessionProjectionsLike` 等） | 投影服务的类型在我们可依赖的范围内不可直接使用 | **留**（本轮确认不能拆，见 §3.2） | 见 §3.2 的两个前提同时成立 |
| `SH-2` | 各处 `ctx.get("name")`（11 个服务） | 服务未声明；`ctx.foo` 未注入会抛，`ctx.get` 只返回 `undefined` | **留** | 对应服务进入我们的 `inject` 声明 |
| `SH-3` | `isTopLevel(session)` 闸门 | `SessionHeader.origin` 只有闭字面量 `'subagent'`，没有「顶层」正向标记 | **留** | 上游提供显式顶层判据 |

### 3.2 `SH-1` 本轮的新证据（推翻「上游导出即可拆」）

上一轮登记的拆除条件是「上游导出该类型，或我们改为声明注入」。本轮核实后，**两条都不通**：

1. **我们没有那个包**。`@deepseek-ai/dsh-session-projection` 不在 `package.json` 的
   `dependencies` / `peerDependencies` 里，顶层 `node_modules/@deepseek-ai/` 也没有它。
2. **它在 `.pnpm` 里，但只是别人的 peer**。它作为 `dsh-agent` 的 peer 被装进了
   `node_modules/.pnpm/`（`0.1.7-rc.2`），我们**不能**从自己的源码 `import` 它——pnpm 的
   隔离布局不允许。
3. **`contextBreakdown` 这个键的类型增强来自 `@deepseek-ai/dsh-token-meter`**，而后者同样不在
   我们的依赖里。就算拿到 `SessionProjectionMap`，它也是**空的合并可扩展接口**，不含我们这个键。
4. **版本还不一致**：`.pnpm` 里的 `0.1.7-rc.2` 签名是
   `snapshot(session, keys?: readonly Extract<keyof SessionProjectionMap, string>[])`，
   运行中的 `0.2.2-rc.1` 是 `snapshot(session, keys?: ProjectionKeySelection)`
   （`ProjectionKeySelection` 还接受 `ReadonlySet`）。直接绑死任何一个版本都会绑错。

所以拆除条件收紧为：**同时**（a）把 `dsh-session-projection` 与 `dsh-token-meter` 都列为依赖，
（b）把类型钉在运行中的那条版本线上，且（c）`SessionProjectionMap` 确实含 `contextBreakdown`。
在此之前，结构化视图是承重的，不是偷懒。

### 3.3 不是 shim 的（上一轮误记，本轮改判）

| 原 ID | 真相 | 决定 |
|---|---|---|
| `SH-4` | `interpolate: false` 是**文档化选项**，默认 `true`，`false` 保留字面文本 | **撤销 shim 身份**，降为正常 API 用法 |
| `SH-5` | `registerLiteralContext` 只是我们自己的包装，把「散文文档」与「模板」在注册处区分开 | **撤销 shim 身份**，它是本地辅助函数，不是对宿主的迁就 |

撤销的理由不是它们不重要，而是分类错了：**用文档化选项不是技术债**。留在 shim 表里会让
「9 条 shim」这个数字虚高，也会掩盖 `SH-1`/`SH-3` 这两条真正被宿主形状逼出来的。

### 3.4 不是我们的 shim（移到各自文档）

`pi` 与 `codex` 仓自己写的适配层不属于本仓库的债。已移到
[pi.md](pi.md) §5（`SH-pi-1` / `SH-pi-2`）与 [codex.md](codex.md) §5（`SH-cdx-1`）。

---

## 4. 本轮改判汇总

| 项 | 上一轮 | 本轮 | 依据 |
|---|---|---|---|
| `SH-1` 能否拆 | 「上游导出该类型即可」 | **不能拆**，条件收紧为三项同时成立 | 包不在我们的依赖里；`contextBreakdown` 的类型来自 `dsh-token-meter`；`.pnpm` 与运行中的版本签名不同 |
| `SH-4` / `SH-5` | 记为 shim | **撤销 shim 身份** | `interpolate` 是文档化选项，默认 `true` |
| `SH-6` ~ `SH-9` | 与本仓库 shim 混在一张表 | **移到 pi / codex 各自文档** | 不是本仓库的债 |
| `tools/pre-execute` | 「上游存在但我们未接」 | 同上，**并明确列为「决定不接」** | `src/` 0 命中 |
| 压缩前钩子 | 未明确 | **明确：dsh 没有这个钩子** | 只有 `compaction/summary-error` |

---

## 5. 结论

- **接的面是 9 条**（6 个事件 + 注入 + 命令 + 辅助模型 + 服务读取 + 投影），
  另外 2 条明确「不接」（`tools/pre-execute`、`compaction/*`）。
- **真 shim 只有 3 条**，全在 dsh 侧，且 3 条的拆除条件本轮都**不成立**。
- 上一轮 9 条 shim 里有 2 条分类错误、4 条归属错误；修正后这个数字才能用来判断技术债。
