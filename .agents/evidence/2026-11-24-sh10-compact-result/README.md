# SH-10 收尾：在真实宿主上拿到 `compactNow` 的非 null 压缩结果

- 日期：2026-11-24。真实压缩两次跑于 20:04–20:09 +0800；另有一次免费重跑验证可重跑性。
- 取证对象：运行中的 dsh desktop 宿主，pid **86524**，启动 `2026-11-24 19:02:05 +0800`，
  store `wr0q0vjd3hxvq08z7ns67dsryywcmz1y-dsh-desktop-0.2.2-rc.5`，
  Inspector `127.0.0.1:9230`（target 标题 `DeepSeek Harness Host`、url `dsh://host`）。
- 探针：`probe.mjs`（本目录）。探针 agent 的 `cwd` 每次都 `mkdtempSync('/tmp/sh10-probe-XXXXXX')`，
  结束 `dispose()`，并回读宿主 `agents.list()` 证明**宿主进程里**没留下任何 agent
  （磁盘上的会话桶会留下，逐条列在文末「现场杂项」）。
- 只碰自己建的探针 agent：用户会话 `session-95ba96da-…` 与 `3772a3fc-…` 全程只出现在
  `hostAgentsBefore` / `hostAgentsAfter` 两份只读清单里，从未被 prompt、压缩或归档。

## 结论

**`result !== null` 已达成。** 在真实 dsh desktop 宿主上，对一个空闲的、`cwd` 在 `/tmp` 下的一次性探针
agent 调用 `engine.compactNow(agent, signal)` 返回了完整的 `CompactionResult`，两次独立复现都成功：

| 轮次 | 灌入历史 | 调前事件 / surface 节点 / token | 调后事件 / surface 节点 / token | 结果 | 耗时 |
|---|---|---|---|---|---|
| run1（`ROUNDS=6`） | 6 轮合成 user/assistant 对（**0 次模型调用**） | 44 / 13 / 5972 | 48 / 3 / 1082 | **非 null** | 9350 ms |
| run2（`ROUNDS=4`） | 4 轮合成 user/assistant 对（**0 次模型调用**） | 32 / 9 / 3988 | 36 / 3 / 973 | **非 null** | 5695 ms |

返回对象键名（`Object.keys(result)`，run1 实测，与上游 `CompactionResult` 声明逐字段吻合）：

```
["compactionId","startSeq","summarySeq","summary","shadowedRange","shadowedSeqs","shadowedTokenCount","endSeq"]
```

run1 取值：`compactionId=520e0c20-ec01-4a08-9f8e-f3a78bb97758`、`startSeq=44`、`summarySeq=45`、
`endSeq=47`、`shadowedRange={start:9,end:39}`、`shadowedSeqs=[9,10,15,16,21,22,27,28,33,34,39]`、
`shadowedTokenCount=5459`、`summary` 单块 text 共 1867 字符。

新事件落地：**有，且正是契约形状**。4 条新事件、seq 连续 44–47：

```
44 compaction/start → 45 compaction/summary → 46 user/message(replace 9..39) → 47 compaction/end
```

`compaction/summary` 的模型用量（run1）：`provider=magpie`、`model=auto/deepseek-v4.1-flash`、
`maxTokens=65536`、`usage={inputTokens:5005, outputTokens:857, totalTokens:5862}`、`llmStreamCall=true`。
run2 同形：`usage={inputTokens:1289, outputTokens:412, totalTokens:3749, cacheReadTokens:2048}`。
即压缩确实花了一次真实模型调用——这是本任务用户已明确同意的那一次（实际发生两次，见「成本」）。

**压缩后 surface 的形状值得注意**：`surfaceSeqs` 从 `[8,9,10,15,…,39,40]` 变成 `[8,46,40]`。
`8` 是 system 节点（`selectCompactableRange` 永远不把 surface 节点 0 纳入区间），`46` 是替换
`9..39` 的 checkpoint 替换节点，`40` 是保留的最近尾部。所以 `shadowedRange.start=9` 而
`shadowedSeqs` 不含 8 —— 与源码 `firstIdx = systemHead(...) === undefined ? 0 : 1` 一致。

## 每一步的真实输出

以下为 `probe.mjs` 的 `console.log(JSON.stringify(payload,null,2))` 原文摘录（未转述）。

### ① run1：`ROUNDS=6 node probe.mjs`（真实压缩，一次模型调用）

