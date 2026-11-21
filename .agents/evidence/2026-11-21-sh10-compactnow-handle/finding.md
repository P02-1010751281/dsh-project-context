# SH-10 残留：交接时刻能否拿到空闲 agent 句柄调 `ctx.compaction.compactNow`

- 日期：2026-11-21。
- 取证对象：宿主实际加载的那份 checkout。`readlink -f` / `ls` 确认
  `$D = /nix/store/xbbn6inj2q64j88gsmjrljqkh1m572sy-dsh-desktop-0.2.2-rc.3/lib/dsh-desktop/repo`；
  该 checkout 内的 `node_modules/@deepseek-ai/dsh-compaction-basic`、`dsh-agent-preset-registry`、`dsh-web-app`
  都指向它自己的 `packages/`（例如 `repo/node_modules/@deepseek-ai/dsh-compaction-basic -> ../../packages/compaction/compaction-basic`），
  与运行上下文给出的实现 checkout 一致，版本 0.2.2-rc.3。
- 方法：**只读静态阅读**上游源码。没有跑宿主代码、没有构造探针会话，因此下文凡涉及“实际调用会怎样”的部分都是从代码路径推出来的，
  不是现场观测。
- 下文 `$D` 一律指上面那个 repo 根。

---

## ① 结论

**有条件能**：交接时刻拿得到 agent 句柄，但在 `turn/end` 回调里同步调 `compactNow` 会**同步抛** `ManualCompactionError('busy')`（那一刻 agent 必定是 `running`）；
交接路径是异步的，别指望“跑几个 await 就恰好等到 idle”，必须显式等 idle 并把 `busy` 当常路径接住。
而且压缩服务不在根域，只能经 `agentPresets.serviceFor(agent, 'compaction')` 取到——`ctx.compaction` / `ctx.get('compaction')` / `agent.ctx.get('compaction')` 都拿不到。

---

## ② 证据

### A. `turn/end` 观察者运行时，agent 状态一定是 `running`

- agent 的状态词表只有两个：`$D/packages/core/agent/src/runtime-types.ts:136`
  ```ts
  export type AgentStatus = 'idle' | 'running'
  ```
- `turn/end` 是在 `turn()` 内、driver 仍持有 `running` phase 时追加的：`$D/packages/core/agent-loop/src/agent.ts:428`
  ```ts
  this.session.append('turn/end', { turn, reason: turnEnds! })
  ```
  而回到 idle 只发生在 `kick()` 的 `finally`（`agent.ts:281-285`）：
  ```ts
  if (this.phase.kind === 'running') { this.setPhase({ kind: 'idle', lastTurn: turn }) ... }
  ```
- `session/event` 观察者是在事件进入 log **之后**同步调用的：`$D/packages/core/session/src/index.ts:981-984`
  ```ts
  this.log.push(event)
  ...
  invokeContainedSessionObservers(entry.emitCtx, 'session/event', entry.id, callbackArgs, callbacks)
  ```
  监听器抛错/返回的 promise 都被逐条吞掉（`index.ts:411-421` 的 `try/catch` + `Promise.resolve(...).catch(...)`），所以监听器里 `await` 不会阻塞回合，但状态就是 `running`。
- 本插件自己的注释已经记了这条：`src/project-handoff/index.ts:19-21`
  > “`agent.status` cannot express it (the driver is still `running` when `turn/end` commits)”

**推论**：`maybeAutoHandoff`（`src/project-handoff/auto.ts:95`）拿到 agent 的那一刻它一定非 idle；
但这个函数是 `async` 的，第一个 `await` 之后 driver 可能已经收敛，也可能因为排队输入继续跑下一回合——
所以“调用时是否 idle”不确定，代码不能依赖时序巧合。

### B. 句柄本身拿得到（且现有代码已有同一读法）

