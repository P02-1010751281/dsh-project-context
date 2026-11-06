# 批次 S —— opencode 路由上的辅助模型调用缺少 `x-opencode-session`

出处：2026-10-11 用户在本仓库跑 `/memory update` 失败（`Memory: update failed; see .agents/memory/errors.log`），
定位到本插件的辅助模型调用与 `opencode-go` 网关的前置条件冲突。用户同日裁决：**B1（盖活会话 id 并解掉
checkpoint 环路）与 B2（非活会话路由键）都要**——见 §6 的口径（B1 为首选，B2 是 B1 不可行时的兜底）。

## 1. 现证（不引用 prose）

`.agents/memory/errors.log` 两行（本地 +08）：

```
2026-10-11T07:40:40.449Z  15:40:40   Memory: update failed（第一次尝试）
2026-10-11T07:46:19.593Z  15:46:19   同一错误（第二次尝试）
Error: plugin model call failed (INVALID_REQUEST): 400:
  {"type":"MissingSessionID","message":"Request is missing x-opencode-session and cannot be routed efficiently."}
    at requestPluginTextWithMeta (lib/shared/model-call.js:152:29)
    at call (lib/project-memory/consolidate.js:445:24)
```

链路五环，每环都有可复读的出处：

1. 本会话路由是 `opencode-go` / `deepseek-v4.1-flash`（profile 的 `agent-default-model`，
   `~/.dsh/profiles/desktop/cordis.patch.yml:1084`；本会话 `model/selection` 事件 @13:11:11）。
2. pi-ai 的 opencode provider **只在请求带 `sessionId` 时**挂该头：
   `@earendil-works/pi-ai@0.87.1/dist/providers/opencode-headers.js` 的
   `if (!options?.sessionId || hasHeader(options.headers, OPENCODE_SESSION_HEADER)) return options`，
   否则 `headers[OPENCODE_SESSION_HEADER] = options.sessionId`。
3. dsh 自己的两个辅助调用**都盖章**：`packages/compaction/compaction-basic/src/summarizer.ts:160`
   （`sessionId: agent.session.id, purpose: 'compaction'`）、
   `packages/session/session-title-llm/src/index.ts:268`
   （`sessionId: request.session.id, purpose: 'session-title'`）。
4. 本插件**故意不盖**：`src/shared/model-call.ts:123` 的注释
   「Deliberately no `sessionId`: an auxiliary call must not enter the loop's session-checkpoint path…」，
   派发走 `ctx.llm.stream(requestOptions)`（同文件 `:180`）。
5. 于是网关 400；错误在**模型调用**处抛出，整理 pass 从未走到写路径。

两件事必须同时记住，否则会把锅记错：

- **不是 N/O/Q/R/Q2 的回归**：那五批改的是回复的验收/合并/拒绝与重试头寸，本错误发生在拿到回复之前。
- **不是插件抛错**：`callWithToolsFallback`/`requestPluginTextWithMeta` 把 provider 的 400 原样上抛
  （`lib/shared/model-call.js:207`），这是正确行为，不需要改。

## 2. 现有注释为什么是对的（环路现证）

`packages/session/session-checkpoint-policy/src/index.ts:64-68`：

```ts
ctx.on('llm/stream', (options, next) => {
  if (options.sessionId === undefined) return next()
  const session = ctx.sessions.get(options.sessionId)
  return session === undefined ? next() : afterCheckpoint(ctx, session, next)   // :35 await ctx.sessions.flush(session)
})
```

- **活会话 id ⇒ 每次派发前先 flush 该 session**；而本插件四个插件都注册了
  `ctx.on("session/flush", (session) => pending.flush(session))`
  （`src/project-memory/index.ts:466`、`src/project-autolearn/index.ts:77`、`src/project-context/index.ts:107`），
  `SessionWorkTracker.track` 收的又是**整个 pass**（`src/project-memory/index.ts:455/463`、
  `src/project-autolearn/index.ts:66/74`）——也就是正在等这次派发的那段工作。
- 于是形成环路：`llm/stream` → flush → 等 pass → 等这次 stream。
- **它不挂死，但会停**：`src/shared/lifecycle.ts:10` 的 `FLUSH_WAIT_MS = 90_000`，`waitBounded` 到点即返回，
  所以现状是**每次辅助调用白等 90 秒**（整理一次 1–2 次调用），并且那一次 flush 会在 pass 的写落盘前返回。
- **同一段代码给出出路**：`session === undefined ? next()` —— id 不是**活会话**时不进 checkpoint。

## 3. 两个形状

