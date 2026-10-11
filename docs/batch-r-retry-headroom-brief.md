# 批次 R：重试头寸带上真实花掉的隐藏思考（第九次 pi triage）

出处：pi `099ebf3`（重试半边）。同批的另一半（`068b7e8` + `5783610`，命令等待提示）见 §8 —— 那一半在
dsh 的宿主侧**没有**通道，本次只记探测结果。

## 1. 缺陷

dsh 的整理（consolidation）在回复被输出上限截断后只重试一次，重试时把**扁平的**
`RETRY_OUTPUT_HEADROOM_TOKENS = 4096`（`src/shared/output-budget.ts`）交给 `fitMemoryInput`，而完全忽略这次
调用**实际花掉的隐藏思考**（`attempt.reasoningTokens` 一直只被用在失败文案里，`consolidate.ts` 原本只在
`cut off by the model output limit` 那句里读它）。

这条路径上真正决定成败的是：同一个 cap 里留给隐藏思考的 reserve **自己也封顶在 8192**
（`MAX_REASONING_RESERVE_TOKENS`），而推理型 route 可以花得多得多——pi 的现场案例
（Quantum_Matrix，2026-10-08）在第一次调用里花掉 **20489** token 思考，给可见回复只剩 11721，回复需要
约 33k，于是被截断；重试又只多要 4096，**被同一笔思考再截一次**，整轮 `lossy-refused` / 失败，而操作者
能做的只有「调大 `maxOutputTokens` 或缩短 MEMORY.md」——真正的近因是头寸没跟上。

入库判别器（先证明、后修）：`.agents/evidence/2026-10-11-batchR-retry-headroom/probe.mjs` 对修复前的
`lib/`（`68fcd9f`）打印 `requested cap 10032 -> 14128 (growth 4096)` 并 `exit 10`；修复后同一探针打印
`growth 20000`、`exit 0`。两份预期输出都留在该目录的 `README.md` 里。

## 2. 机制（改动面只有一处）

`src/project-memory/consolidate.ts` 的重试支（`if (!resolved && (attempt.stopReason === "max-tokens" ||
truncatedToolCall))`）现在把重试头寸算成

```ts
const retryHeadroom = Math.max(RETRY_OUTPUT_HEADROOM_TOKENS, attempt.reasoningTokens);
```

`attempt.reasoningTokens` 由 `src/shared/model-call.ts` 从流的 `TokenUsage.reasoningTokens` 记录，适配器
不报时为 `0`。`fitMemoryInput`（`src/shared/conversation.ts`）把这个 `extraHeadroomTokens` 同时计入两处：
`needed`（抬高请求的 cap，再由 `adaptiveOutputTokens` 向**模型自身上限**与 `max(configured, ceiling)` 双侧
钳制）与 `desiredReserve`（从同一个 cap 里留走，因而重试发送的输入更少）——这正是「重试要么要到更大的
cap，要么同一 cap 下少发内容」的由来，两条都算这个 reserve 真被扣了。

## 3. 与 pi 的差异（一处，有意）

pi 的形状是**两臂**：`usedInput = truncated ? fitMemoryInput(..., retryHeadroom) : fitted`，头寸只在
`stopReason === "length"` 时才带上。dsh 是**单支重试**，进入条件是一个析取
（`max-tokens` 文本截断 **或** 被截断的 tool call；后者由 `toolCallIsTruncated` 判定，即带 tool call 且
finish 为 `max-tokens` 或**空**——空 finish 是 dsh 的「没有终止流事件」哨兵）。本改动在该支内**无条件**
取 `max`，于是：

| 进入路径 | 修复前 | 修复后 | 与 pi 的关系 |
|---|---|---|---|
| `max-tokens` 文本截断 | 4096 | `max(4096, 观察值)` | 与 pi 的 `truncated` 臂同义 |
| 空 finish + 带 tool call（usage 报了思考） | 4096 | `max(4096, 观察值)` | pi 在 `truncated=false` 时**不动** input；dsh 给更多房间 |
| 空 finish + 带 tool call（usage 未报） | 4096 | 4096 | 无差异 |