- `$D/packages/core/agent/src/index.ts:580-583`
  ```ts
  get(id: SessionId): Agent | undefined { return this.store.get(id)?.agent }
  ```
  注册在 agent 创建时进 store，dispose 时删除（`index.ts:511-525` `detachEntered`），所以**回合结束后、dispose 之前**句柄一直在；
  `index.ts:152-157` 也明说 `dispose()` 才会 “unregisters the agent, removes its session”。
- 本插件已经在生产路径上这样读 agent：`src/project-handoff/child.ts:174-176,204-209`
  ```ts
  const agents = ctx.get("agents") as { get?(id: string): SeedTargetLike | undefined } | undefined;
  const child = agents?.get?.(childId);
  ```
  说明 `ctx.get("agents")` 可用、且插件按结构性视图读它（`inject` 只有 `llm`/`systemPrompt`/`commands`，`src/project-handoff/index.ts:95`）。

### C. `compactNow` 的前置是 `runMaintenance`，即 agent 必须能“占住 idle phase”

- 服务侧接口：`$D/packages/compaction/compaction/src/index.ts:66-86`，`ManualCompactAgentContext` 多了
  ```ts
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
  ```
  注释（`:78-84`）：**“`@throws` synchronously when the agent is already active”**。
- 实现：`$D/packages/core/agent-loop/src/agent.ts:204-213`
  ```ts
  runMaintenance<T>(job): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    ...
  }
  ```
- backend 调它并在**同步**路径上把失败折成 `busy`：`$D/packages/compaction/compaction-basic/src/index.ts:407-459`
  ```ts
  override compactNow(agent, signal, sourceCommandId?) {   // 注意：不是 async 函数
    signal.throwIfAborted()                               // :412
    try {
      return agent.runMaintenance(async (agentSignal) => { ... })   // :414
    } catch (error) {
      throw new ManualCompactionError('busy',
        'manual compaction requires an idle agent with no waking queued work', { cause: error })  // :452-458
    }
  }
  ```
  `return` 一个 promise 在非 async 函数里不会被下面的 `catch` 接住，所以 `busy` 只对应**同步抛出**那一种失败。
- 重要陷阱：maintenance phase 对外仍报 `idle`（`agent.ts:157-159`：`phase.kind === 'idle' || phase.kind === 'maintenance'` → `'idle'`），
  所以 `agent.status === 'idle'` **不充分**：别人正持有一场 maintenance 时它也是 idle，而 `runMaintenance` 会同步抛。

### D. 忙碌守卫不止 `runMaintenance` 一处

- 会话有未闭合回合时另抛一个 `busy`：`$D/packages/compaction/compaction-basic/src/region.ts:193-195`
  ```ts
  if (entryState.openTurn !== null) {
    throw new ManualCompactionError('busy', 'manual compaction: the session already has an open turn')
  }
  ```
- durable 压缩锁（未闭合的 `compaction/start`）也是 `busy`：`region.ts:185-189,311-320`。
- `openTurn` 由回扫 log 得出（`region.ts:566-599`）。因为 log 先 push 再通知（session `index.ts:981-984`），
  `turn/end` 监听器执行时该事件已在 log 里，`openTurn` 已经是 `null`——所以**这一条**不会在 `turn/end` 时刻开火（见 ⑤）。

### E. 压缩服务是 preset 私有域，`ctx.compaction` 拿不到

- 宿主平面显式关掉：`$D/packages/bundle/web-app/cordis.patch.yml:576-583`
  ```yaml
  - id: compaction-basic
    disabled: true
  - id: command-compact
    disabled: true
  - id: tool-result-pruner
    disabled: true
  ```
- 实际由 preset 挂载，且是**隔离域**：`$D/packages/bundle/web-app/presets/standard.patch.yml:72-88`
  ```yaml
  - id: compaction
    name: cordis:group
    isolate:
      compaction: true
      toolResultPruner: true
    config:
      - id: compaction-basic ...
      - id: command-compact ...
  ```
- 隔离域的语义（决定“为什么插件看不到”）：`$D/packages/preset/agent-preset-registry/README.md:58`
  > “ordinary Context lookup outside the group, **including `agent.ctx`**, still selects the Host realm.
  > `agentPresets.serviceFor()` explicitly inspects the retained composition; it does not change ordinary service lookup.”