```json
{
  "steps": [
    { "step": "root", "ok": true, "hostPlaneCompaction": "undefined" },
    { "step": "unmounted", "status": "idle", "events": 5, "surface": 0, "engine": "undefined", "compactNow": "undefined" },
    { "step": "mounted",   "status": "idle", "events": 5, "surface": 0, "engine": "object",   "compactNow": "function" },
    { "step": "history-appended", "status": "idle", "events": 44, "surface": 13, "engine": "object", "compactNow": "function",
      "measure": { "totalTokens": 5972, "surfaceTokens": 5972, "nodeCount": 13, "baselineKind": "estimated", "baselineTokens": 5972, "logRevision": 44 },
      "projection": { "asOfSeq": 43, "values": { "contextPressure": {}, "contextBreakdown": { "systemTokens": 20, "toolsTokens": 0, "messageTokens": 5952 } } },
      "activity": [] },
    { "step": "dispose", "ok": true },
    { "step": "status-hook-removed", "ok": true }
  ],
  "hostAgentsBefore": ["session-95ba96da-d9db-4904-bc83-220ec0f133a4", "3772a3fc-3c55-4f84-a521-f069ea42970e"],
  "probeId": "session-probe-sh10-mwune23k",
  "enginePrototype": ["_registerAutomaticCompaction","summarize","compactIfNeeded","compactPressure","compactRegion","compactNow","regionDependencies"],
  "before": {
    "status": "idle", "eventCount": 44, "surfaceNodes": 13,
    "surfaceSeqs": [8,9,10,15,16,21,22,27,28,33,34,39,40],
    "measure": { "totalTokens": 5972, "surfaceTokens": 5972, "nodeCount": 13, "baselineKind": "estimated", "baselineTokens": 5972, "logRevision": 44 },
    "projection": { "asOfSeq": 43, "values": { "contextPressure": {}, "contextBreakdown": { "systemTokens": 20, "toolsTokens": 0, "messageTokens": 5952 } } },
    "activity": []
  },
  "compactNow": {
    "outcome": {
      "kind": "compacted",
      "keys": ["compactionId","startSeq","summarySeq","summary","shadowedRange","shadowedSeqs","shadowedTokenCount","endSeq"],
      "compactionId": "520e0c20-ec01-4a08-9f8e-f3a78bb97758",
      "startSeq": 44, "summarySeq": 45, "endSeq": 47,
      "shadowedSeqs": [9,10,15,16,21,22,27,28,33,34,39],
      "shadowedRange": { "start": 9, "end": 39 },
      "shadowedTokenCount": 5459,
      "summaryBlocks": ["text"], "summaryChars": 1867
    },
    "elapsedMs": 9350,
    "sampleCount": 24
  },
  "after": {
    "status": "idle", "eventCount": 48, "surfaceNodes": 3,
    "surfaceSeqs": [8,46,40],
    "measure": { "totalTokens": 1082, "surfaceTokens": 1082, "nodeCount": 3, "baselineKind": "estimated", "baselineTokens": 5972, "logRevision": 48 },
    "projection": { "asOfSeq": 47, "values": { "contextPressure": {}, "contextBreakdown": { "systemTokens": 20, "toolsTokens": 0, "messageTokens": 1062 } } },
    "activity": [],
    "newEventTypes": ["compaction/start","compaction/summary","user/message","compaction/end"],
    "newEventSeqs": [44,45,46,47],
    "compactionEvents": [
      { "seq": 44, "type": "compaction/start" },
      { "seq": 45, "type": "compaction/summary" },
      { "seq": 47, "type": "compaction/end" }
    ]
  },
  "summaryEvent": {
    "provider": "magpie", "model": "auto/deepseek-v4.1-flash", "maxTokens": 65536,
    "usage": { "inputTokens": 5005, "outputTokens": 857, "totalTokens": 5862 },
    "shadowedTokenCount": 5459, "llmStreamCall": true,
    "shadowedSeqs": [9,10,15,16,21,22,27,28,33,34,39], "summaryChars": 1867
  },
  "statusTransitions": [],
  "hostAgentsAfter": ["session-95ba96da-d9db-4904-bc83-220ec0f133a4", "3772a3fc-3c55-4f84-a521-f069ea42970e"],
  "probeAgentLeftBehind": false
}
```

### ② run2：`ROUNDS=4 node probe.mjs`（真实压缩，独立复现）