第二行是唯一的语义差异，方向是**只会多给、不会少给**（`max`），且只在「没有终止事件却仍报了 usage」这种
组合下可见；登记为有意差异，不跟随 pi 的两臂写法，因为 dsh 这一支本来就总是重新拟合。

`max` 而不是三元（`attempt.reasoningTokens > 0 ? … : …`）是必要条件：**报告值小于扁平常量（含 0）时必须
保持 4096**，否则非推理 route 的重试房间会**变小**。第二个具名用例对报告 `0` 与 `1024` 两个取值都断言
`growth === RETRY_OUTPUT_HEADROOM_TOKENS`，正是把 `max` 与三元分开的判别器。

## 4. 改动面

| 文件 | 改了什么 |
|---|---|
| `src/project-memory/consolidate.ts` | 重试头寸改 `Math.max(RETRY_OUTPUT_HEADROOM_TOKENS, attempt.reasoningTokens)` + 说明注释 |
| `test/logic.test.mjs` | 2 条具名用例：带上观察到的花费；不向低于扁平常量的报告缩减 |
| `.agents/evidence/2026-10-11-batchR-retry-headroom/` | `probe.mjs`（`exit 10` → `0`）+ `README.md`（两份预期输出、边界） |

不改配置键、无新依赖、不新增 session 事件类型、两个 profile 无需改动；但**改了 `src/` 行为，需要宿主
重启才在线**（判据照旧：19387 持有者启动晚于最后一个 `src/` 提交）。

## 5. 验证（数字会过期：跑命令，不要引用这里的历史数字）

```sh
pnpm typecheck        # 0
pnpm build            # 0，lib/client.js 28575 字节（本批未动客户端）
pnpm test             # 全绿；本批新增 2 条具名用例
node .agents/evidence/2026-10-11-batchR-retry-headroom/probe.mjs   # exit 0
T=$(mktemp -d); node_modules/.bin/tsc --outDir "$T"; diff -rq lib "$T"   # 只多 client.js
```

变异轮（每个都按纪律 `tsc` 0 错、标记落进 `lib/` 已核对、`src/` 从 hash 校验过的 `/tmp` 快照恢复、
恢复后重建 0 标记、逐文件 `sha256` 复核 67/67）：

| 变异体 | 错误写法 | 结果 |
|---|---|---|
| M1 | `retryHeadroom = RETRY_OUTPUT_HEADROOM_TOKENS`（改回扁平） | 被杀：「带上观察到的花费」翻红（`caps 10032 -> 14128`），探针同时 `exit 10` |
| M2 | `attempt.reasoningTokens > 0 ? attempt.reasoningTokens : RETRY_OUTPUT_HEADROOM_TOKENS` | 被杀：「不向低于扁平常量的报告缩减」在 `1024` 那一格翻红（探针仍 0 —— 它只喂 20000 与 0，这正是第二个用例存在的理由） |
| M3 | `Math.min(8192, Math.max(...))`（按 reserve 上限截断） | 被杀：「带上观察到的花费」翻红（growth 8192 < 20000），探针同时 `exit 10` |
| M4 | `Math.max(RETRY_OUTPUT_HEADROOM_TOKENS - 4095, attempt.reasoningTokens)`（带上花费但丢掉常量） | 被杀：对照用例的 `0` 与 `1024` 两格都翻红，探针 `exit 11`（CONTROL REGRESSION）——同时证明探针的 11 码可达 |

探针的四种退出码都**实证**可达（0 = 现行树；10 = M1/M3；11 = M4；1 = 把第一次回包的 finish 改成 `stop` 的
`/tmp` 副本，打印 `FIXTURE FAILED: calls=1`），因此它的红既有名字也有出处，不会被读成通过。

## 6. 复核（独立只读子代理；结论 **NO BLOCKING DEFECT**）

复核在 `src/` 冻结、不许 build 的条件下重读了两侧源码（pi 当轮 `git fetch` 到 `origin/master`）并跑
`node --test test/*.test.mjs`（432 通过 / 0 失败）。它确认了三件事，其中一条是我此前没说准的：

