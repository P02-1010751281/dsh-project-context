# SH-10 运行期探针：交接时刻的 agent 与压缩引擎在真实宿主上是什么样

- 日期：2026-11-24。
- 取证对象：运行中的 dsh desktop 宿主，pid 5876，启动 `2026-11-24 14:31:40 +0800`，
  store `wr0q0vjd3hxvq08z7ns67dsryywcmz1y-dsh-desktop-0.2.2-rc.5`，Inspector `127.0.0.1:9230`。
- 与上一步的分工：`../2026-11-21-sh10-compactnow-handle/finding.md` 是**源码级**结论（§①–§⑤）加
  **地板声明**补证（§⑥）；本文补它明确留空的第二项残余——**运行期实测**。
- 探针**只读**：`compactNow` 只被取 `typeof`，从未调用，所以全程没有压缩、没有模型调用。

## ① 结论

1. **能从根上下文拿到 `agentPresets` 与 `agents`，拿不到 `compaction`** —— 与源码结论一致：
   `root.get("compaction")` 是 `undefined`，`root.get("agentPresets").serviceFor(agent, "compaction")`
   返回一个真引擎（`typeof engine.compactNow === "function"`）。接线路径唯一且可行。
2. **`agent.status` 在真实宿主上的取值是可读的**，本次样本里那个 agent 处于 `running` —— 与 §② A 的
   「`turn/end` 观察者运行时一定是 running」一致；`whenIdle()` 与 `runMaintenance()` 都存在。
3. **探针方法本身是本轮最大的可复用产出**：Inspector 的 `Runtime.evaluate` 落在宿主主 realm，
   但那里**没有** cordis 根（139 个全局里既无 `loader` 也无 `ctx`，符号键里只有
   `dsh-web.mounted-plugins` 等空表）。真正可达的入口是
   `globalThis[Symbol.for("dsh.inspector.realm-object-registries")]` 里 Inspector 自己留存的对象：
   其中 `keys` 含 `root`/`registry`/`events` 的那个就是 cordis 根上下文。

## ② 证据

### A. Inspector 执行域里没有 cordis 根（先排除的错误路径）

`Runtime.evaluate` 落在 `process.argv` 为
`/nix/store/6wq2z8y8vbw4acm4dnwx13c96sbpvyly-nodejs-official-24.20.0/bin/node`
`/home/user/.dsh/desktop/nix-project/…/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js` 的主 realm，
即 dsh-desktop-host 进程本身（不是 worker、不是 preset 隔离子上下文）。该 realm 的 `globalThis`：

- 自有属性 139 个，逐一 `Reflect.ownKeys` 后无 `loader` / `root` / `ctx` / `context` / `cordis` 任何一个。
- 符号键 12 个，与 dsh 相关的是
  `Symbol(dsh-cost-meter.billion-context.{v1,auto.v1,peers.v1})`、
  `Symbol(dsh-web.mounted-plugins)`（空对象）、`Symbol(dsh.inspector.realm-object-registries)`。

所以「用 `Runtime.evaluate` 找全局 loader」这条路是**死的**；`dsh-web.mounted-plugins` 不是服务表。

### B. 真正的入口：Inspector 的 realm-object 注册表

`Symbol(dsh.inspector.realm-object-registries)` 是一个 `Map`（本次 `size = 1`），值是
`RealmObjectRegistry` 实例，其 `retained` 是 `Map<handle, object>`，存放 Inspector 最近一次语义快照
留存下来的活对象。遍历它即可拿到 Fiber 与根上下文（`packages/experimental/inspector/src/shared/cordis/object-registry.ts:11`
定义了该 symbol，`:24` 是 `identify` 用的同一入口）。

本次留存的第一个对象即根上下文，其自有键为
`root`、`baseUrl`、`fiber`、`reflect`、`registry`、`events`、`logger`、`Symbol(cordis.isolate)`、`Symbol(cordis.intercept)`。
判定读法：`obj.root && obj.registry && obj.events` 同时成立。

### C. 宿主平面与 preset 域的实际可见性（本次读数）

| 服务名 | `root.get(name)` | 说明 |
|---|---|---|
| `compaction` | `undefined` | 宿主平面被 `dsh-web-app` patch 关掉，与 §⑥ 表格一致 |
| `commandCompact` | `undefined` | 同上 |
| `tokenMeter` | object | 留在宿主平面（meter 不走 preset） |
| `sessions` | object | 宿主平面 |
| `agents` | object | 宿主平面，`Reflect.ownKeys` 含 `store`/`factory`/`initiators` 等 |
| `agentPresets` | object | 宿主平面，是可调用的注册表 |

`root.get("compaction") === undefined`，而
`agentPresets.serviceFor(agent, "compaction")` 对同一 agent 返回
`engine(function)`（即 `typeof engine.compactNow === "function"`）。

**这同时否掉了两条天真的接线**：直接 `ctx.get("compaction")`（永远 undefined，静默不压缩）与
`ctx.compaction`（根域没有绑定）。唯一可行入口仍是 `serviceFor`。

### D. 真实 agent 的可观测状态

`root.get("agents").list()` 本次返回 1 个 agent（即本会话），逐字段：

```
status = running
whenIdle       = function
runMaintenance = function
ctx            = present
serviceFor(agent, "compaction") = engine(function)
```