| | B1（首选） | B2（兜底） |
| --- | --- | --- |
| 动作 | 辅助调用盖**活会话 id**（`agent.session.id`），同时解掉环路 | 辅助调用盖一个**稳定的非活会话路由键**（如 `plugin-dsh-project-context:<workspace 哈希>`） |
| 为什么安全 | 环路必须被破，见下 | `ctx.sessions.get(key)` 取不到 ⇒ checkpoint 直接 `next()`，环路不存在 |
| 语义 | 与 dsh 核心一致（`sessionId` 的文档是「Session identity stamped by the loop for request routing」） | 字段名是 session 身份，放的却是传输路由元数据——必须写成注释并有用例钉住「它不是活会话 id」 |
| 代价 | 要动 tracker 的语义（durability 口子），需要用例与复核 | 语义谎报（低危：其他读者 `sessions.get`/`agents.get` 取不到就跳过），但**没有真正的会话关联** |
| 附带 | 顺带让 `x-deepseek-harness-session-id` 等头部也带上真实会话 | 只在需要该头的路由上才有意义 |

**B1 的破环有两种实现，实现者选一个并说明理由：**

- **B1-a 窄化 tracker（推荐）**：tracker 只收**写阶段**的 promise，不收整段 pass。flush 在模型调用期间
  立刻返回（此时确实没有新东西要落盘，checkpoint 要的是「已记录的请求前缀」durable，与我们的写无关），
  写阶段仍被 await。需要把 tracker（或一个 `track` 回调）传进 `consolidateProject` / `runAutolearn`。
- **B1-b 重入守卫**：`SessionWorkTracker` 增加「本会话正在做辅助模型调用」的标记，`flush` 期间返回 `undefined`。
  改动更小，但会让**任何**在该窗口内的 flush 提前返回（不只是 checkpoint 那次）——比 B1-a 粗。

**B2 的触发条件（不许留死代码）**：只有 B1 被证明代价不可接受（durability 口子过宽，或复核否决）时才落 B2；
两者**不并存**，最终只留一个所有者。若最终落 B1，brief 必须在 §6 写明 B2 被否的理由与证据。

## 4. 改动面（预估，唯一所有者）

- `src/shared/model-call.ts`：辅助调用接受并转发 `sessionId`（或路由键）；`resolveTarget` 一并返回它所需要的会话身份。
- `src/project-memory/consolidate.ts` + `src/project-autolearn/pass.ts`：把会话身份传进两次调用。
- `src/project-memory/index.ts` + `src/project-autolearn/index.ts`（B1-a 还要 `src/shared/lifecycle.ts`）：
  tracker 语义或重入守卫。
- 测试：① 辅助调用请求里带上了会话身份（用假 `llm` 服务捕获 `GenerateOptions`）；
  ② B1-a/B1-b 下「模型调用期间的 flush 不再等 pass」；③（B2）键是**非活**会话、且 `sessions.get` 取不到；
  ④ 既有旁路不被影响（`project-context` 的归档调用不是模型调用）。
- 不改配置键、无新依赖、两个 profile 无需改动。

## 5. 验收标准

1. **先证明再改**（本仓库的规矩）：探针复现环路——用真实 `lib/` 的 `SessionWorkTracker` 构造
   「pass 等 flush、flush 等 pass」，断言现状下 flush 要等满 `FLUSH_WAIT_MS`（90 s 太长，探针应把
   `waitBounded` 的预算作为可注入参数或用一个短预算的等价构造，并在输出里说明是等价构造）；
   改完后同一探针显示 flush 立刻返回。
2. 具名用例钉住每一环；**变异体至少 3 个**且各自只打红该打的那条（例如：去掉 sessionId 转发 / 把 tracker
   改回整段 pass / 把路由键换成活会话 id）。
3. 门禁 `pnpm typecheck` / `pnpm build` / `pnpm test` 现跑 0/0/全绿，`lib/` 与新鲜 `tsc` 编译只差 `client.js`，
   `lib/` 中 0 个变异标记。
4. 独立只读复核无阻塞缺陷。
5. **改了 `src/` ⇒ 判据转负，需要宿主重启才在线**；重启验收走
   `.agents/evidence/2026-10-11-post-restart-five-batch-accept/verify.sh`（它已把判据+lib 一致性+插件激活串起来）。
6. 端到端：重启后在本仓库跑一次 `/memory update`（用户操作），`errors.log` 不得再出现 `MissingSessionID`。

## 6. 用户裁决与口径（2026-10-11）

用户对「opencode-go 上 /memory update 的修法」多选了 **B1 与 B2**：**B1 是目标形状，B2 是 B1 不可行时的
兜底**（B2 选项标签本身写着「备用兜底」）。因此本批**只落一个**：先按 §2/§3 做 B1，若复核或探针证明
durability 口子不可接受，则改落 B2，并在 CHANGELOG 与本节写明被否的证据——**不得两个都留、不得留死代码**。

### 落地裁决（2026-10-11，本批）：落 **B1-a**，B2 被否