1. **pi 那个三元其实是死代码**：`observedReasoning = truncated ? … : 0` 之后，重新拟合本身也被
   `truncated` 门着，所以 pi 一旦重新拟合就总是用 `max(4096, reasoningTokens)`——dsh 的单支无条件
   `Math.max` 在「finish 是 `max-tokens`」的所有路径上与 pi **行为等价**（§3 的 A / A′），唯一差异是 B
   （空 finish + tool call，见 §7）。
2. **对照用例确实是判别器**（三元、`min`、`R+obs`、`obs || R` 都会翻红），主用例也不是自证。
3. **它发现我三处该修的，都已修并复跑**：
   - 主用例的判据原为 `>= observed - 4096`（等价于「至少带上 79.5% 的花费」），`max(4096, obs-4096)` 这种
     部分携带的实现照样通过。该夹具的 ceiling 不 binding（cap₂ 30032 < 131072），故改成**等号**，
     并把「这是 pi 的界」这句不准确的注释改掉（pi 没有这条界，那是 pi **测试**的容差）。
   - 探针同病：同样改成等号，并把「探针会红在哪一档」写进 README（M1/M3 → 10）。
   - **既有的 `test/logic.test.mjs:4815` 注释在修复后成了假话**——它说重试多留
     `RETRY_OUTPUT_HEADROOM_TOKENS`，而那个夹具报的是 `reasoningTokens: 5000`，重试现在留 5000
     （两个 cap 都被 32768 的 ceiling 钳住，所以用例仍绿、错误只写在注释里）。已改成同时点名「扁平常量与
     花费取大者」。
   - 顺带修掉探针的一处**误归因**：`carries && control !== 4096` 原本打印缺陷句并 `exit 1`，把「对照回归」
     说成「重试还在用 +4096」——已各自命名、各自给码（`exit 11`）。

## 7. 边界与残留（**不要读成已修**）

- 探针是**脚本化**的：它证明算术与重试路径可达，**不**证明任何真实 route 会上报隐藏思考（dsh 只透传适配器
  `TokenUsage` 给的值，报 0 时行为与今天逐字节相同）。
- **更大的头寸会从同一个 cap 里多留走输入**（复核给出的实算）：`desiredReserve` 上界是
  `max(REPLY_OUTPUT_MARGIN_TOKENS, round(cap/2))`，所以 cap 32768、观察值 20489 时 reserve 落到 16384，
  重试发送的正文从 27648 字符降到 16384（约 41%）——**这是 pi 同样的取舍**，而重试真正的可见房间
  （`cap − 观察值`）没有变小，「少发」恰恰是重试要的（它被要求压缩）。被剪掉的字符仍由既有
  hidden-character 计数报告（`usedInput.memoryHiddenChars` / `clipped`），不是静默损失。
- **一处新暴露的失败窗口（复核 MEDIUM，本批保留并登记）**：因为 `观察值 ≤ cap₁`，重试请求的 cap 可以到
  约 `2 × cap₁`，而旧的扁平常量只会到 `cap₁ + 4096`。在「route 没有公布 `maxTokens` **且** 用户的
  `maxOutputTokens` 高于该 route 真实上限」这种窄组合下，重试可能被 provider 拒（`INVALID_REQUEST`，整轮
  抛错）而旧写法会被接受。文档化的 `max(configured, ceiling)` 上界没有被破坏，两个前提都少见，且 pi 有同一
  暴露；要不要把重试 cap 额外夹在「上一次被接受的 cap」还需要一个独立裁决（那会部分抵消本批的目的）。
- **路径 B（空 finish + tool call）是有意偏离 pi 的唯一入口**：`toolCallIsTruncated` 接受 finish 为
  `max-tokens` 或**空**，而 pi 在 `truncated=false` 时根本不重新拟合。usage 可以早于缺失的 finish 到达，
  所以这条路径上 `reasoningTokens` 可能非零，于是重试会为一个「不是 cap 造成的」原因多留头寸。复核读了两个
  已装适配器（usage 与 finish 成对，否则抛 `STREAM_CLOSED`）判定它**只具防御意义、没有已知生产者**；
  `llm-invariant` 那个伴生插件（会把静默结束变成错误）只挂在 `sdk-minimal` 组合里，本桌面宿主大概没挂。
