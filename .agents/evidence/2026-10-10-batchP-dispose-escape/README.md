# 批次 P 的裁决证据：dispose 时的模型调用异常能否逃逸进宿主 runner

问题（用户裁决为「先补证据」）：dsh 的 `project-memory` 在 `agent/disposed` 上跑**强制**（`force: true`）
的模型整理（`src/project-memory/index.ts`），pi 把这条路径删掉（`033fa75` + `eff6a56`）的理由是
「模型调用异常逃逸进 extension runner」。dsh 侧此前**未复现**。

**结论：NOT REACHABLE —— 异常在两层被独立抑制。pi 的崩溃链在 dsh 结构上不成立。**

- 宿主修订：19387 持有者 PID 35009，起于 `2026-10-10T23:04:23+08:00`，加载
  `/nix/store/cl7chjvxjw81aizwlxar1k8n9z02yd3b-dsh-desktop-0.2.0-rc.2/lib/dsh-desktop/repo`
  （`@deepseek-ai/dsh` 0.2.0-rc.2）。store 里没有 git hash，用 `node_modules/@deepseek-ai/dsh-agent`
  → `…/repo/packages/core/agent` 反证宿主加载的就是这份源码/编译产物。
- 证据覆盖面：dispose 处理器与 tracker 在 `2462d59^` 与 `HEAD` **逐字节相同**，所以结论不依赖插件修订。

## 层一：宿主 core 的 emitter 自己兜住

`packages/core/agent/src/index.ts` 的 `emitDisposed`（编译产物 `lib/index.js:547-560`）是 `agent/disposed`
**唯一**的生产发射点（全仓 grep 无第二处）：

```ts
for (const callback of this.ctx.events.dispatch('emit', args)) {
  try {
    const returned: unknown = callback(...args)
    void Promise.resolve(returned).catch((error) => { this.ctx.logger.warn(`…listener rejected: …`) })
  } catch (error) {
    this.ctx.logger.warn(`…listener threw: …`)
  }
}
```

- 派发模式是 `emit` ⇒ **不 await 监听器**（`cordis_inspect_query` Event `agent/disposed` 实证
  `"mode":"emit"`；对照 `agent/created` 走 `await this.ctx.serial(...)`）；
- **同步抛**被 `catch`、**拒绝的 promise** 被 `.catch` 记 warn，两者都到不了 `detach`/effect disposer。
- 宿主 core 自带用例 `packages/core/agent/tests/agent.spec.ts:138-152` 就叫
  "contains every disposal-listener failure"。

## 层二：插件自己的 tracker 先吃掉

`src/shared/lifecycle.ts` 的 `SessionWorkTracker.track`：

```ts
const tracked = work.then(() => undefined, () => undefined);
```

handler 是 `pending.track(agent.session, consolidateProject(…))` 并返回 `undefined`，所以
`consolidateProject` 的**拒绝在到达 core 的 `.catch` 之前就被消费**；同步抛由层一兜住。

**这一层是承重的**：宿主的 `installFailLoud`（`packages/boot/app-boot/src/index.ts`）把
`unhandledRejection` / `uncaughtException` 记 stderr 并 **`proc.exit(1)`**（现读 `:690-730` 确认）。

## 现跑探针（两个都 exit 0）

```sh
node .agents/evidence/2026-10-10-batchP-dispose-escape/probe.mjs    # RESULT: CONTAINED
node .agents/evidence/2026-10-10-batchP-dispose-escape/probe2.mjs   # RESULT: CONTAINED
```

- `probe.mjs`：用**宿主加载的那份** `@deepseek-ai/dsh-agent` 注册一个同步抛监听器 + 一个拒绝监听器 +
  一个目击者，然后注册并 dispose 一个 agent ⇒ `heard: ["probe"]`、两条 warn（`SYNC_BOOM` / `ASYNC_BOOM`）、
  `unhandledRejection count: 0`。
- `probe2.mjs`：导入插件已构建的 `lib/shared/lifecycle.js`，把 `Promise.reject` 交给 `track` 再 `flush`
  ⇒ flush 正常 resolve、`unhandledRejection count: 0`。