- 唯一入口：`$D/packages/preset/agent-preset-registry/src/index.ts:340-343`
  ```ts
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    const mount = this.generationFor(agent.ctx)?.mount
    return mount === undefined ? undefined : serviceForMount(this.owner, mount, name)
  }
  ```
  实现在 `mount.ts:86-112`（扫 store 里属于该 mount fiber 的实现，含隔离域）。
- `agentPresets` 在根域可用、默认 preset 是 `standard`：`web-app/cordis.patch.yml:616-622`
  ```yaml
  - insert:
      - id: agent-preset-registry
        name: '@deepseek-ai/dsh-agent-preset-registry'
        config:
          default: standard
  ```
  四个随包 preset（`standard`/`minimal`/`ptc`/`cordis`）都挂了同一个 `compaction` 组（`presets/*.patch.yml` 各有 `id: compaction` + `isolate: { compaction: true }`）。
- 仓库镜像：`command-compact` 之所以能用 `ctx.compaction`，是因为它与 provider 在同一个 `cordis:group` 隔离域里：
  `$D/packages/compaction/command-compact/src/index.ts:12,67`
  ```ts
  export const inject = ['commands', 'compaction']
  ...
  const result = await ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)
  ```
  `compactNow` 在全仓只有这一个调用点（`grep -rn "compactNow" packages --include=*.ts`：接口、实现、此命令、api-catalog 各一处）。

### F. 本包的采用边界（改不改是决策，不是事实）

- `docs/harness/integration.md:40`：`compaction/*` 一行决定是“**不接钩子；只读日志**”，并注明 dsh 没有压缩前钩子。
- `docs/harness/integration.md:61`：`SH-10` 现在的 shim 是 `src/project-handoff/compaction-events.ts`，拆除条件是
  “把该包作为 type-only devDependency 加到锁定线、且调用面可编译”。
- 依赖面事实：`package.json:80-107` 的 devDependencies 里**没有** `@deepseek-ai/dsh-compaction`，也没有
  `@deepseek-ai/dsh-agent-preset-registry`（与 agent 有关的只有 `@deepseek-ai/dsh-agent`）。
  所以要么加两个 type-only devDependency（并验证锁定线可编译），要么照 `runtime.ts` 现有 `*Like` 风格加两个结构视图。

---

## ③ 前置条件清单与失败形状

| # | 条件 | 不满足时的结果 | 证据 |
|---|---|---|---|
| 1 | 该会话有**活着的** agent（未 dispose、非冷会话） | `ctx.get('agents')?.get(id)` 返回 `undefined`，没有句柄可用 | `agent/src/index.ts:580-583`；dispose 删除见 `:511-525` |
| 2 | `runMaintenance` 入口要求 `agent.phase.kind === 'idle'`（调用方只能看到 `status`） | **同步抛** `ManualCompactionError`，code `busy`，message `manual compaction requires an idle agent with no waking queued work` | `agent-loop/src/agent.ts:204-205`；`compaction-basic/src/index.ts:452-458` |
| 3 | 会话没有未闭合回合（`openTurn === null`） | `ManualCompactionError` code `busy`，message `manual compaction: the session already has an open turn`（异步 rejection，走到 maintenance 内部） | `region.ts:193-195` |
| 4 | 会话没有未闭合的 `compaction/start` | `ManualCompactionError` code `busy`，message `...compaction already in progress; the session compaction lock is already active` | `region.ts:185-189,311-320` |
| 5 | 该 agent 的 preset 提供了 `compaction` 服务 | `serviceFor(agent,'compaction')` 返回 `undefined`，只能放弃 | `agent-preset-registry/src/index.ts:340-343` |
| 6 | 调用方的 signal 未 abort | 入口 `signal.throwIfAborted()` 同步抛**原样 abort reason**（不是 `ManualCompactionError`） | `compaction-basic/src/index.ts:412`；接口 `compactNow` 文档 `compaction/src/index.ts:157-160` |
| 7 | 压缩期间 agent 被 cancel/dispose | `ManualCompactionError` code `cancelled`（只有 agent 自己的 maintenance signal 被 abort 才算；调用方自己的 signal abort 保留原 reason） | `compaction-basic/src/index.ts:440-450` |
| 8 | 摘要/提交/落盘成功 | `changed` / `summary` / `commit` / `persistence` 四种 code；`null` 表示“没有可压缩的有用区间”，**不是**失败 | `region.ts:258-297`；`compaction/src/index.ts:35-41` |
| 9 | 会话还挂在 SessionStore 上 | 已 dispose 的会话 append 抛 `session "<id>" cannot append outside a SessionStore`（持有旧句柄硬调时） | `session/src/index.ts:952-956,1354` |