- 只改了**重试**头寸；第一次调用的 reserve 仍封顶在 8192（`MAX_REASONING_RESERVE_TOKENS`），
  `output-budget.ts` 的注释里那句「past this, thinking is charged to the model's own budget rather than
  ours」仍然成立——本批没有动它。**注释的一处口径**：说「带上观察到的花费」指的是**传给
  `fitMemoryInput` 的参数**，不等于**最终生效的 reserve**（后者被 cap/2 饱和），复核要的就是这层区分。
- 批次 P 的裁决、批次 Q 的 Q2 残留都不在本批范围内。

## 8. 下一批入口：R 的通知半边（`068b7e8` + `5783610`）—— 探测结果

**探测的问题**：dsh 的命令面能否在 `await` 之前插一句话（pi 用 `notify(ctx, …)` 在
`/memory update` 与 `/autolearn` 的辅助调用前说「正在整理…推理 route 可能要几分钟」）？

**宿主侧答案：不行**。证据链（都是现读源码/现跑只读接口）：

1. `commands.register` 的 handler 返回值只有一个 `CommandResult`（`CommandResult = {kind:'success'|'error',
   text?}`），注册表在 `await` handler **之后**才 append `command/done`；`command/run` / `command/done` 都是
   **log-only、非 surface** 的事件（`packages/interaction/commands/src/{index,types}.ts`），中途没有任何
   surface 通道。
2. 现跑 `cordis_inspect_query`（host `Service` 目录）里没有 notification/notice/toast 类 service：唯一命中
   的 `announce` 是 `agents.announce`（session 启动来源）与 `sessions.announce`——后者的实现直接写着
   `was already announced`，是**创建期一次性**生命周期播音，不是给插件的中途提示面。
3. 客户端确实有一个 notice 面（`ui-commands` 的 `noticeFor` → `conversation.input.notify`），但它只由
   **客户端自己**的派发结果（admission 失败 / handler error，即 settle 之后）喂，宿主插件够不到。
4. 本仓库自己的纪律也堵死「宿主 append 一条可见消息」这条路：`test/logic.test.mjs` 的
   「no plugin source appends a custom session event」扫描要求 `src/` 与 `client/` 里 `.append(` 的命中为 **0**
   （下游事件类型不在 dsh 的 `KNOWN_SESSION_EVENT_TYPES` 里，一条就能让整份 session 不可加载）。
5. 内置的长时间命令 `/compact` 同样不吭声——不是我们漏了某个 API。

**但 dsh 本来就会显示「运行中」**：ui-chat 的 `GenericCommandCard` 对 `outcome === null` 渲染
`state='running'` + `t('command.running')`（`执行中…` / `Running…`）+ `TextShimmer`，所以 dsh 里「命令像卡死、
屏幕上什么都没有」这个前提比 pi 弱得多，缺的只是**命令专属的说明句**。

**探测发现的替代物（需要用户裁一次）**：ui-chat 声明了一个**按命令名 keyed 的客户端 slot**
`conversation.chat.commandview`（`slots.ts`：`kind:'keyed'`、`scope:'session'`、owner
`CommandRowOwnerProps = {node, compaction?}`，注释明说「Reusing a key replaces that command renderer」），
内置的 `/compact` 正是用它把运行文案换成 `t('message.compaction.running')`。占据 `memory` / `autolearn`
两个 key 就能给出命令专属的「正在整理记忆…推理 route 可能要几分钟」。

**代价（这是它需要裁决的原因）**：占据 key 会**替换**掉内置卡片，而 `GenericCommandCard`（75 行，含
`DisclosureRow`/`TextShimmer`/可展开多行输出/错误态/a11y 隐藏文案 + 两个 CSS module）**不在** ui-chat 的公开
导出面里（client 入口只导出 `apply` / `inject` / 类型与少数函数），所以要么复刻这张卡片（与 dsh 版本耦合、
将来 ui-chat 改了会静默漂移），要么写一个更简陋的命令行（settle 后的展示与内置卡片不一致）。两者都是**用户
可见 UI**的取舍，因此本轮只落重试半边，把这一条连同代价一起交给用户，而不是自行插队。