```json
{
  "probeId": "session-probe-sh10-mwunkyp0",
  "before": { "eventCount": 32, "surfaceNodes": 9, "measure": { "totalTokens": 3988, "surfaceTokens": 3988, "nodeCount": 9, "baselineKind": "estimated", "baselineTokens": 3988, "logRevision": 32 } },
  "outcome": { "kind": "compacted", "startSeq": 32, "summarySeq": 33, "endSeq": 35, "shadowedTokenCount": 3475, "summaryChars": 1432 },
  "elapsedMs": 5695,
  "after":  { "eventCount": 36, "surfaceNodes": 3, "measure": { "totalTokens": 973, "surfaceTokens": 973, "nodeCount": 3, "baselineKind": "estimated", "baselineTokens": 3988, "logRevision": 36 } },
  "usage": { "inputTokens": 1289, "outputTokens": 412, "totalTokens": 3749, "cacheReadTokens": 2048 },
  "probeAgentLeftBehind": false
}
```

### ③ `SKIP_COMPACT=1 ROUNDS=6 node probe.mjs`（负控制：不花钱也能证「灌历史→可压缩区间存在」）

这轮完全不调 `compactNow`，只证历史灌入与读数：

```json
{
  "steps": [
    { "step": "root", "ok": true, "hostPlaneCompaction": "undefined" },
    { "step": "unmounted", "status": "idle", "events": 5, "surface": 0, "engine": "undefined", "compactNow": "undefined" },
    { "step": "mounted",   "status": "idle", "events": 5, "surface": 0, "engine": "object",   "compactNow": "function" },
    { "step": "history-appended", "status": "idle", "events": 44, "surface": 13,
      "measure": { "totalTokens": 5972, "surfaceTokens": 5972, "nodeCount": 13, "baselineKind": "estimated", "baselineTokens": 5972, "logRevision": 44 },
      "projection": { "asOfSeq": 43, "values": { "contextPressure": {}, "contextBreakdown": { "systemTokens": 20, "toolsTokens": 0, "messageTokens": 5952 } } } },
    { "step": "dispose", "ok": true }
  ],
  "compactNow": { "skipped": true, "reason": "SKIP_COMPACT=1" },
  "probeAgentLeftBehind": false
}
```

### ④ `RACE=1 ROUNDS=2 node probe.mjs`（空闲窗口 / 退休碰撞专项，0 次模型调用）

```json
{
  "race": {
    "steps": [],
    "insideMaintenance": { "status": "idle", "signalAborted": false },
    "duringMaintenance": { "status": "idle", "activity": [], "inMaintenance": true },
    "archiveWithoutStop": { "ok": true, "note": "admission did not refuse while maintenance held the agent" },
    "secondCompactNow": {
      "ok": false, "name": "ManualCompactionError", "code": "busy", "sync": true,
      "message": "manual compaction requires an idle agent with no waking queued work"
    },
    "archive": { "ok": true },
    "afterArchive": { "status": "idle", "archived": true, "activity": [] },
    "maintenanceResult": "maintenance-done",
    "afterMaintenance": { "status": "idle", "activity": [] },
    "archivedButLive": { "inAgents": true, "status": "idle" },
    "unarchive": { "ok": true },
    "finalArchived": false
  },
  "probeAgentLeftBehind": false
}
```

## 表格：灌历史方式 / 事件数 / 返回值 / 新事件 / 耗时

| 探针轮次 | 灌历史方式 | 模型调用 | 调前事件数 | 调前 surface 节点 | 调前 token | `compactNow` 返回值 | 有无新事件 | 耗时 |
|---|---|---|---|---|---|---|---|---|
| run1 `ROUNDS=6` | 直接 `session.append`：1 条 `request/header` + 6 组（`turn/start`、`step/start`、首轮 `system/message`、`user/message`、`assistant/message`、`step/end`、`turn/end`） | 仅压缩那一次 | 44 | 13 | 5972 | **非 null**（8 键，见上） | 有，4 条：`compaction/start`、`compaction/summary`、替换区间的 `user/message`、`compaction/end`，seq 44–47 | 9350 ms |
| run2 `ROUNDS=4` | 同上，4 组 | 仅压缩那一次 | 32 | 9 | 3988 | **非 null**（同 8 键） | 有，4 条 | 5695 ms |
| `SKIP_COMPACT=1` | 同上，6 组 | 0 | 44 | 13 | 5972 | 未调用（负控制） | 无 | — |
| `RACE=1` | 同上，2 组 | 0（用 `runMaintenance` 合成睡眠代替真实摘要） | 20 | 5 | 2004 | 未调用；第二个并发 `compactNow` 同步抛 `busy` | 无 | ~2500 ms（维护窗口） |