补充形状事实：

- `busy` 是**同步**抛出；其它 code 是 promise rejection。用 `.catch()` 接不住前者，必须 `try { await ... } catch`。
- `compactNow` 的第三个参数 `sourceCommandId` 是**可选**的（`compaction/src/index.ts:162-166`）；交接路径没有 `CommandId`，两参调用即可。
- compactNow 写入的 `compaction/start|end` 事件 `turn` 字段为 `null`（`region.ts:204-210`），说明这条路径本来就是给“回合之外”的会话用的。
- maintenance 期间 `status` 仍报 `idle`，且新到的唤醒输入会被 latched（`agent.ts:219-222`）——压缩若很慢，用户下一条消息会被推迟到压缩结束；
  dispose 会等 `whenIdle()`，所以压缩进行中也会推迟会话释放（`agent-loop/src/index.ts:520-523` 附近 `await machine.whenIdle()`）。

---

## ④ 接线形状（若决定做，最小形状与守卫）

调用点：交接流程里**在 `performHandoff` 之前**加一步（`maybeAutoHandoff` 内、`gatherDecisionInputs`/决策之后，`src/project-handoff/auto.ts:95-120` 这一段），
或在 `attempt()`（`src/project-handoff/index.ts:108-158`）里、`maybeAutoHandoff` 之前判定。不要塞进 `session/event` 同步回调本身。

伪形状（只给结构，不写实现）：

```
const agents   = ctx.get('agents')            // 现有读法：child.ts:204
const agent    = agents?.get?.(session.id)    // 无 → 放弃（保持现状，不伪造成功）
if (agent.status !== 'idle') await agent.whenIdle()      // 只等一次；不要轮询
if (agent.status !== 'idle') return            // 快筛；busy 仍然可能
const presets  = ctx.get('agentPresets')
const engine   = presets?.serviceFor?.(agent, 'compaction')   // 私有域的唯一入口
if (engine === undefined) return
const ac = new AbortController()               // 自己的 signal，ctx.effect 卸载时 abort
try { await engine.compactNow(agent, ac.signal) }            // 必须 try/catch：busy 是同步抛
catch (e) { if (e?.code === 'busy') return; if (ac.signal.aborted) return; throw }
```

守卫清单（每条都对应上面一条证据，缺一条就会在真实会话里翻车）：

1. **per-session 单飞**：复用 `inFlight`（`src/project-handoff/index.ts:111-120,148`），不要与交接尝试并发跑。
2. **只在顶层会话**：沿用 `isTopLevel`（`src/project-handoff/index.ts:175,231`）。
3. **idle 只能“等一次”**：`whenIdle()`（`agent.ts:259-264`）返回只说明“此刻没有活动”，下一条用户消息可以立刻开始新回合；
   等待期间新回合开始是常态，靠 `busy` 兜底即可，不要写成死循环重试。
4. **`status === 'idle'` 不是保证**：另一场 maintenance 期间它也是 idle（`agent.ts:157-159`），`runMaintenance` 会同步抛。
5. **必须自己造 `AbortSignal`**：`turn/end` 路径没有 `invocation.signal`；用 `AbortController` 并挂到 `ctx.effect` 的卸载上，
   会话 dispose 时也要 abort（`compactNow` 的 signal 是必填的）。
