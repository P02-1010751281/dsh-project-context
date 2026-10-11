# 批次 S 证据 —— opencode 辅助路由：请求身份，以及它带出的 checkpoint 环路

规格：`docs/batch-s-opencode-aux-route-brief.md`（§2 环路现证、§3 B1/B2、§5 验收、§6 裁决）。

## 探针

`aux-route-probe.mjs`（只读仓库，只写 `$TMPDIR`）：

```
node .agents/evidence/2026-10-11-batchS-aux-route/aux-route-probe.mjs
```

三段各钉一环，退出码按因分：`0` = 三段全过；`10` = 请求不带会话身份（现场那个
`MissingSessionID`）；`11` = checkpoint flush 被 pass 挡住（环路）；`12` = 夹具没跑到模型调用；
`1` = 等价构造对照回归。

| 输出文件 | 树状态 | 结果 |
| --- | --- | --- |
| `1-pre-fix-probe.txt` | 修复前（`lib/` 仍是已提交的版本） | `RESULT: FAIL`，`exit 10` |
| `2-post-fix-probe.txt` | 修复后（本批 `src/` 构建出的 `lib/`） | `RESULT: PASS`，`exit 0` |

修复前那次的读数（逐字见文件）：

```
== 1. composition ... memory: parked=true sessionId=undefined checkpointFlushes=0 flushReturnedBeforeDispatch=false
== 2. mechanism   ... FLUSH_WAIT_MS=90000; flush while the pass is parked: parked; after release: returned
== 3. registration ... registrations=0 registeredDuringCall=false registeredAfterFirstCall=true
RESULT: FAIL (memory, autolearn: the auxiliary request carries no session identity — opencode answers 400 MissingSessionID)
```

修复后：

```
== 1. composition ... memory: parked=true sessionId="session-probe-memory" checkpointFlushes=1 flushReturnedBeforeDispatch=true
== 3. registration ... registrations=1 registeredDuringCall=false registeredAfterFirstCall=true
RESULT: PASS (identity stamped, the checkpoint flush returns before dispatch, the tracker holds only the write phase)
```

第 2 段在两次运行里都打印「parked」，这是**故意**的：它构造的是**修复前布线**（整段 pass 挂 tracker），
用来证明环路真实存在、且本批的对照不依赖树的状态。

## 变异轮（三个变异体全部被杀）

`src/` 从 `sha256sum` 校验过的 `/tmp/batchS-src-snapshot` 恢复（逐文件 `diff` 比对），每轮 `pnpm build`
后先确认标记进了 `lib/`，再跑具名用例；收尾重建后 `grep -rn "MUTANT_" lib/` = 0。

| 变异体 | 改动 | 只打红的用例 |
| --- | --- | --- |
| M1 | `src/shared/model-call.ts`：不发 `sessionId: options.sessionId` | 身份转发三处：`a plugin call forwards the tools it was offered, and only then`、`an automatic pass stamps the live session on its auxiliary request`、`the flush a stamped request triggers returns while the model call is still parked` |
| M2 | `src/project-memory/index.ts`：`agent/status` 把**整段 pass** 交回 tracker | `the flush a stamped request triggers returns while the model call is still parked` |
| M3 | `src/project-memory/index.ts`：删掉写阶段的 `options.track?.(work)` | `the pass hands the tracker its write phase alone` |

M2 那一轮的进程会多活约 90 秒：被parked 的 `waitBounded` 计时器仍在，用例在 1 秒内已判红。