调后读数（run1）：事件 44 → 48（+4）、surface 节点 13 → 3、token 5972 → 1082
（`contextBreakdown.messageTokens` 5952 → 1062，`systemTokens` 保持 20，`toolsTokens` 0 —— 探针 agent
没走过真实请求，所以没有 tools 定价）。

## 灌历史方式：为什么选「直接 append 事件」而不是 `followup()`

任务是「灌够历史使有可压缩区间」。两条路都探过：

1. **`followup()` 一轮 prompt**（任务里给的例子）：可行但每轮花一次真实模型调用，且要凑到
   有意义的可压缩区间需要多轮。放弃。
2. **直接往 `agent.session.append(...)` 追加 user/assistant 事件**：实测**可行且 0 次模型调用**。
   关键约束来自 `@deepseek-ai/dsh-token-meter` 的 replay fold —— 它要求 `assistant/message`
   之前有匹配的 `step/start`，否则量不出来（我第一版只 append 了
   `user/message` + `assistant/message`，得到
   `token meter: assistant/message at seq 6 has no matching step/start event`）。
   补上完整回合骨架（`turn/start` → `step/start` → 消息 → `step/end` → `turn/end`）与一条
   `request/header` 之后，`meter.measure()` 立刻给出正常读数。

所以最终方式：**`ROUNDS` 组完整回合骨架 + 每轮一对 user/assistant 消息（正文由 `FILLER` 控制长度），
外加一条 `request/header` 指定路由**。一次 `ROUNDS=6` 拿出 5972 token / 13 个 surface 节点，
`compactNow` 一次就够——**没有连着灌很多轮**。

合成内容的形态是刻意的：正文点名了 `packages/core/session/src/surface.ts`、`node --test`、
`observed value 17` 这类具体串，便于在摘要结果里核对「路径/命令/数字被保留」这条上游要求；
但本文件不给摘要质量的判断，只核对形状与用量。

## 与「交接退休」（`retireIfPending`）的碰撞：测到什么程度

结论先写：**在 `runMaintenance` 持有 agent 的整个窗口里，`agent.status` 恒为 `idle`、
`workspace/session-activity` 恒为 `[]`，所以 `retireIfPending` 那条路径上的两道门都看不出
有工作在跑。** 依据三点，都是现场读数：

1. `agent.status` 的 getter 把 `maintenance` 与 `idle` 一起算作 `idle`
   （`agent-loop/src/agent.ts` 的 `get status()`），所以压缩进行中 `status === 'idle'` 仍然成立 ——
   本机 24 次采样（run1，每 400 ms）**全部** `idle`，`statusTransitions` 为空数组。
2. `workspace/session-activity` 只看 `agent.status === 'running'`
   （`core/agent/src/archive-admission.ts` 的 `installTurnArchiveAdmission`），因此维护窗口里
   它返回 `[]`。RACE 轮实测：`archiveWithoutStop.ok = true` —— **不带 `stopActivity` 的归档没有被
   准入拒绝**，这正是「该门判不出来」的直接证据。
3. `retireIfPending` → `retireSession` → `archiveSession(id, { stopActivity: true })`，
   而 `stopActivity` 会跳过活动检查并调 `workspace/session-stop`；后者对
   `status === 'running'` 才 `agent.cancel`。RACE 轮里维护窗口内归档**成功**，
   `maintenanceResult` 仍是 `"maintenance-done"` —— 归档没有打断维护任务。

由此可判断的方向（注意：这是**推断**，不是实测到的丢失）：若一次交接在 `turn/end` 里落地并把退休
排进 `pendingRetire`，随后同一会话上开始了维护型压缩，那么紧随的 `turn/end` 触发的
`retireIfPending` **不会**被准入拒绝，会在压缩进行中把会话归档；压缩仍会跑完并把结果写进一个
已归档的会话。RACE 轮的 `archivedButLive` 证明了归档后 agent 仍在 `agents.list()` 里、仍是 `idle`
——即归档并不终止 agent。