`running` 正是源码 §② A 推出的取值：`turn/end` 观察者运行时 driver 仍持有 running phase。
所以「在 `turn/end` 同步调 `compactNow`」会走 `runMaintenance` 的同步 `throw`（busy），
本轮现场确认了这条路径的前提条件成立。

## ③ 复现

```bash
# 只读：列出留存对象，找出根上下文
node /tmp/sh10-live/registry.mjs        # 探针脚本见 §④
# 只读：读服务可见性与 agent 状态，绝不调用 compactNow
node /tmp/sh10-live/servicemap.mjs
```

判据：第二条输出里 `hostPlane.compaction === "undefined"`、
`hostPlane.compactNowOnRoot === "no engine on root"`、`perAgent[].viaServiceFor` 以 `engine(` 开头。

## ④ 探针脚本

`/tmp/sh10-live/{registry,servicemap,sym2,env}.mjs` 是一次性探针，逻辑已在本文件 §② 逐条写明；
要长期保留的只有「用 `Symbol.for("dsh.inspector.realm-object-registries")` 拿根上下文」这一条读法，
它比脚本本身重要。

## ⑦ 成功路径实测（同一轮补齐，2026-11-24）

前一轮只证到「引擎拿得到」。本轮在**一次性探针 agent** 上把整条路径跑通，全程不碰用户的会话：
探针 agent 的 `cwd` 是 `/tmp/sh10-probe`，每次结束都 `dispose()`。脚本
`compact-live.mjs` 与 `mount-probe.mjs` 在同目录。

### A. 空闲 agent 上的调用结果

```
create({ sessionId: "session-probe-compact-…", meta: { cwd: "/tmp/sh10-probe", agentPreset: "standard" } })
  → status: idle
presets.mount(agent.ctx, "standard")            → 挂载建立
presets.serviceFor(agent, "compaction")          → object，compactNow 是 function
await engine.compactNow(agent, ac.signal)        → null
```

`null` 的含义由上游声明写死：`compactNow` 的 `@returns` 是「压缩结果，或**没有安全的可用区间时**
`null`」。探针 agent 只有 5 个事件（创建、系统提示、一两次启动事件），
`selectCompactableRange` 选不出可压缩区间，所以拿到 `null`——**没有抛错、没有写事件**
（`snapshotEvents()` 前后都是 5）、状态仍是 `idle`。

这正是源码 §⑤ 第 8 条预测的行为（「压一下交接子会话能腾空间」不成立：子会话没有历史，
只会得到 `null`），现在有了运行期证据。

### B. 两条守卫的运行期确认

| 守卫（§④ 清单） | 本轮运行期读数 |
|---|---|
| 3/4：`status === 'idle'` 不是保证 | 对 `running` 的活会话 agent 调 `compactNow`，**同步抛** `ManualCompactionError`、`code: "busy"`、消息 `manual compaction requires an idle agent with no waking queued work` |
| 6：`serviceFor` 返回 `undefined` 时静默降级 | 刚 `create` 出来、**未 `mount`** 的 agent 上 `serviceFor(agent,"compaction")` 返回 `undefined`；`mount` 之后同一次调用返回引擎 |

第 6 条是这条链上最容易踩的坑：`agents.create({ meta: { agentPreset: "standard" } })`
**只记名字、不建挂载**，所以紧接着 `serviceFor` 仍是 `undefined`。必须显式
`presets.mount(agent.ctx, "standard")`。真宿主里这件事发生在会话进入流程里
（`presetsApi` 的 `bind` 要求 scoped context），插件自己不要假设「写了 agentPreset 就有引擎」。

## ⑤ 仍然未证（不要当已证）

1. **压缩出真实结果的一次**（`result !== null`）。本轮探针会话没有可压缩区间，所以拿到的是
   `null`。要拿真结果得先给探针灌够历史（多轮真实请求，会花模型调用），本轮没做。
   `docs/compaction-vs-handoff.md` §9 重开条件 3 的字面要求是「实测通过且不与退休竞态」，
   **本文件只满足前半句的可调用性**，后半句见下一条。
2. **与交接退休的竞态**。`agent/status = idle` 窗口里压缩与 `retireIfPending` 的先后，本轮未构造场景。
3. **压缩后 gate 必须重算**（§④ 守卫 7）没有实测：本轮压缩产出 `null`，没有改写 surface，
   所以没有可重算的对象。

## ⑥ 这轮验收顺带确认的两件事

- `bash /etc/nixos/scripts/dsh-desktop-restart.sh --verify-only` 在本机仍必失败：探针连
  `http://127.0.0.1:19387` 并连印 5 次 `fetch failed`（脚本自己的旧缺省口），而宿主真实口是
  GUI `127.0.0.1:44205`（本次会话的 GUI URL）与 Inspector `9230`。这是
  `docs/development.md`「重启验收」一节的已知假失败，**不是**插件缺陷。
- `@deepseek-ai/dsh-subagent-claude-code` 的 `link:` 修复已生效：profile 内
  `import()` 返回 `IMPORT OK, exports: Config,apply,inject,name`，软链指向 rc.5 store。
  09:52 那三条 `crash-*-host.log` 的 `failed to import` 是修复前的记录。