- **落的是 B1-a**（窄化 tracker：只把 pass 的**写阶段**交给 `SessionWorkTracker`）。入库探针
  `.agents/evidence/2026-10-11-batchS-aux-route/aux-route-probe.mjs` 的三段各钉一环：① 用真实 `apply()` 布线 +
  内联的 checkpoint policy 证明「身份已盖章、flush 在派发前返回」；② 用**修复前布线**的等价构造（整段 pass 挂 tracker）
  证明环路仍可复现（flush 停在 pass 后面，只有 `FLUSH_WAIT_MS` 兜底），它不依赖树的状态，是本批的对照；
  ③ 证明注册发生在模型调用**之后**且恰好一次。修复前 `exit 10`、修复后 `exit 0`。
- **B2 被否的理由**：B2 是「字段名是会话身份、放的却是传输路由元数据」的语义谎报，而 B1-a 的代价被探针与用例
  证明可接受——破环只要求「注册进 tracker 的那一段不等待派发」，而写阶段本来就不等待任何派发，所以 tracker 的
  语义没有被削弱，只是被**说准**了（`src/shared/lifecycle.ts` 的类注释写明了这条唯一契约）。B2 的唯一优势是
  不动 tracker，而 B1-a 对 tracker 的改动只是删掉两个调用位的整段 pass 注册（改为把写阶段交给同一个 tracker），
  没有引入新状态、新键或新配置。
- **B1-a 的已接受代价（登记，不是缺陷）**：`agent/status` / `agent/disposed` 上那次自动 pass 的**模型调用**不再被
  `session/flush` await（写阶段仍然被 await）。旧行为把整段 pass 挂在 flush 上，代价是每次辅助调用白等满
  `FLUSH_WAIT_MS`（90 s），且那次 flush 会在 pass 写下任何东西之前就给出「durable」的结论。模型调用本身不是可
  持久化的工作，它的失败由 pass 自己的报告（`ConsolidateReport.status` / 命令回执）与 `errors.log` 承担——
  `index.ts` 的两处 `void … .catch(() => undefined)` 与旧的 `pending.track` 吞掉拒绝的方式等价（tracker 的
  `work.then(() => undefined, () => undefined)` 同样不上抛），所以这一半行为未变。
- **B1-b 未采用**：重入守卫会让该会话在该窗口内的**任何** flush 提前返回（不只是 checkpoint 那一次），比 B1-a 粗。
- **被本批改写的既有测试信号**：`test/top-level-gate.test.mjs` 的 `fire()`、`test/autolearn.test.mjs` 的开关用例
  原先用 `session/flush` 当「整段 pass 完成」的信号；这正是本批窄化掉的东西，已改为按该文件既有的
  「有界窗口 + 阳性对照」观察模型调用本身。

## 7. 立即解锁（与本批解耦，用户操作）

设置卡片里的 `Provider` / `Model` 是**整理与技能沉淀共用**的路由覆盖，`resolveTarget` 第一优先读它
（`client/card-fields.ts:77-78`、`src/shared/model-call.ts:78`）。填成非 opencode 路线即可让 `/memory update`
今天就能跑（无需重启：这是 `settings.mutate` 设置写入）：

- `scnet` + `DeepSeek-V4.1-Flash`（同款模型、不同网关；推荐）
- `siliconflow` + `deepseek-ai/DeepSeek-V4-Flash`
- `command-code` + `deepseek/deepseek-v4.1-flash`（该网关另有已知的 `missing input.content.text` 400 类问题）

本批落地并重启后，这个覆盖可以撤掉（opencode 路由直接可用）。

## 8. 边界与残留

- 本批**不修** pi-ai / dsh 核心：`withSessionHeader` 的「无 sessionId 就不挂头」与 checkpoint policy 的
  per-request barrier 都是上游行为，我们只在自己的调用侧满足前置条件（或在 B2 下绕开）。
- 若最终落 B2，必须登记：路由键是**传输元数据**而非会话身份；`plugin-package-inventory-deepseek`
  这类按 `sessionId` 找 agent 的第三方插件会因为 `agents.get()` 取不到而跳过（当前行为不变）。
- `FLUSH_WAIT_MS = 90_000` 是共享常量（`src/shared/lifecycle.ts:10`），本批不调整它本身；
  若 B1-a 之后仍有别的路径依赖「整段 pass 被 flush await」，必须在 brief 里点名。**点名结果**：`src/` 里没有
  这样的路径（唯一读者是 `SessionWorkTracker.flush`，唯一写入者现在是 pass 的写阶段）；依赖它的是**两处测试信号**
  与「`agent/disposed` 的模型调用被 flush await」这一条语义，前者已按 §6 改写、后者已作为 B1-a 的代价登记。