**没有测到的部分**（见未证清单）：真实交接 + 真实压缩同时发生的那一场；以及「压缩完成后 gate 是否
重算」。

## 未证清单

1. **真实交接与真实压缩的交叠没跑过**。RACE 轮用 `runMaintenance` + 合成睡眠替代真实压缩，
   并直接调 `workspaceRegistry.archiveSession`，没有触发一次真正的 `performHandoff`
   /`scheduleRetirement`。所以「`agent/status = idle` 窗口与 `retireIfPending` 撞」这一条，
   本轮测到的是**底层判据**（status 与 activity 在维护窗口里都看不出活动），不是那场端到端碰撞。
2. **压缩后 gate 是否重算没测**。本插件的 gate 重算路径在 `src/project-handoff/`，要在真实交接
   上下文里观察；探针 agent 是 `/tmp` 下的一次性会话，没有 `MEMORY.md`/`CONTEXT.md` 的交接语境。
3. **`contextPressure` 全空**。两次运行的 `sessionProjections.snapshot(...).values.contextPressure`
   都是 `{}` —— 因为探针会话从没发过真实请求，没有 provider usage 可锚定。所以「压缩前后
   `pressureTokens`/`projectedTokens` 的对照」这一项**读不到**，本文件不做推断；
   能读到的只有 `contextBreakdown`（启发式组成）与 `meter.measure()` 的 `totalTokens`。
4. **自动压缩路径（`agent/pre-step` 压力触发、model-switch、context-overflow 重试）没测**。
   本轮只测手动 `compactNow`。
5. **`compactNow` 的失败分支只测到 `busy`**（RACE 轮的并发第二次调用，同步抛
   `ManualCompactionError` / `code:'busy'`）。`summary` / `changed` / `commit` / `persistence` /
   `cancelled` 五个 `code` 本轮都没构造。
6. **没有测 token 计费金额**。只读到 `usage`（run1 5862、run2 3749 total tokens），
   没有把 token 换算成钱。
7. **`ROUNDS` 只试了 4 与 6**。没有寻找「刚好触发」的下界，也没有测更大的历史
   （比如 100K token 以上）是否会在 `summary is not smaller than the shadowed content`
   那条闸上失败。

## 成本

任务允许这一次模型调用，也要求「要灌大量历史才能触发就先停下来说预估」。实际情况：

- 灌历史**完全不花模型调用**（直接 append 事件），所以没有「为了凑区间连着灌很多轮」的花费。
- 真实压缩发生了**两次**（run1 与 run2），因为我要独立复现一次而不是只信单次样本：
  run1 `usage.totalTokens = 5862`（input 5005 / output 857），
  run2 `usage.totalTokens = 3749`（input 1289 / output 412 / cacheRead 2048）。
  合计 **9611 token**（input 6294 / output 1269 / cacheRead 2048）。
- 其余轮次（`SKIP_COMPACT=1`、`RACE=1`）**0 次模型调用**。

## 之前的结论是否需要更正

**没有发现需要推翻的既有结论。** 前一轮
`.agents/evidence/2026-11-24-sh10-runtime-reachability/README.md` §⑤ 列的残余第 1 条是
「压缩出真实结果的一次（`result !== null`）」，本轮正是补它，结论方向一致（空闲 agent 上
`compactNow` 返回非 null 的前提是**有可压缩区间**）。

一处需要**收紧措辞**：该文件 §⑦ A 写「探针 agent 只有 5 个事件（创建、系统提示、一两次启动事件），
`selectCompactableRange` 选不出可压缩区间，所以拿到 `null`」。本轮实测：刚 create + mount 的探针
`surface` 节点数确实是 **0**（见 `steps[1]`/`steps[2]` 的 `"surface": 0`），不是「有 5 个事件所以
选不出」，而是**根本没有 surface 节点**（`measure.nodes.length === 0`，直接命中
`selectCompactableRange` 的 `if (pricedNodes.length === 0) return null`）。5 个事件是**日志**事件数，
不是 surface 节点数；把两者混在一起会让读者以为「少量历史就会返回 null」，而实际是
「**没有** surface 节点才返回 null」——本轮 run2 只用 9 个 surface 节点（3988 token）就成功压缩了。

另一处补充（不是更正）：同文件把「8 条守卫」的模型当既有结论；本轮现场确认了其中两条在本机成立
（未 mount 时 `serviceFor` 返回 `undefined`、mount 后返回引擎；对维护中/运行中的 agent 调
`compactNow` 同步抛 `busy`），并且多确认了一条**`status === 'idle'` 在维护窗口里也为真**，
这比「不是保证」更强：它对「空闲」这个判断本身就不具区分力。