两个探针都在 `unhandledRejection` 上装计数器：若真逃逸，计数器非 0 且宿主会 `exit(1)`。

## 能抛但逃不出去的位置（列出以免误读成「不可能抛」）

`getProjectRoot`（`index.ts:182`，在 try **之前**）与 catch 块内的 `logError`（`index.ts:360`——这正是 pi
`eff6a56` B1 的类别「catch 自己也抛了」）都会让 `consolidateProject` 的 promise 拒绝，但被 `track` 吃掉。
其余（`withMemoryLock` 超时 `shared/lock.ts:231`、文件写入、`consolidate.ts` 里重抛的流/模型错误
`:482/:491/:559`）都在 `consolidateProject` 自己的 try 内 ⇒ `index.ts:356` 记成 `status: "failed"`。

## pi 的原始动机（读自 pi 的提交，不是它的散文）

- `033fa75`：*"The exit pass was the only unthrottled writer and the only model call on the teardown path,
  which is what let a provider error escape through emitSessionShutdownEvent once (errors.log 2026-09-22)."*
- `eff6a56` B1：*"the handler read ctx.cwd inside its try and again in the catch. That getter throws on a stale
  ctx … so the catch threw too and the handler rejected into pi's ExtensionRunner."*

pi 的 `session_shutdown` handler 是 `async` 且 **await** `flushMemoryRender`；dsh 的 `agent/disposed` handler
**不 await**，且把 promise 交给一个吞异常的 tracker。结构不同，所以同一条链在 dsh 关闭。

## 代价侧（P 换来什么）

强制 pass 仍可写：**MEMORY.md + memory journal**（`index.ts:245`）、**CONTEXT.md**（`index.ts:294`）、
**`.agents/memory/errors.log`**。

节流：`consolidate.ts:419` `throttled = !force && (…)`——`force: true` **永不节流**；`:421` 只在**同一 cap**
下的缓存结果 `< forceDedupeMs` 时去重。`DEFAULT_CONFIG`：`consolidateTurns: 6`、`consolidateIntervalMs: 5min`、
**`forceDedupeMs: 15s`**；desktop profile 只覆盖 `maxMemoryChars` / `handoffBudgetRecentTokens` /
`handoffPendingQuestion`，**不动节流键**。⇒ **几乎每次会话 dispose 都会跑一次真实模型调用**，然后写盘。

所以 pi 式改动（退出不再生成内容）在 dsh 的代价是确定的：两次节流 pass 之间结束的会话，尾部不再进
`MEMORY.md`，只留在 session 归档；而**安全收益在 dsh 不成立**（本文件的三条证据）。

## 未能验证（不要读成已证）

- pi 的 `ExtensionRunner` / `emitSessionShutdownEvent` 源码**不在本地**（那是 pi 的 harness 仓，不是
  `/mnt/Data/Projects/pi-project-context` 这个插件仓），pi 那侧的链条只有**它的提交散文**为据；
  dsh 那侧是源码 + 现跑探针。
- 没有在运行中的宿主里人为制造「dispose 期间的 provider 错误」；容器性由源码 + 宿主自带用例 + 两个对
  **已加载代码**的探针支撑，不是端到端崩溃尝试。
- **日志里 0 命中**：宿主日志 `~/.config/@deepseek-ai/dsh-desktop/logs/*.log` 对
  `agent/disposed` / `disposed listener` **0** 命中；`.agents/memory/errors.log` 里的 memory 模型调用失败
  （`ABORTED` / `TRANSPORT`）都是**被 catch 后记下**的，是容器性成立的正证据，不是逃逸。
- 宿主内存里的插件修订：HEAD 在宿主启动之后才动，本文件用「两份逐字节相同」覆盖这一点，但没有证明
  期间没发生 HMR 重载。

## 归属

调查由一个只读子代理执行（未改动任何文件，探针原本在 `/tmp/dsh-disposed-probe/`）；承重的两处抑制
代码与两个探针由本会话**第一手复核**并重跑，上面的输出即重跑结果。