6. **`serviceFor` 返回 undefined 时静默降级**（宿主没有 preset/该 preset 不挂 compaction），不要写 `errors.log` 之外的用户面承诺。
7. **成功后必须重算 gate**：压缩会改写 surface，压缩前的阈值/测量（`resolveHandoffGate`）就作废了；把压缩当作交接的替代还是前置，
   要在写 `HANDOFF.md`/建子会话之前定下来，不能压缩完还按旧数字继续。
8. **不要用 `/compact` 命令回退**：`ctx.commands.execute(agent, '/compact', [], signal)` 存在（`$D/packages/interaction/commands/src/index.ts:361-367`），
   但它会往会话 log 里追加 `command/run`/`command/done`，并且必须在 idle 之后调用；它只是“绕开隔离域的另一种拿法”，
   与本条问题等价，不构成更短的路径。

---

## ⑤ 不成立的假设（查过、**不成立**，防止下次重查）

1. **“`session.status === 'idle'` 可以当前置判据”**——不成立。`Session` 没有 `status` 字段（`$D/packages/core/session/src/index.ts` 全文件无此成员；
   `status` 只出现在无关的 `Promise.allSettled` 结果判断 `:1436`）。idle 只在 `Agent` 上。
2. **“`compactNow` 只需要 durable 压缩锁空闲，所以可以在回合里跑”**——不成立。它必须过 `agent.runMaintenance`，同步要求 idle；
   `region.ts:193-195` 还额外拒绝 open turn。
3. **“`agent.status === 'idle'` 就够了”**——不成立。maintenance phase 也报 idle；别人持有时 `runMaintenance` 同步抛。
4. **“插件可以用 `ctx.compaction` 或 `ctx.get('compaction')`”**——不成立。宿主平面 `disabled: true`（`web-app/cordis.patch.yml:576-583`），
   服务在 preset 隔离域里；连 `agent.ctx` 也只看 Host 域（`agent-preset-registry/README.md:58`）。
5. **“`turn/end` 时 `openTurn` 还开着，所以会撞 `busy(open turn)`”**——不成立。log 先 push 再通知
   （`session/src/index.ts:981-984`），观察者跑时 `turn/end` 已在 log 里，`openTurn` 为 `null`；这条 `busy` 只在崩溃/遗留 open turn 的会话上出现。
6. **“`busy` 会以 rejected promise 形式出现，`.catch()` 能接”**——不成立。`compactNow` 不是 async 函数，`busy` 走同步 `throw`（`compaction-basic/src/index.ts:407-458`）。
7. **“`commandId` 必填，交接路径没法调用”**——不成立。第三参可选（`compaction/src/index.ts:162-166`），`command-compact` 只是碰巧有 `invocation.commandId`。
8. **“压一下交接子会话能腾空间”**——不成立。子会话刚创建、没有历史，`selectCompactableRange` 返回 `null`（`compaction-basic/src/index.ts:418-423`），
   只会得到 `null`（Nothing compactable），没有收益。
9. **“读 `agents` 必须进 `inject`”**——不成立。`ctx.get('agents')` 是插件现用读法（`child.ts:204`），且 `ctx.get` 未声明时返回 `undefined` 不抛。

### 残余（明确未证，不要当已证）

- **编译基线**：`@deepseek-ai/dsh-agent-preset-registry` 与 `@deepseek-ai/dsh-compaction` 都不在 `package.json` 的 devDependencies，
  本机 `node_modules` 里也没有这两个包，所以无法确认锁定线（0.1.7-rc.2）是否声明了 `agentPresets.serviceFor` / `compactNow`。
  按 `integration.md:61` 的拆除判据，这一步必须在动 `src/` 之前单独验证；否则只能走结构视图 + `ctx.get`。
- 没有跑运行期探针：`agent.status` 在真实 `turn/end` 时的取值、`serviceFor` 在真实会话上返回的实例，都是从源码推的，未在现场观测。