## 怎么跑

```bash
cd /mnt/Data/Projects/dsh-project-context/.agents/evidence/2026-11-24-sh10-compact-result

# 免费：只灌历史、读读数，不调 compactNow（0 次模型调用）
SKIP_COMPACT=1 ROUNDS=6 node probe.mjs

# 免费：空闲窗口与退休准入的碰撞专项（0 次模型调用）
RACE=1 ROUNDS=2 node probe.mjs

# 花钱：真实压缩一次（≈1 次摘要模型调用，本机实测 5–9 秒、3.7K–5.9K token）
ROUNDS=6 node probe.mjs
```

参数（环境变量）：

| 变量 | 默认 | 作用 |
|---|---|---|
| `INSPECTOR` | `http://127.0.0.1:9230` | Inspector 基址 |
| `ROUNDS` | `6` | 合成回合数（每轮 1 对 user/assistant） |
| `FILLER` | `14` | 每条消息重复填充句次数（≈160 字节/次） |
| `PROBE_PROVIDER` | `magpie` | 探针 agent 的路由 provider |
| `PROBE_MODEL` | `auto/deepseek-v4.1-flash` | 探针 agent 的模型 |
| `SAMPLE_MS` | `400` | 维护窗口内 status/activity 采样间隔 |
| `SKIP_COMPACT` | — | `1` = 跳过压缩调用（免费） |
| `RACE` | — | `1` = 只跑退休碰撞专项（免费） |

判据：
- 成功 = 输出里 `compactNow.outcome.kind === "compacted"`、`outcome.keys` 是那 8 个键、
  `after.newEventTypes` 是 `["compaction/start","compaction/summary","user/message","compaction/end"]`、
  `probeAgentLeftBehind === false`。
- 「没有可压缩区间」= `kind === "null"`（不是失败；surface 节点 < 2 时必然如此）。
- 不要拿 `elapsedMs` 当性能指标：它包含一次真实模型往返，随网关抖动。

## 现场杂项

- 本轮之外，仓库工作树里有**别人**的未提交改动（`client/card-fields.ts`、`src/shared/settings-namespaces.ts`、
  `lib/**` 等，mtime 19:35–20:07），属并行的设置拆分工作。本任务只写了
  `.agents/evidence/2026-11-24-sh10-compact-result/`，未碰 `src/`、`lib/`、`test/`、`client/`。
- 探针留下的**磁盘痕迹**（这是事实，不是「没有留下」）：每次 `mkdtemp` 一个 cwd，宿主就会在
  `~/.dsh/sessions/` 下建一个对应桶。本轮 7 次运行留下 7 个桶（每个 2–8 KB，含 `session.lock`
  与 `session.v4.jsonl.zstd`）：

  ```
  --tmp-sh10-probe-yRJ2vZ--   session-probe-sh10-mwune23k   (run1)
  --tmp-sh10-probe-BTBvvU--   session-probe-sh10-mwunkyp0   (run2)
  --tmp-sh10-probe-oKfGNs--   session-probe-sh10-mwundgbe   (SKIP_COMPACT)
  --tmp-sh10-probe-WvIA6X--   session-probe-sh10-mwunjlrx   (RACE)
  --tmp-sh10-probe-n1ZGaO--   session-probe-sh10-mwunhwce   (早期探路)
  --tmp-sh10-probe-VRcUUo--   session-probe-sh10-mwunimm1   (早期探路)
  --tmp-sh10-probe-IpWLUS--   session-probe-sh10-mwunz1sp   (重跑验证)
  ```

  另有 `~/.dsh/sessions/--tmp-sh10-compact--/`（`/tmp` 试跑用的 cwd）与
  `~/.dsh/sessions/--tmp-sh10-probe--/`（**上一轮**证据
  `2026-11-24-sh10-runtime-reachability` 留下的 4 个会话）。

  `dispose()` 清掉的是**宿主进程里的 agent**（`agents.list()` 前后都是那 2 个用户会话，
  `probeAgentLeftBehind: false`），不是磁盘上的会话归档——这两件事要分开说。是否删这些桶由用户定，
  本轮没有删（避免动 `~/.dsh` 里不属于本任务的东西）。
