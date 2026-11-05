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

### 3.1 是真 shim 的（2 条，都在 dsh 侧）

| ID | 位置 | 抹平什么 | 决定 | 拆除条件 |
|---|---|---|---|---|
| `SH-2` | 各处 `ctx.get("name")`（11 个服务） | 服务未声明；`ctx.foo` 未注入会抛，`ctx.get` 只返回 `undefined` | **留** | 对应服务进入我们的 `inject` 声明 |
| `SH-3` | `isTopLevel(session)` 闸门 | `SessionHeader.origin` 只有闭字面量 `'subagent'`，没有「顶层」正向标记 | **留** | 上游提供显式顶层判据 |

### 3.2 `SH-1` 已拆除（2026-11-05 落地）

`src/project-handoff/runtime.ts` 手写的 `SessionProjectionsLike` 已删除，改为两个包的声明类型。
拆除的**判据**与预检版本不同，原因记在下面，因为它同时纠正了预检的一处错误结论。

**为什么必须是两个包。** 我们读的不只是服务对象，还有它上面的一个键：

```ts
projections.snapshot(session, ["contextBreakdown"]).values.contextBreakdown
```

`sessionProjections` 这个服务由 `@deepseek-ai/dsh-session-projection` 声明（`declare module
'@deepseek-ai/cordis'`），而 `contextBreakdown` **不在**该包自己的 `SessionProjectionMap` 里 ——
它由 `@deepseek-ai/dsh-token-meter` 通过 module augmentation 贡献。缺任一个都会断：只有前者时
`keyof SessionProjectionMap` 不含这个键，只有后者时连服务类型都没有。实测把 token-meter 的
import 去掉，键类型直接塌成 `never`、`contextBreakdown` 报「属性不存在」；加回来 0 错。

**依赖加在哪一栏。** 只加 `devDependencies`（`0.1.7-rc.2`，与我们六包同线），**不加
`peerDependencies`**。理由：这两个服务是**可选**的（`ctx.get` 返回 `undefined` 时
`projectionEnvelope` 退回 `keep + MIN`，回执如实写 `harness envelope unavailable`），而 peer
声明是「宿主必须提供」的契约。加进 peer 会把门禁收紧到 8 条，而 0.1.5 一类老宿主本来能优雅降级，
却会在 peer 判定上失败。类型导入在编译后擦除，运行时不依赖这两个包。

**预检的错结论已纠正。** 预检称 A 路 `pnpm peers check` 输出
`No peer dependency issues found` —— 那是在干净的 `/tmp` 沙盒里跑的，pnpm 自己解析到
cordis 4.0.5 所以看起来干净。**真实锁文件把 cordis 钉在 4.0.2**，而 `dsh-agent@0.1.7-rc.2`
本来就要求 `~4.0.4`：HEAD 状态用同一把 pnpm 跑 `peers check` 同样报 **2 条**未满足
（`cordis`、`schemastery`）。落地后的真实结论是**新增 0 条未满足的 peer 名**，不是「0 条」：
差异只在「wanted by」列表里多了 4 个新包（`dsh-token-meter`、`dsh-compaction`、
`dsh-compaction-image-offload`、`dsh-llm-retry`）——它们并入既有的那条 `cordis ~4.0.4` 缺口。
这 2 条是既存残差，与本批无关，不去顺手修（那要动 cordis 与 schemastery 的 devDeps，是独立批次）。

**判据从「版本相等」改成「签名是运行线的子集」。** 锁定版 `snapshot` 的入参是
`readonly Extract<keyof SessionProjectionMap, string>[]`，运行线 `0.2.2-rc.1` 是
`ProjectionKeySelection`（同一数组形式 ∪ `ReadonlySet`）；我们只用数组形式，故锁定版入参是
运行线的子集，返回的 `ProjectionSnapshot` 与 `ContextBreakdownProjection` 两线逐字相同。
绑定的是**可编译的调用面**，不是版本号。

**已证的（本轮）。** `pnpm typecheck` 0 错；`pnpm test` 477/477；`pnpm build` 通过；
`lib/` 0 个变异标记；新增判别器 `test/projection-typing.test.mjs` 证明「正确键编译通过、差一个字
的键编译失败」，且两侧对照都真的开火：去掉 token-meter import → 键塌成 `never`；把读取降级成
`any` → 判别器失败。变异轮 3 个 mutator 全部被杀（详见证据包）。

**未证的（下一步）。** `src/` 改了必须重启宿主才上线；重启后的验收见证据包。另外残余 shim
`SH-2`（`ctx.get` 读未声明服务）**没有**因为本批消失——这一批只换掉了类型。

证据：[2026-11-05-sh1-removal](../.agents/evidence/2026-11-05-sh1-removal/README.md)。

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
| `SH-1` 能否拆 | 「上游导出该类型即可」 | **能拆**：在锁定线加两个 type-only devDep | 按运行线直接加会得到 7 条 unmet peer（install 仍退出 0）；同线加**新增 0 条**未满足的 peer 名（既存 2 条仍在，见 §3.2），且 0.1.7 的签名是运行线的子集、返回形状逐字相同 |
| `SH-1` 是否已拆 | **能拆**（预检已通，未落地） | **已拆除**：结构化视图删除，改两个 type-only devDep | `pnpm typecheck` 0 错、477/477、判别器两侧对照开火、3 个变异全杀 |
| `SH-4` / `SH-5` | 记为 shim | **撤销 shim 身份** | `interpolate` 是文档化选项，默认 `true` |
| `SH-6` ~ `SH-9` | 与本仓库 shim 混在一张表 | **移到 pi / codex 各自文档** | 不是本仓库的债 |
| `tools/pre-execute` | 「上游存在但我们未接」 | 同上，**并明确列为「决定不接」** | `src/` 0 命中 |
| 压缩前钩子 | 未明确 | **明确：dsh 没有这个钩子** | 只有 `compaction/summary-error` |

---

## 5. 结论

- **接的面是 9 行决定 / 11 个接口**（6 个事件 + 注入 + 命令 + 辅助模型 + 服务读取 + 投影；
  `agent/*` 那行含 3 个事件），另外 2 类明确「不接」（`tools/pre-execute`、`compaction/*`）。
- **真 shim 只剩 2 条**（`SH-2`、`SH-3`），全在 dsh 侧；`SH-1` 已于 2026-11-05 拆除，条件不再「不成立」。
- 上一轮 9 条 shim 里有 2 条分类错误、4 条归属错误；修正后这个数字才能用来判断技术债。
- 数字要现读，不抄：`grep -rc SessionProjectionsLike src/` 应为 `0`，`pnpm peers check` 的未满足条数要拿 HEAD 状态跑一遍再比，不要直接引用本节的数字。
