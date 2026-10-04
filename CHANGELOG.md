# 更新日志

本仓库以 **`v0.1.0`** 作为首个发布（`package.json` 为 `0.1.0`）。更早的 `v0.1.0`/`v0.2.0`
标签因对应提交上的代码有误，已在本地与远端一并删除并作废。下面按插件记录变更，最新发布的
内容放在“未发布”之后；标注“修复”的条目都伴随一条**变异校验过**的回归测试（把修复改回
原样，测试必须失败）。

### 未发布（`v0.2.1` 之后）

**project-context（归档范围）**

- 修复：**委派的子会话会被逐个归档进项目**。`project-context` 是本仓唯一没有 `isTopLevel` 闸门的插件，而其余
  三个都在自己的生命周期点上拒绝 `origin: "subagent"`；子会话继承父会话的 cwd，于是每个 delegate 都往
  `.agents/memory/session-logs/` 写一份归档 + 一行索引。**2026-09-27 普查**（清理前那一刻）113 份归档里 67 份
  是子会话、来自 15 个父会话；这些原件保留在
  `/mnt/Data/Backups/dsh-project-context/session-logs-subagent-2026-09-27.tar.gz`，所以这个数字**永久可复核**
  （`tar -tzf <该包> | cut -d/ -f1 | sort -u | wc -l` → 67）。仍在增长的那份看 store：**每个会话目录取一份**
  日志头（v3 是旧格式、最新只到 2026-09-22，glob 只写 `session.v3` 会漏掉一半），数 `session` 头里的
  `origin: "subagent"`（**现查**：写这段时 70；注意这是「每目录一份」，不是「每文件一份」）。等价可粘贴一行
  （`2>/dev/null` 是给 `head -1` 提前关掉的管道静音，否则每个文件都会打一行 broken pipe）：
  `for d in ~/.dsh/sessions/<encoded-cwd>/*/; do f=$(ls "$d"/session.v*.jsonl.zstd 2>/dev/null | sort -V | tail -1); [ -n "$f" ] && zstdcat "$f" 2>/dev/null | head -1; done | grep -c '"origin":"subagent"'`
  比「200 行索引上限」更利的是：autolearn 实际只读**最新 50 条**（`MAX_INDEX_ENTRIES`），
  而那 50 条当时已被子会话占据多数——索引是它的证据面，这不是理论上的远期风险。现在四个产出写入点
  （`session/event` 的 `turn/end`、`agent/status` 的 idle、`agent/disposed`、`session/disposed`）都过闸门；
  `agent/created` **故意不闸**（它只填进程内的项目根缓存并跑一次 `git rev-parse`，不产出任何文件）。
  `session/disposed` 即使被拒也照旧调用 `releaseSessionQueue`——**不是**死代码：那几张按 session 键的光标表
  只由真写入填充，闸门挡住了所有自动路径，但**未设闸的 `/session-log now` 命令**会用同一个 key 填它，这条释放
  正是为那种情况留的（若哪天连命令也设闸，这行才真的可删）。
  **非目标**（已写进源码注释）：`/session-log now` 与 `import` 这两个显式命令不设闸——显式命令就是用户在要求，
  与 `archiveEnabled: false` 的既有文档一致，所以子会话的属主手敲命令仍会写它自己的目录与索引行。
  变异校验：四个闸门**各自**拆掉 → 各掉 1 项，且都正好只掉对应事件的那条断言（`session/event`、`agent/status`、
  `agent/disposed`、`session/disposed`；其余三个插件的用例仍绿）。独立审核另在 `lib/` 副本上做了两个变异体：
  闸门恒拒 → 掉**正对照**（证明负例不是「本来就不会发生」）；`apply` 顶部直接 `return` → 新用例红（所以它
  不是空转就过）。`tsc` 0、`isTopLevel` 使用数 4→3 的 marker 落在 `lib/`。
- 修复：**`archiveEnabled: false` 时 `session/disposed` 仍会写归档与索引行**。四个自动写入点里只有它不查这个开
  关，于是「关掉归档」之后，会话在 dispose 时照样产出 `session.jsonl` + `session.md` + 一行索引——与
  `README.md` 的「关掉后不再自动写会话存档与索引」以及客户端提示「关闭后不再自动写 session.jsonl /
  session.md / INDEX.md」都相反。现在它和其余三个点一样先查开关；两种拒绝（子会话 / 开关关闭）都仍然调用
  `releaseSessionQueue`（理由同上）。显式命令 `/session-log now`、`import` 不受影响——那正是文档承诺的逃生口。
  变异校验：拆掉这条检查 → 掉 1 项，正是 `session/disposed: archiving is off, so nothing may be written
  automatically`，其余用例仍绿。
- 注意：闸门**不回溯**存量；那 67 份子会话归档属**本地数据**（`session-logs/` 未跟踪），已按本轮单独清理
  （先备份到仓外、校验后删除，再用插件自己的锁 + 原子写重写索引；清理那一刻 46 行与磁盘一致、0 悬空）。清理
  依据：这些 id 在 tracked 文件里**零引用**。
  **但闸门要宿主重启才加载**：清理之后、重启之前仍在跑的旧构建会继续归档子会话——实测备份后 22:10:01 就又有
  一个审核子会话落进 `session-logs/`，所以「46 行 / 0 子会话」当天即失效。**重启后应重跑一次清理**：脚本与
  备份放在一起，`/mnt/Data/Backups/dsh-project-context/purge-subagent-archives.mjs`（幂等，备份名带 UTC 时刻、
  拒绝覆盖）。
  索引里的旧标题也顺手清了一个：`01a09863` 原来存的是 119 字符的截断标题（同一标题的前缀，清理前实测），已用
  `queueIndexLine` 走真写入路径重推成完整的 160 字符；`01a095f7` 的 `DSH Project Context — Initialization`
  是**从 pi 旧索引采用来的真标题**（该会话是 pi 格式、归档里没有 `session/title`），重推只会把它降级成首条
  用户消息，故**故意保留**。

**project-context（会话索引）**

- 修复：`INDEX.md` 的**标题兜底**会把 handoff 自己注入的**续接提示**当成会话的首条用户消息。dsh 的 prompt RPC
  不带 source kind，pi 的归档也把它的 seed 存成同样的 `user` 角色消息，两条路径都认不出来：实测本机归档
  （**现查** `ls -d .agents/memory/session-logs/*/ | wc -l`，别沿用数字）里 `01a09821`（2026-09-13，pi 格式）
  的标题被 11,384 字符的 pi 横幅占掉，而它第一条真人消息是「旧的删掉，继续」。现在兜底跳过 handoff 生成的
  提示——dsh 侧用既有的 `isHandoffContinuationText`（跨插件引用，不复制第二份规则），pi 侧用与其同构的
  三件套（前缀 + 专属章节标题 + 收尾行；源码在 pi `8b300dc` 的 `extensions/project-context/handoff/language.ts`
  的 `isHandoffPromptText`，pi 是另一个仓库、不是本插件的运行时依赖，所以只能复刻）。**合取才是判别器**：只
  匹配前缀会把「引用/转述了提示」的真人消息也吞掉，因此测试钉住两个方向与三个部件——引用提示仍算用户消息；
  前缀 / 专属标题 / 收尾行各有一条断言，缺任一就不再是提示（前缀那条是独立审核的变异体发现的缺口：删掉前缀
  检查原本**全绿 11/11**，因为其余 fixture 都还带着前缀，而「从 `## Handoff Summary` 起、以 pi 收尾行结尾」
  的粘贴全是普通英文，所以那个缺口可达、不是纸面问题）。
  变异校验：守卫恒假 → 掉 1 项（新用例）；去掉 pi 的收尾要求 → 掉 1 项（正是那条判别断言）；去掉前缀检查 →
  掉 1 项（审核后新补的前缀断言）。
- 注意：这个修复**不回溯存量**——`import.ts` 对已存在的归档返回 `skipped`，且那一步早于写索引，所以已归档
  会话的错误标题不会自愈，要单独重写那一行（本机那行已用导出的 `queueIndexLine` 走真写入路径改掉）；别把
  「存量标题会自愈」说成这次代码改动的效果。（严格说只对 `session.jsonl` + `session.md` 都在的归档成立；
  少了 `session.md` 的会走 `created` 路径、重导入**会**重写那一行。）另外 `sessionTitleFromEntries` 现在也会
  跳过**本仓**的续接提示（dsh 侧），虽然实测 dsh 归档**全部**带 `session/title`（**现查**，别沿用数字）、
  兜底在那条路径上不可达。

**handoff**

- 修复：`/handoff status` 的**质量膝**拒绝只给了「把 baseline / keep 调小」这一根杠杆，而 baseline 不是用户
  能调的设置（没有任何 config key 喂它，它由测量推出）——这一半的建议用户做不到，能执行的那一半只有 `keep`。
  同文件的 `thresholdOverrideText` 早就点名过 `/handoff 0.4`，这条回执却没有。现在补上「显式比例不经过膝检
  查，而膝正是这里的阻塞项」——**只讲机制、不讲落点**：膝曲线与 `0.4W` 的交点（当前常数下 ≈ 488K）以下，
  0.4 的触发点其实落在膝**之下**（W=450K 实测膝 303500、0.4 触发点 180000），所以写成「auto 能在膝之上启
  动」是假话，那条断言因此是**否定式**的，并把该 W 的 fixture 一起钉住。
  变异校验：把措辞改回「so auto can start past it」→ `tsc` 0、措辞已进 `lib/`、掉 1 项（新的否定断言）。

- 修复：**自动交接在本机永远不会触发**——`resolveThreshold` 恒返回 `undefined`，而回执把它归因成质量膝。
  根因是**跨计量基准相减**：`floor = max(0, totalTokens − surfaceTokens) + keep + MIN_SUMMARIZE`。dsh 的
  `token-meter` 只报两个数，而它们基准不同——`totalTokens` 锚在路由 provider 报的 `usage` 上，`surfaceTokens`
  由固定密度启发式定价（`estimate.ts` 的 `CHARS_PER_TOKEN = 4`；只有图片/文件走路由定价）。所以那个差值是
  **真开销 + 密度误差**：真机一次测量 `495117 − 231793 = 263324`，而同一次请求里 dsh 自己定义的「信封」只有
  工具 schema 的 `42845`（`estimateToolsTokens` 的注释明说 system prompt 是 surface 节点、信封只有这一个计价
  字段）——即 **220479 全是误差**。中文约 1 字符 = 1 token 而启发式按 4 字符/token，误差随对话**线性增长**，
  于是 `floor = 263324 + keep + 8000` 永远压在 `knee(1M) = 157000` 之上：`resolveThreshold` 返回 `undefined`，
  自动路径在 `auto.ts:42` 静默退出——**不是「还没到」，是结构上永不触发**；而 `/handoff status` 会给出一句算术
  为真、杠杆指错的 `quality-knee`（作者自己的注释就承认「a smaller baseline 不是用户能调的设置」）。
  现在**插件不再自己合成信封**：`ContextMeasurement.overheadTokens` 由 harness 已有的 projection 读出——
  `ctx.sessionProjections.snapshot(session, ['contextBreakdown'])` 返回的
  `{ systemTokens, toolsTokens, messageTokens }` 就是「prompt 由什么构成」的官方答案，`systemTokens + toolsTokens`
  即信封（`runtime.ts` 的 `projectionEnvelope`，`measuredContext` 是 auto 路径与回执共用的唯一入口）。
  `HandoffRoom.baseline` 随之改名为 `overhead`，`handoffRoom` 与回执共用同一份 `thresholdFloor`——那条规则原先
  写了三遍，且已经漂移过一次。该 projection 在本机**正在跑**——现查要走**最新被写入的那个 cache 根**
  （`grep -l contextBreakdown "$(ls -dt ~/.dsh/storages/session_projcache*/sessions | head -1)"/*.json | wc -l`）：
  域名带变体/版本后缀，**别写死**，同级还留着一份升级前的旧根（末次写入 2026-09-25），把旧路径写进文档就等于
  拿旧文件冒充活体证据。GUI 的上下文面板读的也是它；projection 缺失或值畸形时信封为 `undefined`（floor 退回
  `keep + 8K`），而不是猜一个数。**别拿投影缓存去验信封的字段形状**：缓存行存的是 projection 的**状态**
  （`{nodes, breakdown}`），`sessionProjections.snapshot()` 返回的是它的 **wire view**——即
  `{ systemTokens, toolsTokens, messageTokens }`（0.1.7-rc.2 源码：`breakdown-projection.ts` 的
  `wire: { viewSchema: breakdownSchema, view: state => state.breakdown }`，`session-projection/src/index.ts` 的
  `snapshot()` 走 `viewCell(...)`、冷读 `viewCheckpoint()` 走 `viewSchema.parse(view(state))`）；在缓存里看不到
  顶层 `systemTokens` 不是缺陷。活体验证（**它比任何推算都强，而且早于本轮**）：2026-10-02 22:06:45 本仓父会话
  `4cdeb0b9` 在一次真实 `turn/end` 上触发了 auto 交接——后继 `dfa432f0` 的 `createdAt` = 22:06:54、`cwd` 为本仓、
  首条用户消息即交接横幅且 `source.kind` 为 `dsh-project-context`，而父会话那份 1406 行日志里**没有一条 `command/run`**
  （所以走的是 auto 路径，不是 `/handoff now`）；宿主 22:02:11 启动、`lib/` 为 21:56 那份，即带本修复的构建。修复前
  `floor = 263324 + keep + 8000` 恒高于膝，auto 路径**结构上不可能**触发，所以「它触发过一次」本身就是「修复已加载」
  的判据。**别再把实测写成待办**：它已经真实发生过；钉子有两枚——后继的 `createdAt`，与它首条 `user/message` 的
  `source.kind`（`~/.dsh/sessions/<encoded-cwd>/session-<id>/`）。2026-10-03 08:11:30 又独立发生一次：`bd1b383f` → `046c6acb`
  在同一判据下 auto 触发（父会话同样无 `command/run`、后继 `session/title` 为 `↪ handoff · bd1b383f`），宿主 07:57:35 启动、`lib/`
  为 07:36 那份，即**含 `envelopeSource` 的构建**。2026-10-03 09:28:25 的**第三次是链式的**：由交接横幅
  开启的 `046c6acb` 自己也在一次真实 `turn/end`（`reason.kind` = `completed`）上 auto 交接出 `d01598e7`——
  父会话末条 `assistant/message` 的 `data.usage.totalTokens` = 244045 / 窗口 1M（膝 157000）、整份日志里
  **零条 `command/run`**，后继 `session/title` 为 `↪ handoff · 046c6acb`；宿主就是**当前在跑**的 pid 4702
  （09:11:09 启动），所以「正在服务本 GUI 的宿主是否已加载本修复」不必再靠启动时间推算。另：auto 只在 `turn/end` 评估、无定时器，故已超阈值却不再结束回合的会话不会 auto 交接
  ——`3b278dd2`（nixos）与 `ae629225`（DSH-AV）就是这样，两者于 2026-10-03 08:00 被用户手动 `/handoff now` 退休。
   诚实边界：`quality-knee` **仍然可达**，但只剩用户自己那一条路——`handoffKeepTokens` 上界 200000
   （`config.ts`），1M 窗口下现查 `keep=149000` 解析、`keep=149001` 拒绝（`/handoff keep 200k` 的真实命令解析器
   也接受）；harness 将来报出信封同样可达。回执因此按「`keep` 能否清掉膝」分别给词：能清时点名 `keep`，不能
   清时**不再**把一个不起作用的 `keep` 说成杠杆（那是旧 “a smaller baseline” 的同一种病），只推 `/handoff 0.4`。
   而「值不值得折」这件事仍留在唯一能精确回答它的地方——`maybeAutoHandoff` 拿真实的
   `handoffSplit` 比 `MIN_SUMMARIZE_TOKENS`（该检查本来就在 `auto.ts:61`）；threshold 层那份是同一规则的
   第二份、且基准混用的副本，按本仓「重复规则是根因」的既有裁决删掉——`handoffRoom` 现在直接调
   `thresholdFloor`，可行性判定与回执共用同一份 floor。
  行为翻转（**旧断言建立在假拒绝上，已改写**）：原先被钉成拒绝的 `W=40000 / keep=0 / total 11800` 现在解析为
  `19616`（窗口的 49%），该 fixture 刻意保留非零的 `totalTokens − surfaceTokens`，否则旧公式会算出同一个数、
  断言就成了空转；`heavy = {total: 512000, surface: 0}` 那条「重 baseline 压过膝」的 fixture 改为显式
  `overheadTokens: 200000`（信封必须来自 harness）；回执里的 “a smaller baseline” 与 “context assembly 0 + …”
  一并去掉。
  变异校验：把根因原样放回（`overhead = totalTokens − surfaceTokens`）→ `tsc` 0、marker 进
  `lib/project-handoff/threshold.js`、掉 2 项（回执用例 + composition 用例，后者含 W=40000 与「真机 CJK
  形状必须解析」两条）；`sha256sum -c` 恢复、重建后 `lib/` marker 0、门禁 0/0/242。

- 修复：**`/handoff status` 对「信封读没读到」是盲的**——上一条把 floor 修对了，但回执仍无法证明这次
  `contextBreakdown` **解析成功**。回执里那句 `threshold auto <n>` 在读到与读不到时是**同一个字符串**：1M 窗口 +
  默认 `keep` 20000 时，带 45_000 信封是 `73000`、退回 `keep + 8K` 是 `28000`，而膝 `157000` 两者都压得住，于是
  都解析成 `auto 157000 (16%)`。当时只能靠推算回答「投影到底读到了没有」，而推算不是回执的义务。现在
  `measuredContext` 一并报出信封**来自哪次读取**（`MeasuredContext.envelopeSource`：`"projection"` = harness 的
  `contextBreakdown`；`"meter"` = meter 自己给的**同一个量**），回执据此渲染三态之一：
  `harness envelope <n>` / `meter envelope <n> — not the harness composition` / `harness envelope unavailable —
  no contextBreakdown projection`。归因落在 auto 路径与回执共用的那个唯一入口上，所以不会出现「值对、出处错」——
  这正是本仓「错误归因比静默降级更糟」那条判定类缺陷的一个新实例；meter 给的信封被单独命名，是因为它数值上等价、
  来源上不等价。
  变异校验：把回执那行替换成一个常量 → `tsc` 0、特征串已从 `lib/project-handoff/command.js` 消失、掉 1 项；把归因
  恒等于 `"projection"`（即把 meter 的来源也说成 harness 的）→ `tsc` 0、掉 1 项——同一个新用例里两条断言各自可达。
  `sha256sum -c` 恢复、重建后 `lib/` marker 0、门禁 0/0/243。

**project-memory / project-autolearn（人类轮次判定）**

- 修复：**handoff 横幅被当成一个人类轮次，也让 `firstUserText` 以横幅作答**。dsh 的 prompt RPC 不带 source
  kind，宿主把 seed 一律写成 `{kind:"user", rpcId}`，于是 `userTurnCount` 声称的「plugin-injected user-role
  context does not count」在每个交接子会话上都不成立：每个子会话的轮数 +1，autolearn / consolidation 的轮次
  闸门因此比人真正驱动的**早一轮**。`firstUserText` 更直接——它喂 `fallbackUpdate`，那条兜底摘要存的是横幅
  开头（经 `clip(…, MAX_SUMMARY_CHARS)` 截断），而不是人开口说的第一句。现在两者共用一个判别器
  （`humanUserText`），复用既有的 `isHandoffContinuationText`（跨插件引用，不复制第二份规则；与 `INDEX.md`
  的标题兜底是同一个谓词），只跳过 handoff 自己生成的**完整**续接提示。
  实测本机归档（**现查** `ls -d .agents/memory/session-logs/*/ | wc -l`；下面只记当时那一刻的量级）：读到的
  39 份 dsh 归档里 **37 份**被横幅多算一轮、**37 份**的 `firstUserText` 就是横幅；修复后各 0。其中 10 份
  子会话只有横幅、没有真人首条消息，`firstUserText` 因此返回空串、兜底摘要回到「Session recorded without a
  model summary.」——这是「没有人类首条消息」时的正确取值，不是新缺陷。
  变异校验：把跳过改回「恒不跳过」（保留符号引用，避开 `TS6133` 的伪红）→ 掉 4 项（单元 3 条 + autolearn
  轮次闸门 1 条，即两个消费点各有一条钉子）；再把判别器**放大**成「含 `<handoff>` 就跳过」→ 只掉 1 项，正是
  「引用 / 扩写了横幅的真人消息仍算人类轮次」那条负对照（所以该负对照承重）。
- 修复：**交接 seed 借用人类的 `user` 身份**，于是一个非人类生产者持有「直接人类授权」。交接子会话的第一回合
  里，`create_goal` / `update_goal` 的 `edit|pause|resume` 都会被横幅授权。判据在宿主侧：dsh 的
  `packages/goal/tool-goal/src/authority.ts` 的 `hasDirectHumanInput` 就是「当前 root-agent 回合内存在
  `type === "user/message" && data.source.kind === "user"` 的事件」（0.1.7-rc.2 现查），而上游那段注释自己
  写明了契约：「非人类生产者必须自带 source，而不是继承这份权威」。
  根因是**投递路径**而非措辞：seed 走 `sessionController.prompt`，而 `SessionPromptRequest` 只有
  `requestId`/`sessionId`/`mode`/`content`/`clientTimeZone`、**没有** source 字段，宿主一律补
  `{kind:"user", rpcId}`（`api/session-controller/src/commands.ts` 现查）。现在 seed 直接投进子 Agent 的收件箱、
  带本插件自己的 kind：`agents.get(childId).followup(pluginUserMessage(prompt))`，其中 `pluginUserMessage` 是
  `shared/model-call.ts` 早就为辅助模型调用建好的那一个（其注释原本就写着「kind 不能是 `user`」）。RPC 自己也是
  这么投递的（同文件里的 `agent.followup(message)`），所以换掉的只是 source。
  **因此 `userTurnCount` / `firstUserText` 现在按 kind 就看不到 seed**，读侧那层结构识别退回为对**旧日志**与
  pi 归档的兜底，而不是唯一防线。
  诚实边界：这条投递换掉了 RPC 层，随之丢掉的是它的内容校验（prompt 从不为空）与错误翻译；但**不是**丢
  `requireModel`——那个属于 `session/selectModel`，`carryModelSelection` 照旧调用它；也**不是**丢
  `hasPromptRequest` 幂等——它只匹配 `kind: "user"` 且复用同一 `requestId` 的消息，而每次尝试都新铸一个 id，
  对本 seed 从未生效过。`signal` 也不再传给 seed，但该调用现在是同步的，没有可取消的等待窗口。非驻留的子会话
  **不回落**到 RPC（回落会静默恢复这份人类授权），而是让交接响亮地失败。
  变异校验：让 seed 重新带上 `kind: "user"` → `tsc` 0、marker 进 `lib/`、掉 2 项（两条新钉子）；把「非驻留」
  改成静默 `return`（跳过 seed）→ 掉 1 项（正是那条响亮失败断言）。另有 **11 条既有用例**在同一批里从
  `controller.prompt` 迁到 agents 收件箱，它们的调用序列断言（`["create", "seed"]`）因此**同时钉住
  `perform.ts` 走的是哪条投递路径**——那些 fixture 的 controller 已不再提供 `prompt`，改回去会当场红。

**project-memory（CONTEXT.md 的固定 schema 与截断标记）**

- 修复（自 pi 移植，批 A）：**被裁的 `CONTEXT.md` 与完整的一份无法区分**。渲染器先按「丢列表项」逼近
  `MAX_CONTEXT_CHARS`，仍超就返回 `document.slice(0, MAX_CONTEXT_CHARS)`——一次裸 `slice`，没有任何标记；而
  `MEMORY.md` 早就有 `_[memory truncated at <limit> characters: <dropped> dropped]_`。于是「这一节被裁掉了」
  这件事只存在于某个人的记忆里。现在布局与预算都由一张表驱动（`src/project-memory/context-schema.ts` 的
  `CONTEXT_SECTIONS`）：固定占位（表头、时间戳行、三个标题、trailing comment、最坏情况的标记）先由
  `contextSchemaOverheadChars()` 预留，余量按每节 share 分（Summary 0.4 且仍受 `MAX_SUMMARY_CHARS` 硬顶、
  Key points 0.35、Open tasks 0.25），每节按**行边界**裁剪并把真实掉落量累加进
  `_[context truncated: <dropped> characters dropped]_` 追加在文末。
  标记只从**最后一个非空行**读（`contextTruncationDropped`）：渲染器永远把标记追加在最后，所以某一节里
  一句长得像标记的模型输出不会被误判成真裁剪。掉落量包含**每一处**损失——超预算裁掉整项、单条超过
  `MAX_LIST_ITEM_CHARS` 的 trim、以及 `MAX_LIST_ENTRIES` 条目的截断——所以标记报的是真损失而不是预算损失；
  兜底摘要（`fallbackUpdate`）也不再预先 `clip`，它的损失同样由标记报出。
  同一张表还生成 consolidation prompt 里的节清单与预算（`- ## <heading>: <description> (about <chars>
  characters)`），渲染器与 prompt 从此不可能各写一份而漂移；prompt 另加一条**禁止把截断标记写回产物**的
  规则（模型抄走标记会让一份短的渲染看起来像被裁过）。裁剪发生时，pass 另按项目记一次
  `CONTEXT.md was clipped (…)` 日志，点名是三条 clamp 里的哪一类。
  顺带：`clipToLineBoundary` 现在不会留下**孤立高代理项**（半对 surrogate 无法再被 provider 编码），单条
  800 字符的 trim 与 160 字符的标题 trim 都走它。
  变异校验：让渲染恒不追加标记 → `tsc` 0、marker 进 `lib/`、掉 4 项（summary 精确计数、列表计数、逐条 trim
  计数、兜底摘要计数）；把标记改成从**第一个**非空行读 → 掉 2 项（尾行策略那条 + 超预算渲染的标记判定）。
  全量门禁 `pnpm typecheck`/`pnpm build`/`pnpm test` = 0 错 / 0 错 / 258 pass 0 fail，`lib/` 变异标记 0。

**project-memory / project-autolearn（prompt 里写的是被强制执行的边界）**

- 修复（自 pi 移植，批 C）：**两个 prompt 都在说「词」，而代码按「字符」执法**。consolidation 规则写
  `below 6000 words`，autolearn 规则写 `below 3000 words`；而写入路径分别在 `maxMemoryChars` 字符处截断
  memory、在 `MAX_SKILL_BODY_CHARS`/`MAX_SKILL_DESCRIPTION_CHARS` 字符处截断技能正文与描述。一条回复完全
  可以满足词数提示却仍在字符处被切——按 pi 那条提交的话说，被切掉的是**文末的内容**，而模型无从知道。现在
  consolidation 的 cap 由 `memoryBudgetRule(maxMemoryChars, currentChars)` 按**每个项目真实的 cap 与当前体量**
  生成（硬上限是字符数、不是词数，超出的内容写入时被丢弃），autolearn 的两条规则直接写
  `MAX_SKILL_BODY_CHARS` 与 `MAX_SKILL_DESCRIPTION_CHARS` 的数值（并说明两者都会在写入时被截断）。
  顺带**核过并明确不动**：`project-handoff/summary.ts` 的 `Keep it under 900 words` 不属于这一类——handoff
  文档**没有**任何字符上限（唯一约束是模型输出预算，且被切的回复是响亮失败），所以那句是风格指引而非被代码
  反驳的边界；已在 `test/prompt-bounds.test.mjs` 的文件头记录为非目标。
  变异校验：把 `memoryBudgetRule` 改回词数提示（保留两个参数引用，避开 `TS6133` 的伪红）→ `tsc` 0、marker 进
  `lib/`、掉 1 项（正是那条 cap 断言）；把 autolearn 规则改回 `below 3000 words` → 掉 1 项（两条 prompt 的
  边界断言）。全量门禁 0 错 / 0 错 / 261 pass 0 fail，`lib/` 变异标记 0。

**project-memory（模型调用期间落地的外部编辑不再被回复覆盖）**

- 修复（自 pi 移植，批 D）：**基于陈旧读取构建的回复照样被发布**。pass 先读 memory、再据此让模型写回复；写入
  路径无条件追加那份回复。于是「模型调用期间有人手改了 `MEMORY.md`」这件事的结果是：编辑被**采纳**进 journal，
  紧接着被同一次调用基于**编辑前**读取构建的渲染**覆盖**——「adopted」只意味着「进了历史」。现在 pass 把 prompt
  的基线作为 `basisKey` 带走（`ConsolidationOutcome.basisKey`），写入时若盘上的 memory 已不是那份基线，回复
  **不发布**：更新的字节留在原地并进 journal，下一次 pass 从它继续。两条拒绝路径都保留更新的字节，检查与追加
  之间的窗口由导出的谓词 `nextRenderSupersedes` 关闭；`recordMemoryDocument` 返回
  `{written:true} | {written:false, kept}`，调用方按**实际落地**而不是按尝试来认领（`wroteMemory` /
  `wroteContext` 分开），`/context-update` 的回执因此新增 `stale` 与 `stale-context` 两种说法——**任何一条都
  不再声称 memory 被重写**，日志也只点名真正更新的那份产物。不传 `basisKey` 的调用方（遗留 `.omp` 导入、既有
  用例）行为与之前逐字节一致。
  变异校验：把第一条拒绝恒关（`MUTANT_NO_STALE_REFUSAL`）→ `tsc` 0、marker 进 `lib/`、掉 1 项（模型调用期间
  的编辑被覆盖那条）；让 `nextRenderSupersedes` 恒返回 false → 掉 1 项（谓词表）；把 `wroteMemory` 改回「只要
  有回复就算写了」→ 掉 1 项（**收据**那条：被保留的 memory 不许被报成 `project memory and context updated`）。
  全量门禁 0 错 / 0 错 / 265 pass 0 fail，`lib/` 变异标记 0。

**project-memory / project-autolearn（工具化：`record_memory` / `record_skill`，MEMORY.md 四节预算制）**

- 新增（自 pi 移植，批 B；**含一条破坏性命令变更**）：**整理与技能蒸馏不再依赖「回复里必须是那个 JSON」**。
  两个 pass 现在把结果作为一次工具调用提交（`record_memory` / `record_skill`），JSON 文本回复降级为回退入口，
  两条入口共用同一套解析与渲染。MEMORY.md 也从「一整份自由格式 Markdown」变成**固定四节 + 每节预算**：
  `Project` 0.2 / `Invariants` 0.4 / `Pitfalls` 0.25 / `Index` 0.15（`src/project-memory/memory-schema.ts`
  的 `MEMORY_SECTIONS`，布局占位先由 `memorySchemaOverheadChars()` 预留，余量按 share 分）。写入由
  `renderMemoryDocument` 按节执法：每条先按该节的单条上限裁（`clipToLineBoundary`，不留半对 surrogate），
  放不下就**整条丢弃**并返回 `sectionDropped` / `droppedItems` / `itemTruncated` 三个计数——不再靠整份文档的
  60/40 剪切，那正好切在本项目放运维教训的中段。渲染器**不写**截断标记（写入路径会再剥一次），掉落通过计数
  报出：pass 记一次每项目日志，且只对**真正落地**的那次写入（`snapshot.written`）记。
  两条入口进库前都要过「空骨架」闸门——结构化入口用 `sectionsSemanticallyEmpty`（`[""]`/`[" "]`/零宽字符
  都算没内容），不透明入口用 `isHeadingOnlyDocument`（标题/围栏/frontmatter/setext/HTML 注释/标签包装都算
  骨架）——所以一份只有标题的回复再也无法把已存的 memory 换成骨架；写入判定因此从「长度 ≥ 40」改成
  `!outcome.semanticEmpty && …`。
  **工具面**：`GenerateOptions.tools` 直接转发（不提供工具时**省略**该字段而不是传空数组，所以没有工具的调用
  方请求逐字节不变）；流里按块装配工具调用（`block-end` 优先于 `tool-call-delta`，因为首块才带 name）。
  dsh 的适配器把工具参数以**文本**流式送达（pi-ai 给的是已解析对象），所以 `pickToolCall` 拿回原始参数字符串、
  由 `parseToolArguments` 解码。**被输出上限切断的工具调用一律不接受**：适配器会把截断的参数串修成形状合法的
  对象，「有工具调用」并不证明内容到齐；内存侧与技能侧都改成一次**不带工具**的文本重试。调用了别的工具又没
  文本是**错误**而不是「模型什么都没提」。
  consolidation 的 prompt 现在优先要工具、保留 JSON 回退措辞，并按 `memorySectionRule(maxMemoryChars)` 逐 pass
  生成四节与其**字符**预算（照旧不出现词数提示）。
  **技能侧**（`record_skill`）：新增 `src/project-autolearn/schema.ts`；「不提技能」在工具 schema 里由空 `name`
  表达（严格 schema 无法表达 `null` 成员），两个入口共用同一个 `shapeProposedSkill`。
  **命令面（破坏性）**：`/context-update` 改名为 **`/memory update`** 并**删除**、不留别名；pi 能直接删是因为
  它那边 `/context-update` 只是 `/memory-learn` 的别名，而 dsh 里它是唯一的强制整理入口，所以先把动词做出来
  才敢删旧名。客户端提示与 README 同步。
  **相对 pi 的有意偏离**（记录在案，不是遗漏）：工具的回溯字段仍叫 **`need_sessions`**（pi 同批改名 `inspect`，
  而本仓 prompt/parser/测试早已用 `need_sessions`）；**不带 `constrainedSampling`**（dsh 的 `ToolSchema` 只有
  `{name, description, parameters}`，没有可携带的严格模式标记，schema 改为**构造上严格**）；**没有移植**
  pi 的 `callAux` 固定「无工具」回退（路由拒绝 `tools` 时 dsh 按普通失败退避并记录，本机实际路由已验证接受
  工具）与 `needsCondense` 二次模型调用（dsh 保留原有 `max-tokens` 重试，掉落由计数上报）。
  **2026-10-05 补记**：上面「没有移植 `needsCondense`」这一半**已不再成立**——**档 C 实现了它**（一次定向重试，
  携带与 pi 同义的压缩指令；触发面是本批渲染计数的超集）。差别只在失败策略：pi 采纳干净的压缩回复、否则**保留
  有损首答**并让上限报告说话，dsh 则**拒绝落盘**（`MEMORY.md` 逐字节不变，状态 `lossy-refused`）。档 B 的两条
  未移植项现均以「已决定不移植」收口：`callAux` 无工具回退缺的是**可观察的失败码**（harness 确有
  `HarnessError.code` 与 core 的可重试码集，但本机没有任何可达路由会拒绝 `tools`，且本插件的包装把 finish 里的
  码拍进了消息文本）；autolearn 的「先重试再读」则是因为文本解析器 fail-soft（不可解析即 `{skill:null}`），
  先读会把被截断的回复误报成「没有新技能」。逐条现状与证据在 `docs/upstream-pi-triage.md`。
  **2026-10-05 二次补记**：上一条把两条残余写成「已决定不移植」，**两条的理由都不成立**，已在
  `docs/batch-b-residual-decisions.md` 重新裁定（该文档不改代码；两条现为「已裁定、待实施」）。`callAux` 无工具回退缺的
  **不是**可观察的码——tools 被拒就是 provider 400，本仓可走的两个 adapter 都把它映成同一个码 `INVALID_REQUEST`
  （`llm-deepseek/src/transport.ts`、`llm-pi-ai/src/stream.ts` 的 `classifyPiAiError`），而 pi 自己根本不 key 这类码：
  `toolsFallbackApplies` 是**负向 fail-open**，只用消息正则排除 auth/quota/transient。真正缺的接缝只有一条：本插件读到
  `failure.code` 后把它拍进消息文本就丢了，而 dsh 自己的 `HarnessError` 契约要求按码路由、不要解析消息。现决定按请求形状码
  回退（仅一趟里**首次**带工具的调用、一次性、其后整趟不带工具），并用脚本化流验证，不需要真有一条会拒 `tools` 的路由。
  autolearn 的「先重试再读」同理：它不是契约性质，而是缺「是否解析成功」这一信号——`parseJsonObject` 本来就知道（不可解析
  给 `undefined`），是 `parseAutolearn` 把这个区分丢掉了。探针
  （`.agents/evidence/2026-10-05-autolearn-cut-parse-probe/`）：裸 JSON 的任何切点都解析不出（该重试的地方照旧重试），而
  有围栏或尾部散文时的 137 个可解析切点**全部**携带完整正文，故「解析成功即内容完整」；危险的一半仍在工具调用路径
  （adapter 会修复被截断的参数串），保持不变。
  **本仓自己的 `.agents/memory/MEMORY.md` 当时仍是自由格式**：迁移必须在**新代码活体**之后做（宿主重启前，跑着的
  旧构建仍会写自由格式并把它改回去），见 `CONTEXT.md`。
  **2026-10-05 补记**：该迁移**已完成**，前置条件已满足——四节 schema 落在当前宿主启动之前；现读该文件已是纯四节
  bullet 文档（`sectionsFromMarkdown` 返回四个节，而不是 `undefined`）。要复核就现读：把 19387 持有者的启动时刻与
  `git log -1 --format=%cI -- src/project-memory/memory-schema.ts` 比，再走插件自己的解析器，别 grep 标题。
  变异校验：五个分片各自 2–3 个变异体，全部杀死（改 share → 预算与随机 cap 用例红；空条目谓词恒 false →
  语义闸门红；不透明闸门丢掉标记过滤 → 骨架用例红；去掉写入门禁 → 骨架覆盖已存 memory 那条红；去掉截断守卫 →
  截断工具调用那条红；工具从不提供/重试仍带工具 → 各自入口那条红；`/memory update` 动词改名、空动词当未知 →
  命令路由那条红）。每个变异体都 `tsc` 0 错、marker 进 `lib/`、只掉自己的用例。
- 修复（批 B 的独立对抗性审核，同批内修掉）：**「空回复」闸门的两半不等价，结构化入口仍能把已存 memory 换成骨架**。
  `sectionsSemanticallyEmpty` 只问「某条目里有没有字母/数字」，而条目本身是标题（`"## Project"`）就含字母、
  于是「有内容」；可是它渲染出来是 `- ## Project` 这样一行，正是**不透明入口**判定为结构行的同一批字节
  （`isHeadingOnlyDocument(render.text) === true`，且该形状在 `test/sections.test.mjs` 里已被钉为「骨架」）。
  于是「只有标题的回复再也无法替换已存 memory」这条**当初并不成立**：写入发生了、且不记任何日志（`semanticEmpty`
  为 false，掉落计数为 0）。现在结构化入口也判**渲染后的文档**（`replyIsSemanticallyEmpty`：数组层与文档层取或），
  真实条目（`- p1`、`- #1 rule must hold`、`- a durable fact`）两边都是内容，所以不会误拒。同批修掉的三处：
  ① **截断守卫不止认 `max-tokens`**——流没有终止事件时 finish 为空，被修过的参数串同样不可信，现在 `""` 也拒
  （`toolCallIsTruncated`，两个 pass 共用），且拒绝后**也会重试**（此前重试条件只认 `max-tokens`，空 finish 的
  工具调用会直接硬失败）；② `ConsolidationOutcome.kind` 的注释声称「回执按入口给词」是假的，已改成「仅供诊断与
  测试」；③ 一条**永远不可能失败**的 prompt 断言（`/^Return exactly one JSON object/m` 对 join 后的规则串永远
  不匹配）换成「工具规则在 JSON 回退规则之前，且旧的一律返回 JSON 那句已不在」。新增钉子：标题条目不得替换已存
  memory、空 finish 的工具调用被拒并重试、`max-tokens` + 工具调用 + **同时带文本**也被拒。
  审核另记一条**有意保留**的不对称（已写进源码注释与 `docs/upstream-pi-triage.md`）：autolearn 在 `max-tokens`
  时**先重试再读**，不像 memory pass 那样先读；技能正文正是被修坏的参数串会毁掉的东西，宁可多问一次。
  审核的 N6 前提有误：`.agents/memory/HANDOFF.md` **未跟踪**（`git ls-files .agents/memory/` 只有
  `.gitignore`/`CONTEXT.md`/`MEMORY.md`），所以那两处 `/context-update` 不构成 tracked 文件里的悬空引用。
  修复后三个变异体（去掉渲染层判定 / 空 finish 不拒 / 重试条件退回只认 `max-tokens`）各自杀死对应新钉子。
  全量门禁 0 错 / 0 错 / 293 pass 0 fail，`lib/` 变异标记 0。

**project-autolearn / project-memory（批 B 两条残余：请求形状码回退 + 接受可解析的截断回复）**

- 修复：**路由拒绝 `tools` 参数时只重试一次、且不带工具**。此前该失败与其他失败一样退避并记录，整趟作废。现在
  `src/shared/model-call.ts` 把 finish 里的 `failure.code` 保留在抛出的错误上（以前它只进消息文本，而 dsh 自己的
  `HarnessError` 契约要求按码路由、不要解析消息），`callWithToolsFallback` 只在**请求形状码**（`INVALID_REQUEST`、
  `HTTP_400`、`HTTP_413`）上花掉那一次无工具重试。选这个码集不是猜：provider 400 在两个可走的 adapter 里都映成
  `INVALID_REQUEST`（`llm-deepseek/src/transport.ts` 的状态映射、`llm-pi-ai/src/stream.ts` 的 `classifyPiAiError`），
  而 pi 的 `toolsFallbackApplies` 其实是**负向 fail-open**（只用消息正则排除 auth/quota/transient）——dsh 有稳定的码，
  就不必把那套消息正则搬进来。两个 pass 的调用点都走这条共享函数；记忆侧的退避**只记一次**失败（成对的一次调用不烧
  两个槽）。
  **pi 的整趟粘性开关照搬**（不是省掉）：本仓最初的实现论证过「每个 pass 只发一次带工具的调用」，**那个前提是错的**——
  autolearn 在首个决定要求先读归档时会**第二次** `ask()`（`ask(backtrackPrompt(...))`），刚拒绝过 `tools` 的路由会被再次
  递上同一个参数；现改为 pi 的开关（只有一趟里首次带工具的调用可回退，调用前就打 `toolsAttempted`，所以一次**成功**的
  带工具调用也算「该路由接受工具」，回退之后整趟不再带工具），并由回溯用例钉住。真正的偏离只剩一条：触发集是**正向的
  请求形状码表**，而不是 pi 那套消息正则 fail-open 的负向默认。
- 修复：**被 `max-tokens` 截断、但文本里的 JSON 对象已闭合的 autolearn 回复不再被丢弃重问**。`parseAutolearnReply`
  把「回复里没有可解析的对象」与「解析成功但没提议」分开（前者 `undefined`，后者 `{skill: null}`）；这个区分此前被
  `parseAutolearn` 的 fail-soft 折叠掉，于是整个回复必须先丢再读。现在：**无法解析的截断回复照旧重问**（这半边正是
  fail-soft 陷阱本身，必须保住），**能解析的直接采纳**——对象在截断前就闭合了，所以每个成员都是完整发出的，原始
  `JSON.parse` 不可能接受半截值。探针（`.agents/evidence/2026-10-05-autolearn-cut-parse-probe/`）对三种回复形状的
  **每一个切点**验证：裸 JSON 的任何切点都解析不出（该重问的地方照旧重问），有围栏/尾部散文的 137 个切点**全部**携带
  完整正文。**工具调用那一半完全不变**：adapter 会把被截断的参数串修复成形，所以 `toolCallIsTruncated` 仍旧拒绝。
- **独立对抗性复核后的两条「有意保留」**（2026-10-05，复核自身的复现与形状见
  `.agents/evidence/2026-10-05-draft-object-tail-probe/`）：① **「草稿 + 后续对象」形状会被采用**——一份先写完整对象、再写散文、
  再起第二个对象却被截断的回复，会因 `parseJsonObject` 取「第一个 `{` 到最后一个 `}`」而解析成**先前的对象**；探针显示 memory
  侧会存下 `- draft entry`、autolearn 侧会取 `draft-skill`（围栏/尾部散文形状不受影响）。这是共享解码器本来的性质，memory pass
  自始如此（它先读再决定重试），R1 只是让 autolearn 与之对齐——**不是 R1 引入的回退**；真正的修法是给两个 pass 都加「解析出的对象
  必须是最后开始的那个」的 span 判定，属新的设计决定。② `INVALID_REQUEST` **宽于「路由拒绝 tools」**：dsh 对本地序列化/校验失败
  与任何 provider 400 都会给这个码，代价是那类失败多花一次无工具调用；边界是结构性的——重试只有一次且不递归、整趟开关让其后调用
  不再带工具、退避是 `throttle.set` 而单次 catch 包住这一对，所以不会烧两个失败槽。
- 变异校验（**五个**变异体，各自 `tsc` 0 错、标记进 `lib/`、只打红该打的用例）：去掉解析信号（`max-tokens` 一律重问）
  → 只掉「可解析的截断回复被采纳」一条；把请求形状码集换成永不相交的值 → 掉三条依赖回退的用例；把成员判据换成「任何带码
  的失败都回退」→ 只掉 auth 负向用例（证明「请求形状」这个判据承重）；**去掉整趟开关 → 只掉回溯那条**（证明这个状态可达、
  不是仪式）；**把码从抛出的错误上拿掉 → 掉新加的接缝断言 + 同三条回退用例**（证明「保住码」这个接缝在单测与端到端两层都
  被钉住）。裁定与源码依据在 `docs/batch-b-residual-decisions.md`。

**project-memory（跨项目边界写进 prompt）**

- 修复：**整理 pass 现在会拒收「另一个仓库的状态与度量」**。prompt 把整段会话交给模型重建两份文档，于是会话里引用的兄弟仓数据
  （提交距离、文件大小、调研数值、键计数）会被写进本项目的 memory；pi 在这条上复发过三次，手工清理不成立——下一趟又写回去。
  边界现在**写两处、共用两个具名常量**（测试断言的是同一个常量本身，而不是各抄一份措辞）：`FOREIGN_STATE_RULE` 紧挨密钥/填充物
  规则，`CONVERSATION_CAPTION` 是 `<recent-conversation>` 块的第一行——外来文本正是从这里进来。规则**保留**「为记录某个 open item
  的归属而点名另一个项目」的合法性：本仓**有意**保留这类归属指针，规则不能把它们一起禁掉。
  变异校验：从规则数组里删掉该规则 → 只掉新用例；从会话块里删掉标题 → 同样只掉它。来源：pi 第四巡 `4f26ddd`
  （`docs/upstream-pi-triage.md` 第四巡）。

**project-memory（丢失回执：五处丢失点名）**

- 修复：**有一次整理丢掉了内容，回执读起来跟一次干净整理逐字相同**。合并整理的丢失都发生在**写入之前或写入当刻**，
  所以存下来的文档再渲染一遍必然报 0、看上去完全健康。批 B 已经算出其中两处并写了日志，但它们**进不了回执**：
  `ConsolidateReport` 当时是 `"updated" | "clipped" | …` 的字符串联合、`MemoryInput.clipped` 只是个布尔，于是
  「丢 12 条」与「一条没丢」的回执一模一样，丢的是 memory 还是 context 也无从分辨。这类丢失共五处，现在**五处都
  进回执与 `errors.log`**：
  ① **输入适配** `fitMemoryInput`（`src/shared/conversation.ts`）在「记忆 + 上下文」超出模型输出上限时把已存记忆
  掐头去尾（头 60% + 尾 40%，丢中段）；截断重试再多留 4096 headroom，所以重试比首投更早开始裁。
  ② **分节渲染** `renderMemoryDocument`（`src/project-memory/sections.ts`）把超出一节预算的条目整条丢弃，并按每节
  预算推出单条上限（`min(800, budget − 3)`）。
  ③ **上下文读取上限**：`existingContext` 在进 fit 之前就被 `slice(0, MAX_CONTEXT_CHARS)` 截掉，超上限的存量
  `CONTEXT.md` 每轮都丢这一段，此前**没有任何计数**。
  ④ **上下文渲染** `renderContextDocument` 按自己的分节预算裁剪并写截断标记，此前只有一条每项目只报一次的日志。
  ⑤ **记忆写入上限** `normalizeMemoryDocument`（写入路径 `record.ts:89`）：**不是四节 bullet 文档**的回复根本进不了
  分节渲染器，超上限时被裁到 cap 并以截断标记落盘——此前**回执与日志全无**，是最彻底的一条静默路径。
  现在：`MemoryInput` 带 `memoryHiddenChars` / `contextHiddenChars`，`ConsolidationOutcome` 把读取上限并入
  `contextHiddenChars`（`clipTo` 只缩不增，计数恒非负），`ConsolidateReport` 升级为带 `status`、两个落地布尔
  （`memoryWritten` / `contextWritten`）与六个计数的对象（`memoryHiddenChars` / `contextHiddenChars` /
  `contextDroppedChars` / `memoryWriteDroppedChars` / `sectionDropped` / `droppedItems` / `itemTruncated`）。
  回执按机制给词，并**只说真的落了盘的东西**：`stale` 时 memory 侧计数归零、context 没写时 context 计数归零，
  只写了一个文件时说 `Project memory updated.` 而不再声称两个都更新了（旧措辞在 context 因形状不可用被跳过时是假的）。
  失败发生在一次写入**之后**时，`failed` 回执改为说明哪个文件已经落盘、丢了什么，而不是把已有的丢失抹成 0。
  另修两处计数不实：`itemTruncated` 不再统计「先按单条上限裁、随后又整条被丢弃」的条目（它并不在文档里）；
  低于 40 字符下限而被丢弃的回复改为记一条日志（此前无写、无日志、回执仍称干净）。**干净路径逐字不变**（两个文件都
  落地且无丢失时，`updated` 仍是 `Project memory and context updated.`），所以「句子没变」仍然等于「没丢东西」。
  **2026-10-05 补记**：原句里「`clipped` 无计数时仍是原句」这一半**已不再成立**——「状态 `clipped` + 落地计数全 0」
  这个组合现在不可达（状态改由落地计数推导），而它正是当时接受的两条「档 A 残余」之一；两条残余均已收口，见下方
  「project-memory（档 A 两条残余收口）」。`updated` 干净路径的逐字不变不受影响。
  同时**去掉三处每项目只报一次的日志闸门**（`memorySectionClipLogged` / `contextClipLogged` /
  `contextUnusableLogged`）：一个长期超预算或持续给出不可用 context 的项目每轮都在丢/跳，只报第一次等于把后面每
  一次都变成静默。
  档位选择：批 C 的三档（A 回执点名 / B 拒绝写入 / C 拒绝 + 一次定向重试）里选 **A**——它零行为变更、复杂度最低，
  且是 C 的前置（C 要用这些计数）。B 单做有自锁风险（当前这份 MEMORY.md 就在 cap 附近），C 需要完整的重试语义设计。
  决策、验收判据与仍未收口的两条残余（**档 A 的**：`clipped` 计数全零可达、记忆侧 loader cap 未计入）存档在
  `docs/batch-c-loss-receipt-brief.md`，证据在
  `.agents/evidence/2026-10-04-memory-loss-receipt/`（`probe.mjs` 在**写入前的输入/回复**上逐一复现五处丢失，并量出
  「写完再渲染 → 0 掉落」这个陷阱）。
  过程：初版只收口 ①②（且把主张写成"回执再也不会与干净回执逐字相同"）。独立对抗审核复现出 ③④⑤ 与三处计数/措辞
  不实（含 ⑤ 全静默），于是本轮扩到五处并逐条加了用例；审核同时给出「无法证伪」清单：干净措辞在七种 status 上逐字
  相同（旧函数从 `HEAD` 取出后逐字比对）、重试路径报的是重试那次 fit 的计数、新用例非空转。
  变异校验：**五个**变异体各自杀死对应用例——`memoryHiddenChars` 恒 0 → 按份报字符数那条红；回执掉落子句阈值改
  100000 → 回执两条红；`contextHiddenChars` 去掉 `wroteContext` 过滤 → 「计数只描述落盘内容」那条红；`itemTruncated`
  挪回丢弃之前 → `renderMemoryDocument` 分节用例红；写入上限计数阈值改 1000000 → 写上限用例红。每个都 `tsc` 0 错、
  marker 进 `lib/`、只掉自己的用例（其中 M5 第一版让 import 变成未引用、`tsc` 报 `TS6133`，按仓库规矩作废重做）。
  从 hash 校验过的 `/tmp` 副本恢复 `src/` 后重建，`lib/` 变异标记 0。
  门禁（现跑现读）：`pnpm typecheck` 0 错、`pnpm build` 通过（`lib/client.js` 28376 字节）、`pnpm test`
  **302 pass / 0 fail**（新增 9 条用例）。
- 修复：**记「丢内容」的日志行自称一切都还在预算内**。分节渲染的丢弃/截断日志此前写作
  `MEMORY.md was rendered within its per-section budgets: …`，可它**只在** `sectionDropped > 0 ||
  itemTruncated > 0` 时产生——前缀与同一行的后半句所述正好相反，读者会把它读成「这次渲染没超预算」，
  而回执对同一事件的措辞（`the rewrite was lossy`）是对的。现在前缀改为 `MEMORY.md was rendered lossily:`。
  真实复现：2026-10-04 的一次 `/memory update` 写出 `… 2 section(s) exceeded their budget and 2 whole
  entry(ies) were dropped; 1 entry(ies) exceeded their section's per-item cap and were truncated`。
  该前缀此前没有任何用例钉住，现在两条真实落盘用例把它钉住：分节丢弃那条要求每行点名丢失、且不得自称还在
  预算内；**单条截断那条**（`itemTruncated > 0` 而 `sectionDropped === 0`，此前没有任何用例执行到这条日志
  路径）要求整行带出具体损失、冒号后不能是空描述。变异校验：前缀改回原句 → 两条都红（301 pass / 2 fail）；
  删掉 `itemTruncated` 的描述子句使其成为悬空前缀 → 只红新那条（302 pass / 1 fail）。门禁（现跑现读）：
  `pnpm typecheck` 0 错、`pnpm build` 通过、`node --test` **303 pass / 0 fail**。
  注：`5b32867` 的提交信息把变异轮结果写成「302 pass / 1 fail」，正确是 **301 pass / 1 fail**（当时全量
  只有 302 条、且没有新增用例）；该提交已推送，按本仓库「不重写历史」的规矩以本处更正代替 amend。

**project-memory（档 C：拒绝有损写入 + 一次定向重试）**

- 变更：**会丢内容的整理不再落盘：先做一次定向重试，仍会丢就拒绝写入、存量 `MEMORY.md` 原样保留**。档 A 只把
  丢失报出来（回执 + `errors.log`），写入照旧；档 C 把它变成不写。触发面是「会整条丢」的那几处：分节渲染整条丢
  （`sectionDropped` / `droppedItems`）、以及不透明回复（不是四节 bullet 文档）超出 `maxMemoryChars` 的写入上限。
  **单条被裁到 per-item 上限（`itemTruncated`）只重试、不拒绝**：超过 `min(800, budget − 3)` 的合法条目在格式里没有
  任何合法形态能塞进去，拒绝它等于永久拒绝该项目。**输入适配裁切（机制①）只报告不拒绝**（用户裁定）：模型没看到
  的那段字符，重试也补不回来，拒绝只会把每次 `clipped` 变成记忆停更。
- 重试契约：每趟最多**一次**损失重试，总模型调用 ≤ 3（首投带 `record_memory` 工具 → 既有 `max-tokens` 重试 →
  损失重试），且损失重试**绝不链式**再重试；它不带工具、用上一次同一条 `usedInput`（不重新 fit——否则两次调用所
  见的输入都变了，重试的损失就无法归因到回复本身）。提示词由新导出的 `memoryLossRetryRule(overage, writeCapDropped)`
  生成，**只报节名与数字、不带任何内容**；数字来自新导出的 `memorySectionOverage`，它按 `renderMemoryDocument` 的
  同一套算术算（`itemCap = max(1, min(800, budget − 3))`、每条 `min(len, itemCap) + 3`、装不下则整条丢），而不是
  另估一套——估偏了会要求模型去改一个错的量，比不重试更糟。
- 拒绝契约：不调 `recordMemoryDocument`、不写备份、`MEMORY.md` 逐字节不变；context 仍照旧落盘（两个产出物分开，
  `stale-context` 已是同一套语义）；新状态 `lossy-refused` 只在「有损回复被拒」时出现；**释放 version claim**，
  否则拒绝之后的一次强制整理会答 `deduped`——那是「写过了」的答案，对没落盘的记忆是假话；被拒回复的丢失**单列**
  在 `refusedLoss`（`sectionDropped` / `droppedItems` / `writeCapDroppedChars`），不并进「只描述落盘内容」的那组
  计数（后者在一次拒绝后全为 0），回执与 `errors.log` 从它取数，每次拒绝各留一行、不按项目去重；拒绝之后又发生
  失败（如 context 写入抛错）时，回执仍点名这次拒绝，而不是退回一句普通 error。
- 前提是 cap 提额：`maxMemoryChars` 32000 → 40000（desktop 与 web 两层 profile，活值经运行中宿主自己的
  `settings.describe` 读到 `40000`，不是从文件推断）。到 40000 时各节预算 Project 7984 / Invariants 15969 /
  Pitfalls 9981 / Index 5988，对当前 30953 字符文档余量 2355 / **3255** / 2083 / 1343——Invariants 从 55 变成
  3255，档 B/C 的**自锁前提**才解除（贴上限时每次整理都有损，拒绝写入等于记忆永远停更）。设计、自锁分析与验收
  判据在 `docs/batch-c-tier-c-design.md`。原先记为「点名不修的缺口」的默认值层，已于同日由用户点名补上：
  `MAX_MEMORY_CHARS` 32000 → 40000。它是 `DEFAULT_CONFIG.maxMemoryChars` **和所有兜底默认参数**共同读的那一个
  常量（`src/shared/limits.ts`），所以只改 `DEFAULT_CONFIG` 一个字段会造出两个不同的「默认值」、在省略 limit 的
  调用点上静默裁掉多出来的内容，因此抬的是常量本身。于是走 bundle 插入、未在自己 profile 里写这个键的 profile
  （如 `ctxdev`）也拿到与 desktop/web 相同的余量。回归用例放进既有的「默认 cap 就是文档里那个数」那条：650 行
  （33689 字符）的文档在默认 cap 下**不再**被裁（旧的 32000 默认会裁它），800 行的仍按整行裁并报 `40000`。
  变异校验：把常量退回 32000 → 编译 0 错、标记进 `lib/`、行为确实改变（同一输入由「未截断」变成「截断」），
  杀掉 3 条具名断言（`logic.test.mjs` 的默认值断言、`memory-store.test.mjs` 的常量断言、以及「默认 cap 保住旧
  32000 会裁掉的文档」这条行为断言）；从 hash 校验过的 `/tmp` 副本恢复后重建，`lib/` 标记 0。门禁（现跑现读）：
  `pnpm typecheck` 0 错、`pnpm build` 通过（`lib/client.js` 28376 字节，locales 里 32000→40000 等长）、
  `node --test` **312 pass / 0 fail**。
- 独立对抗审核复现并修掉的三处（审核报告 `/tmp/dsh-tier-c-review.md`，10 条：1 阻断 / 3 应修 / 6 备注）：
  **①阻断**：拒绝判定当时读的是**标记行**而不是真裁切——`writeCapDroppedChars` 由
  `memoryTruncationDropped(normalizeMemoryDocument(reply, cap))` 得出，而 `normalizeMemoryDocument` 在正文没超限时
  也会把输入里**旧**的标记原样附回，于是「装得下但带着历史标记」的回复被判为有损并按旧标记的数字报数（该数字可
  大于 cap，所以提高 `maxMemoryChars` 也逃不掉）——对一个曾经被裁过的项目等于永久拒绝。现在裁切量由裁切本身导出
  （`normalizeMemoryWithDrop` 返回 `{text, dropped}`），两条调用点（pass 的判据、写入路径的计数）都改用它；
  只会解析标记行的 `memoryTruncationDropped` **删除**（它已无调用者，而正是这个 API 引得判据去读历史标记）。**②**：拒绝回执当时不读 `detail`，同一次整理里落盘的
  context 丢失会被说成干净，现在按 `stale-context` 的同一规矩点名。**③**：重试如果**更差**（本可落盘的首投被换成
  会被拒的回复）不得采纳，否则等于「要个更小的文档」把整次记忆更新搭进去。另修两处误归因：无条目回复交给语义空门
  而不是报成拒绝（cap 不是那个阻断原因）；以及 `.agents/evidence` 级的一次失败不得抹掉已做出的拒绝决定。
  实现中另发现并修掉一处：损失重试不带工具时，模型若再回工具调用，其文本流为空、`parseConsolidation("")` 会把
  它读成「不透明但无内容」的回复；采纳它等于**用空回复替换真实但超量的回复**，语义空门随后静默跳过写入而回执报
  普通更新。现在只有**语义非空**的重试回复才替换首投。
- 机制⑤在「落盘」这条路上现在**结构性不可达**：分节渲染的输出按构造 ≤ cap，超上限的不透明回复会被拒，所以
  `memoryWriteDroppedChars` 不再可能对一次真正落盘的写入非零（审核以 168 组形状×cap 与 400 次随机整理复核为 0）。
  该分支、计数与日志**保留**作为不变量自身的警报（渲染与 cap 若再度分叉它们仍会响），拒绝时报的数字改放在
  `refusedLoss.writeCapDroppedChars`；原先断言「被裁文档落盘」的那条用例改写成断言「拒绝 + 文件未动」。
- 测试：新增 10 条、改写 3 条既有用例到新契约（原「有损也落盘」→拒绝；原「写入上限被计数」→拒绝；原「落盘后失败
  仍保留已落盘损失」改用单条截断这条唯一还会落盘的损失形态）。新增覆盖：`memorySectionOverage` 镜像渲染器；一次
  重试修好（并检查重试提示词只带节名/数字、不带上一版内容）；重试上限恰好三条调用；拒绝且字节不变 + 每次各一行
  日志；同一回复在小 cap 被拒、在 40000 落盘；历史标记不当作本次丢失；更差的重试不采纳；无条目回复归语义空门；
  拒绝之后的失败仍点名拒绝；拒绝释放 claim（用 `forceDedupeMs` 窗口把 `deduped` 与 `lossy-refused` 区分开）。
  **干净路径逐字不变**（`Project memory and context updated.`）。
- 变异校验：**10 个**变异体各自杀死对应用例，且全部通过有效性三关（`tsc` 0 错、标记进 `lib/`、行为在探针上确实改变）：
  M1 `retryWorthy: false`（去掉重试触发）→ 19 条红；M2 `refuses: false`（去掉拒绝）→ 15 条；M3 把 `itemTruncated`
  并入 `refuses` → `per-item` 那条红；M4 去掉「重试须语义非空」→ 13 条；M5 让 `normalizeMemoryWithDrop` 把历史标记
  当成丢失 → 新增的「历史标记」那条红；M6 拆掉拒绝分支的 `written.delete` → 「拒绝释放 claim」那条红；M7 令
  `memorySectionOverage` 的 `itemCap` 取整节预算（不再镜像渲染器）→ 镜像那条红；M8 让落盘计数不过 `wroteMemory`
  过滤 → 拒绝用例红；M9 无条件采纳重试 → 「更差的重试」那条红；M10 去掉 refusal 的跨失败携带 → 「拒绝后的失败」
  那条红。每个变异体跑完立刻从 `sha256sum -c` 校验过的 `/tmp` 副本恢复该文件；收尾 `sha256sum -c` 全绿、重建后
  `lib/` 标记 0。
- 门禁（现跑现读）：`pnpm typecheck` 0 错、`pnpm build` 通过（`lib/client.js` 28376 字节）、`node --test`
  **312 pass / 0 fail**。
- 两条原先记为「已接受残余」的行为于同日第二批**修复**（不再是残余）：
  **①损失重试自身抛错**不再把整趟判成 `failed`。重试是「避免一次拒绝」的尝试，不是拒绝所依赖的一步：首投自身的
  损失已经定论，而整趟 reject 既抹掉这一趟**已做出**的拒绝决定（与「拒绝之后的失败仍点名拒绝」要挡的是同一类
  误归因，只是漏在重试路径上），也把首投「只是单条被裁到 per-item 上限、本可落盘」的记忆一起丢掉。现在重试自身
  失败时由首投定论：会整条丢 → `lossy-refused`（`refusedLoss` 照常带上），只单条截断 → 照常落盘；重试的失败另留
  一行 `errors.log`，使随后的拒绝不会读成「重试答了但还是太大」。**唯一例外是调用方自己的 signal 已经 abort**
  （`options.signal.aborted`）：那是调用方取消这一趟，继续下去会让调用方在取消之后写产出物，所以仍让整趟失败（与首投
  即被 abort 一致）。**流自己报 `aborted`（`reason.kind === "aborted"`）而调用方 signal 没 abort 不算例外**——
  `model-call.ts` 抛的是同一种错误形状且不看 signal，此时仍由首投的损失定论（闭环复核实测到这一点）。
  **②抬高 `maxMemoryChars` 落在 `forceDedupeMs` 窗口内不生效**：缓存里是旧 cap 下做出的决定，而拒绝回执给出的杠杆
  恰恰是「抬高 maxMemoryChars，或稍后再试」——用户在窗口内抬高 cap 再强制一次，只会拿旧 cap 的判决作答、连一次
  模型调用都不发生。现在缓存项按**做出决定时的 cap** 归属，强制趟在新 cap 下真的重跑；**节流（非强制）路径刻意
  不按 cap 归属**：它不该花一次意外模型调用，而重报上一次真实决定也比「记忆其实没写过却说已是最新」更诚实。
  原有用例保持绿：同 cap 的强制重跑仍从缓存作答、状态仍是 `lossy-refused`（**不是** `deduped`——那份缓存项就是拒绝
  结果）且不新增模型调用；拒绝释放 claim 也照旧。两个决定由此区分开。
  变异校验（各 1 个变异体，均过有效性三关：`tsc` 0 错、标记进 `lib/`、探针上行为确实改变）：把重试 catch 改回
  `throw` → 「不隐藏拒绝」「不丢可落盘首投」两条红；删掉 abort 守卫 → abort 那条红（修复下为绿，是正对照）；
  把 cap 键换成 `cached` → 新用例红而同 cap 既有用例仍绿。门禁（现跑现读）：`pnpm typecheck` 0 错、
  `node --test` **316 pass / 0 fail**。
- 闭环复核另报出并修掉一条**错因**：`errors.log` 的拒绝行原先读 `config.maxMemoryChars`——**报告时**的设置。节流
  路径会把缓存里的拒绝原样重报，于是抬高 cap 之后的下一次自动整理，会拿新 cap 去描述一个在旧 cap 下量出的损失
  （实测：在 4000 下被拒的回复重报成「10401 character(s) ... exceeded the **40000**-character memory cap」）。现在
  `ConsolidationOutcome` 带上**做出决定时的 cap**（`maxMemoryChars`），该行读它；回执本身从不带数字，所以用户可见
  措辞不变。变异校验：把该行改回读 `config.maxMemoryChars` → 新用例红、其余全绿。门禁（现跑现读）：
  `pnpm typecheck` 0 错、`node --test` **317 pass / 0 fail**。

**project-memory（档 A 两条残余收口：状态与落地计数一致 + loader cap 计入）**

- 修复：**`clipped` 会指着一个没落盘的东西说「内容被缩短了」**（档 A 残余一）。状态原本由**趟级**的
  `outcome.clipped`（= 上次发送的 fit 是否裁过）推导，而回执里的计数只描述**真的落了盘**的产出物：当被裁的是没落盘的
  那一个时，回执就变成「状态 `clipped` + 所有计数为 0」，句子还把缩短归到落盘的那个文件上。真实复现（在 `lib/` 上跑真
  `consolidateProject`、临时项目根）：存了 39018 字符 `MEMORY.md`（在 40000 读取上限内），fit 从 memory 里裁掉 7266
  字符，回复的 memory 低于 40 字符下限所以没落盘，context 落盘——状态 `clipped`、六个计数全 0、回执
  `Project context updated, but the existing content was shortened to fit the model output budget.`，而被缩短的
  `MEMORY.md` **一个字节都没动**。现在状态由**落地计数**推导（`loss.memoryHiddenChars > 0 ||
  loss.contextHiddenChars > 0`），状态与回执数字按构造成立；没落盘的那次缩短仍由 `errors.log` 与（非 silent 且确有落盘时的）
  info 行承载，措辞改为中性的「consolidation was given a shortened version of the existing memory or context (the read
  cap or the output budget)」——因为下面那条让同一个数同时覆盖读取上限与输出预算，只写「to fit the model output
  budget」就是错因。**副作用（有意）**：已被计数的 context 读取上限（`MAX_CONTEXT_CHARS`）此前落在 `updated` 上，
  现在也报 `clipped`，句子同步换成中性措辞。
- 修复：**记忆侧 loader cap 未计入**（档 A 残余二）。`loadMemory` 在读的时候就按 `maxMemoryChars` 裁过一次（手改的
  超限 `MEMORY.md`，或把 cap 调低到早先那轮写入之下），而 pass 只统计 `fitMemoryInput` 那一刀的字符数：模型被少看了
  多少，回执里是 0。真实复现（cap 5000、手改 6337 字符 `MEMORY.md`）：无 journal 时 loader 把文档裁到 4860 字符且
  **不写标记**，于是 `/memory status` 也完全不告警；有 journal 时走 external 分支、标记写了、status 也告警，但两种
  情况下 pass 回执都是 `memoryHiddenChars 0`，读起来像一次干净读取。现在 `LoadedMemory` 带 `cappedDroppedChars`
  （**本次读取自己按 cap 裁掉多少**），取值一律来自做裁剪的那个规范化器：`foldMemoryJournalWithDrop` /
  `decodePoisonedMemoryWithDrop` / `memoryComparisonKeyWithDrop` 的 `dropped`，裸渲染分支是 `clipToLineBoundary`
  的差。pass 把它加进 `outcome.memoryHiddenChars`（读取上限与输出 fit **相加**，不是互相替代），`outcome.clipped`
  也随之为真，`/memory status` 的 cap 告警改由 `isMemoryTruncated(text) || cappedDroppedChars > 0` 触发。
  **刻意不对原始字节取差**：`normalizeMemoryDocument` 在 capped 文档上**不幂等**（把单行超长正文裁到只剩标题时，
  二次规范化会长 2 字符），而 poison 路径的 JSON wrapper 也不是「模型没看到的记忆」——所以计数只能取规范化器自己的
  `dropped`；比较键因此仍做原来的两次规范化（它是写入路径的基准字节），只把两次的 `dropped` 相加。
- 测试：新增 4 条（R1 端到端「没落盘的缩短不得读成 `clipped`」；R2 端到端「记忆读取上限被计数」；「两个 cap 分别
  计数、互不替代」；loader 单元「每条读取路径都报自己的裁量」，含「92 字符 fenced 存储回复必须报 0」这个判别用例）。
  改写 4 条既有措辞断言，原「`clipped` 无计数时仍是原句」按新措辞重钉并在用例里写明该组合已不可达。
- 变异校验：**8 个**变异体全部杀死对应用例，且都过有效性三关（`tsc` 0 错、标记进 `lib/`、行为在用例上确实改变）：
  状态改回 `outcome.clipped` → R1 那条红；outcome 去掉 loader 那一项 → R2 两条红；poisoned 分支改记原始字节差 →
  loader 单元红；status 告警改回只看标记 → status 用例红；比较键跳过第二次规范化 → loader 单元红；两个 cap 取
  `Math.max` 而非相加 → 「分别计数」那条红；趟级 flag 各去掉一个读取上限来源 → 对应用例红。每个变异体跑完立刻从
  `sha256sum -c` 校验过的 `/tmp` 副本恢复 `src/`；收尾 `sha256sum -c` 全绿、重建后 `lib/` 标记 0。
- 门禁（现跑现读）：`pnpm typecheck` 0 错、`pnpm build` 通过（`lib/client.js` 28376 字节）、`node --test`
  **321 pass / 0 fail**。
- 闭环复核（只读、另一次独立审核，对 26k 组输入做 `foldMemoryJournal` / `decodePoisonedMemory` /
  `memoryComparisonKey` 的逐字节差分与 20k 组 cap 不变量模糊测试）**证伪了两条主张**，都已收口：
  ① 那条趟级缩短的 `errors.log` 行原本仍受 `wrote` 门控，于是「没落盘时也留一行」只在下述情形之外成立——
  存了超限 `MEMORY.md`、回复的 memory 低于下限**且** context 形状不可用（两个产出物都没落盘）时，状态是
  `unchanged`、日志 0 行，被藏起来的字符在任何用户可见面上都没有痕迹。现在该行只看 `outcome.clipped`，不看
  `wrote`（`silent` 也不影响它），并新增一条端到端用例钉住「一趟没落盘但被缩短的 pass 仍留一行」。
  ② 记录里三处失真：本轮新加的 Invariants 行与一份设计稿把「计数一律不是原始字节差」写成绝对句，而无 journal
  的裸渲染分支**就是** `clipToLineBoundary` 的长度差（那里没有规范化，差就是这一刀）；档 A 简报第 108-109 行与
  档 C 设计稿第 13 节的「七种 status 在零计数时逐字不变」是**当时**的结论，本轮之后对 `clipped` 已不成立，现按
  dated addendum 标注；CHANGELOG 自己的复现数字 39017 更正为 39018（夹具 `trimEnd` 后的长度）。
  测试：新增 1 条（上述 `unchanged` 情形）+ 1 条状态断言（context 侧析取项）；变异校验 **2 个**变异体全部杀死对应用例
  （日志门控改回 `wrote &&`、状态去掉 context 析取项）。门禁（现跑现读）：`pnpm typecheck` 0 错、`pnpm build`
  通过（`lib/client.js` 28376 字节）、`node --test` **322 pass / 0 fail**。

**project-autolearn（批 D：可以取代自己生成的技能，且只取代自己生成的）**

- 修复：**autolearn 只能新增技能，学歪了就只能手工改**。`rejectionReason` 拒绝任何已存在的名字，所以一条学到后过时或写错的
  技能无法被更新，覆盖同一片工作的提案反而被当近似重复丢掉。pi 当初把「更新/合并已有技能」写成非目标，理由只有一个：它分不清
  哪条是**自己写的**、哪条是人手写或导入的；现在这个出处**写在产物上**——本管线写出的每条 `SKILL.md` 都在正文里带一条
  `<!-- autolearn-generated: … -->`（**不**放 frontmatter：`skillDescription` 与候选解析器都读 frontmatter，未知键会被当成
  候选字段）。标记随技能一起消失，所以「删掉技能后同名位置被人手写占用」永远不会被误认成自己的。`promotedDocument` 是这篇文档的
  **唯一**作者，pass 的直发与 `/autolearn approve` 都走它，所以标记不可能在某一条写路径上漏掉。
- 取代**一律走候选门**：闸门只对带标记的名字放行（人手写/导入的同名仍拒），但直发路径**保留无条件拒绝**——它只能创建新名字、
  永不替换既有文件，所以替换带标记技能的唯一路径是 `/autolearn approve`，且是本人批准过的改动。approve 读的是**被替换文件本身**
  的标记，不是缓存的清单。证据规则不放宽：取代写的是整篇新正文，所以按新建对待（非候选 2 个、候选 1 个已验证 session）。
- 合并需要原文，所以带标记技能的**整篇正文**随 prompt 走 `<learned-skill-bodies>`（首轮与回溯轮都带，因为那条禁止复用的规则
  两处都有），inventory 里标 `(learned)`；放不下的正文**整条不带**（截断的正文只会诱发有损合并），规则同时禁止本轮复用未被
  展示的 learned 名字。`RECORD_SKILL_TOOL` 的 name/candidate 两处措辞与 inventory 同时改，否则这个例外是死代码。
- 变异校验（**五个**变异体，各自 `tsc` 0 错、标记进 `lib/`、只打红该打的用例）：让渲染器写出认不出的标记（改写
  `PROVENANCE_COMMENT`；直接删掉插值会因 `noUnusedLocals` 报 TS6133，属无效变异体）→ 三条新用例全红；闸门忽略标记 →
  只掉「只有自己写的才能被取代」；approve 退回无条件拒绝 → 同一条用例（形状上把 `autolearnProvenance` 保持被引用）；
  `basePrompt` 丢掉正文注入 → 掉合并 prompt 那条；`backtrackPrompt` 丢掉正文注入 → 同一条（证明回溯轮也在断言范围内）。
  收尾从 `sha256sum -c` 校验过的 `/tmp` 副本恢复 `src/`、重建后 `lib/` 标记 0。
- 门禁（现跑现读）：`pnpm typecheck` 0 错、`pnpm build` 通过（`lib/client.js` 28376 字节）、`node --test`
  **333 pass / 0 fail**（新增 3 条）。裁定与验收标准 D1–D6 在 `docs/batch-d-autolearn-supersede-brief.md` §4/§5。

### v0.2.1（2026-09-26）

**设置卡片（client + host）**

- 修复：**卡片在 rc.2 上仍然不渲染**（`v0.2.0` 只修到"导出 `Config`"，那一步必要但不充分）。
  rc.2 的 `SettingsForms.describe()` 会把每份 schema 过一遍 `settings/schema.ts` 的 `volatileForm()`：
  只有**带 schemastery `volatile` 标记**的字段（或其祖先）会被留下，一份字段全是普通类型的 schema
  直接返回 `undefined`，于是**整个条目被跳过**——宿主不再为该命名空间服务任何东西，客户端 describe
  镜像里没有它，`whileServed` 永不触发，卡片**无错误、无日志地消失**。实测（隔离 rc.2 实例 + 真机
  浏览器）：标记前宿主服务 23 个命名空间且不含 `project-context`，标记后 24 个含它，条目 4/4 运行中，
  三个分区 21 个字段在 bundle 页上渲染出来。
  - 21 个字段全部打上标记，用 `extra("volatile", true)` 而不是 `.volatile()`：两者写入的是同一个
    `meta.volatile`（表单投影与 loader 的 `volatileEntries` 读的都是它），但修饰符还会把解析 **mode**
    切到 `volatile`，让每个值变成 `Volatile` 活引用，并牵出无法命名的类型（导出该 schema 会 `TS2742`
    编译失败）。标记本身足够，且不动值类型。
  - **标记会让 schemastery 把这些字段交给插件时是活引用而非值**，所以 `resolvePluginConfig` 现在按
    cosmokit 的共享协议（`Symbol.for("cosmokit.volatile.write")`，跨 ESM/CJS 副本识别用）解引用；
    否则归属条目会拿自己的 config 报 "`handoffSummaryThinking` must be …" 而激活失败。
  - 共享设置从**快照**改为**读取器**：loader 对"只改 volatile 字段"的写入是 `Entry._commitVolatile`
    ——把新值**原地提交进运行中 fiber 的引用**、不重启条目——所以 apply 时拍下的快照会让卡片"看得见、
    改不动"。现在 `effectivePluginConfig` 每次从归属 fiber 的 config 重解析，写入立刻被四个插件看到。
  - 卡片改挂 `plugins.bundle.config`、键为本 bundle 包名 `dsh-project-context`（`plugins.item` 是
    **官方插件专用**列表；bundle 自身配置的归属槽位是前者，社区四个能显示的卡片都这么做），
    `settings-card.tsx` 的 `PropsRuntime<"plugins.item">` 同步改绑。
  - 变异校验：单字段去掉标记 → 掉 1；把解引用改成空操作 → 掉 1；把published 值改回快照 → 掉 1。

**设置卡片改用平台组件（client）**

- 修复：**暗色主题下保存按钮是「白字白底」**。真机截图 + 像素测量定位：按钮内部 stddev 0.0031（完全
  平坦，没有任何字形），相邻「放弃」0.089（有字），两者宽度相当——说明文字占了位、只是看不见。根因是
  自绘的 `background: var(--dsw-alias-brand-primary); color: #fff`：该 token 在本平台是**反转墨色**
  （亮色近黑 `rgb(15,17,21)`、暗色近白 `rgb(249,250,251)`，见 `ui-theme` 的 `design-platform.css`；
  `ui-dockkit` 源码注释专门警告过不要拿它当强调背景），于是亮色正常、暗色白字白底。上一轮只在亮色主题
  下验证，因此漏过。同一次审计还发现自绘样式里的 `--dsw-alias-label-error` **在主题层并不存在**（全仓
  只有官方 `SettingsForm.module.css` 引用它、无任何定义），一直静默吃硬编码红。
- 变更：卡片不再自绘，改用官方设置页的写法——`SettingsForm`（框架、保存按钮、只读/未加载提示）、
  `SettingsValueField`（文本与数字行）、`Switch` / `Pill`（布尔与枚举行）、`Tag` / `Button`（覆盖徽章与
  重置），暂存写入直接用平台的 `SettingsFormModel`，快照 store 由模型内部从
  `@deepseek-ai/dsh-client-store` 取。两者都是 shell 冻结进浏览器模块表的平台模块
  （`@deepseek-ai/dsh-client-web` 的 `platform.ts` / `seed.ts`），bundle 只 `require` 不内联
  （`scripts/build-client.mjs` 的 externals），CSS modules 因此由 shell 提供——社区插件
  （`dsh-context`、`@linxin666/dsh-client-ui-git-graph`）也是这么用的。
- 变更：本仓库只剩一张**字段表** `client/card-fields.ts`（21 行的 kind 与选项；spec 列表、投影、渲染行
  全部由它派生，键不可能三处漂移）和一份**纯几何、零颜色**的 `client/styles.ts`。删除
  `client/settings-form.ts`（手抄的暂存表单，266 行）与 `client/dsh-store-compat.ts`（跨版本 store 探测，
  75 行）；客户端 bundle 40,608 → 28,380 字节。
- 修复（随平台语义一并生效）：自绘表单有三个缺陷——保存**逐字段** `set/unset`（A 落盘、B 被拒时用户看到
  「失败」但 A 已经改了）且没有 revision fence；`save()` 没有 `try/finally`，一次 reject 会让 `saving`
  永远为 true，按钮永久卡在「保存中…」；离开页面不丢弃草稿。平台的 `SettingsFormModel` 是一次原子
  `mutate(ops, revision)` + `try/catch/finally` + unmount 丢弃，这三条随之消失。
- 变更（用户可见）：卡片上**没有「放弃」按钮**——官方语义是离开页面即丢弃草稿，与官方设置页一致。
- 变异校验（四个变异体均 build 0）：样式表加回颜色字面量 → 掉 2；删掉一行字段表 → 掉 1；布尔解析接受
  任意草稿 → 掉 1；spec 不再由字段表派生 → 掉 1。
- 新增：`test/card-render.test.mjs`，本仓库第一个**真渲染**的客户端测试（其余客户端测试都是对源码的
  字符串扫描：能证明某个字符串不在，不能证明控件进了 DOM）。它把卡片与平台的 `SettingsForm` /
  `SettingsValueField` / `Switch` / `Pill` 一起 esbuild 打包，经 `react-dom/server` 渲染后按字段表核对：
  **21 行各出现一次**（8 行由卡片包装、13 行由平台绘制，且平台绘制的 13 个 id 与表里 number/text 的键
  完全相等）、**5 个开关**、**3 组共 7 个胶囊**、整页**只有 1 个保存控件**（起手 `disabled`，落一次编辑
  才可用）、未服务的命名空间 0 行 + 提示、只读 21 行 + 提示且保存禁用、覆盖字段恰好 1 徽章 + 1 重置；
  写入路径确认**一次**原子 `mutate`（`path:['consolidateTurns']`、`value:20`、`expectedRevision:7`）、
  被拒后 `failed:true` 且 `saving:false` 且草稿保留、非法草稿一次都不写。
- 依赖：上条测试用到的 `react` / `react-dom` 进了 devDependencies，`clsx` / `zustand` / `immer` 也一样。
  后三个**本不是**本仓库的依赖，是上游打包缺陷：`@deepseek-ai/dsh-client-ui-primitives` 与
  `@deepseek-ai/dsh-client-store` 的 `lib/index.js` 会 import 它们，而这两个包 0.1.7-rc.2 的 manifest
  **只声明了 cordis peer**（`dependencies` 为空），Shell 从自己的 workspace 供所以一直无人发现；
  一旦自己打包就必须自己供。同一份 `lib/index.js` 还 import `shiki` / `katex` / `micromark-*` /
  `mdast-util-*` / `simple-icons` / `diff` / `anser` / `@deepseek-ai/dsh-util-*`（markdown 与代码块那一
  面），测试按上游实际 import 的**具名导出**注入惰性 passthrough 并在 `t.diagnostic` 中列出，卡片真正
  渲染的组件仍是真件。浏览器 bundle 不受影响：这五个仍全部 external。
- 变异校验（渲染测试，四个变异体都能打包通过）：布尔不再走平台 `Switch` → 掉 1；枚举行只留第一个选项
  → 掉 1；平台行丢掉自己的 id → 掉 1；卡片加回一个自绘按钮 → 掉 1。

**并发写入保护（host）**

- 文档：`MEMORY_LOCK_WAIT_MS`（`MEMORY_LOCK_STALE_MS + 5s` = 35s）与兄弟仓库 pi 侧同名常量的 5s
  **刻意不统一**。理由写在常量处：等待必须越过 30s 陈旧期，否则崩溃留下的孤儿锁会在整个窗口内让每一趟
  都失败，而不是被接管（pi 侧在同一 30s 上下文中用 5s，两处不要"顺手统一"）。

**自动沉淀（③）**

- 修复：**手工 approve 能激活 pass 会拒绝的候选——「描述超限」这条准入规则在 approve 路径上不可达**。
  `approveCandidate` 用 `skillDescription()` 重读候选文件，而该函数把返回值**截断**到
  `MAX_SKILL_DESCRIPTION_CHARS`（1024），于是 `shapeRejection` 永远看不到超限值。探针实测（真实产物）：
  一份 5000 字描述的候选文件被 `{ok: true}` 激活、写进技能的描述被静默截到 1024；而同一份文档走 pass
  路径（`saveProposedSkill`）以 `description too long` 被拒。修法是**校验读未截断的前插值**
  （`skillDescription(raw, Number.MAX_SAFE_INTEGER)`），只有落盘的值仍按上限截断。
  同类排查：`skill.ts` 写侧的两处截断发生在校验**之后**，`shared/migrate.ts` 的 1024 截断是历史技能
  迁移的归一化、不在准入路径上——这两处无此问题。
  - 变异校验：把校验退回截断值 → 掉 1；把描述上限放大 100 倍 → 掉 1。
  - 这条规则补进 `test/autolearn.test.mjs` 的三角度案例表（谓词 / pass / approve）。**`rejectionReason`
    三个此前无钉的分支（非法名字、候选无归档证据、候选已存在）在 `9bd452c` 补钉；「名字检查先于形状检查」
    的优先级与「经 `parseAutolearn` 端到端走一遍」的钉子在 `cf5b61c`**（同一批工作、不同提交，这里不合并
    计数；提交归属别凭记忆，用 `git log -S '<断言里的字面量>' -- test/autolearn.test.mjs` 现查——本条曾把
    其中的优先级钉子误归给 `9bd452c`，解析器那条当时根本没提）。`cf5b61c` 那两个钉子经变异校验：两条守卫换序 → 掉 1；
    让解析器过滤非法名字 → 掉 1。至此 `shapeRejection` 与
    `rejectionReason` 的**十个**返回串（5 个 shape + 5 个 `rejectionReason`，其中两条带名字模板）全部
    有钉子；源码里"名字由调用方校验"的错误注释（`parseAutolearn` 只要求 `typeof name === "string"`，
    随后 `trim`）也是在 `9bd452c` 改正的。

### v0.2.0

**dsh 0.1.7-rc.2 宿主 API 适配（host）**

- 变更：**适配 dsh 0.1.7-rc.2**。此前宿主半边的类型依赖一直钉在 `0.1.5-rc.2`（客户端那几个已抬到
  alpha.2），旧类型里这些 API 都还在，所以 `tsc` 全绿而实际跑不起来——与客户端那次漂移同源，只有
  类型对齐能让编译器说话。对齐到 `0.1.7-rc.2` 后一次性报出五处硬不兼容，逐条修掉：
  - **设置表单不再由运行时注册产生**：`settings.installSection()` 已被删除。rc.2 的
    `SettingsForms.schema(entry)` 读的是**归属模块导出的 `Config`**（cordis 侧 `Config: plugin.Config`），
    `describe()` 再按 **Loader 条目 id** 取命名空间。故 `project-context` 入口导出
    `Config = PluginSettingsSchema`（`toJSON` 是投影前提），`installProjectContextSettings` 换成
    `publishProjectContextSettings`：归属条目发布自己 apply 到的 live config，其余三个插件读取它，
    四个插件仍共享一个命名空间。
  - **事件改名**：`agent/session-start` 已不存在（`project-memory` 漏改，记忆迁移在 rc.2 上永不触发），
    改挂 `agent/created`；该事件是**异步串行**的，监听器返回类型必须是
    `undefined | Promise<undefined>`，两处 fire-and-forget 监听器改为显式 `return undefined`
    （工作仍在后台跑，不阻塞事件）。
  - **`tool-result` 内容块被删除**：工具结果现在是独立的 `role: 'tool'` 消息，其自身 `text` 块即输出。
    `textOf` 去掉递归分支改为直接取 `text` 块，归档与实时两条 transcript 路径因此继续拿得到工具输出
    （否则交接摘要 / 携带尾部 / autolearn 输入会退回成只有 `[tool: …]` 占位）。
  - **`MessageSource.kind` 的 catch-all `plugin` 被删除**：`MessageSourceMap` 改为 merge-extensible，
    各生产者在自己模块里声明 kind。本包在 `model-call.ts` 声明 `"dsh-project-context"` 并使用；
    **刻意不用 `user`**——`userTurnCount` 以 `source.kind === "user"` 统计人类轮次，用 `user` 会把
    插件注入算进自动整理 / autolearn 的触发轮数。
  - `dsh.client.inject` 里退役的 `@deepseek-ai/dsh-client-ui-settings-plugins` 换成真正声明
    `plugins.item` 的 `@deepseek-ai/dsh-client-ui-plugin-manager`。
- 变更：peer 下限 `>=0.1.5-rc.2` → `>=0.1.7-rc.2`（上述 API 属 rc.2，旧范围是虚的）。
- 回归测试：新增「入口导出 Host 投影表单所需的 `Config`，且卡片命名空间 == 该条目 id」的静态断言
  ——`Config` 一旦丢失，卡片会**无错误、无日志地消失**，正是这次踩到的坑。变异校验：删掉 `Config` 导出
  → 掉 1；把客户端 `NS` 改成别的名字 → 掉 1（两处 `tsc` 均通过，属有效变异）。
- 修复：`test/autolearn.test.mjs` 的两处「模块重启」动态 import 仍指向**已改名的旧产物**
  `lib/project-autolearn/autolearn.js`（源文件早已拆成 `pass.ts`）。它一直"绿"只是因为工作树里留着
  被 gitignore 的陈旧 `lib/autolearn.js`；`rm -rf lib` 后干净构建才暴露 ⇒ **全新克隆跑 `pnpm test`
  必失败**。改指持有进程内节流的 `pass.js`，并核对 8 个测试文件里全部 **65 处** `lib/` 导入在干净
  构建下均可解析。
- 验证：`tsc` / `pnpm build` 干净，**208/208**；隔离 `DSH_HOME` + rc.2 store 二进制冷启动：0 条未激活、
  0 条 FATAL/error、74 条 client entry 含 `dsh-project-context`、`[dsh-cost-meter] 已加载`；另用
  `dsh --profile web --dump-config-schema` 在服务端确认 `project-context` 条目确实带出了本包的
  Config schema（`archiveEnabled` / `handoffTargetTokens` / `autolearnTurns` / `maxMemoryChars` /
  `handoffLanguage` 均在），即卡片绑定的命名空间可被 Host 投影。

**设置卡片（client）**

- 修复：**设置卡片在 dsh 0.1.7-alpha.1 之后不再渲染**（当时只修掉了启动崩溃，卡片本身静默消失）。
  同一版上游有**两处**改动同时命中它：其一，客户端 `settingsScope` 服务被删除、改为 `configForms`
  （按 profile 的 plugin Config），而卡片仍通过 `ctx.inject(["settingsScope"], …)` 挂载，可选注入永不触发，
  整张卡片因此不存在；其二，卡片槽位从 `settings.plugin.item` 改名为插件页的 `plugins.item`，而
  `slots.register` 对**未声明**的槽位直接抛错——所以槽位查找必须等该页声明它，不能靠 `register` 试探。
  现在卡片经 `ctx.inject(["configForms"])` + `configForms.whileServed([NS])` 注册到 `plugins.item`，
  并按该槽位契约区分两个视图：`view: 'summary'` 返回列表行的单行说明，`view: 'page'` 渲染表单本体
  （去掉了自带的折叠表头，避免与插件页标题重复）。`configForms` **不在**静态 `inject` 列表里：缺服务的
  静态依赖会让整个 client 入口 pending，桌面端把它变成启动崩溃；缺 `configForms`（0.1.6 及更早）现在退化为
  「没有设置卡片」，其余功能照常。
  顺带把客户端的 dsh 类型依赖从 `0.1.5-rc.2` 抬到与宿主同版 `0.1.7-alpha.2`：旧类型里
  `settingsScope` 与 `settings.plugin.item` 都还在，这正是卡片「编得过、跑不了」的原因，而这类漂移只有
  类型对齐能让 `tsc` 暴露（实测：把槽位名换回退役名，`tsc` 立即失败）。不再被引用的
  `@deepseek-ai/dsh-client-ui-settings-plugins` devDependency 一并移除。
  变异校验：不再按被服务命名空间门控 → 掉 1；把 `configForms` 放进静态 inject → 掉 1；
  summary/page 视图判反 → 掉 1。

**源码结构**

- 变更：`src/` 按**每个插件一个子包**重组，包内再按**单一职责**拆文件。四个插件的 cordis 入口仍是各自
  子包的 `index.ts`，`package.json` 的 exports 子路径与 `cordis.patch.yml` 的插件 id 都没有变：
  `project-context/`（存档）、`project-memory/`（整理）、`project-autolearn/`（沉淀）、
  `project-handoff/`（交接）、`shared/`（四个插件共用）、`client/`（浏览器半）。
- 变更：`project-handoff/` 的 1796 行单文件按职责拆成 11 个模块——`threshold`（触发点与护栏覆盖报告）、
  `conversation`（切分 / 未答问题 / 语言）、`summary`（摘要调用与两段文本）、`child`（子会话的创建、
  模型与权限携带、放弃回滚）、`perform`（一次交接事务的顺序）、`classify`（延后 / 暂态 / 终态）、
  `guard`（子代理与轮次落定）、`state`（进程内标记与节流）、`runtime`（宿主服务结构视图与路由）、
  `auto`（自动触发）、`command`（`/handoff` 参数与回执），`index.ts` 只剩入口与监听器。这是**纯搬移**：
  逐块核对原文件 111 个顶层声明**逐字**落在唯一的新模块中；唯一新增的代码是把测压区间的读取收进
  `getPressureCheckIntervalMs()`，不再跨模块导出一个可变 `let`。typecheck 0、**198/198**、客户端 bundle 重建。
- 变更：`project-memory/memory-store.ts` 的 997 行同样按职责拆开——`journal`（追加日志：解析 / 折叠 /
  轮转 / 归档）、`record`（一次写入：采纳外部编辑、追加、重建渲染、legacy 导入）、`load`（读取路径与
  损伤报告）、`document`（规范化与按行截断标记）、`poison`（存储回复解码与归一化比较键）、`backup`
  （写入前字节级备份与清理）。`memory-store.ts` 保留为**对外门面**（原始的不变量文档 + 公共 API 再导出），
  因为另外三个插件都从它导入 `loadMemory`；`withMemoryLock` 是**泛型 target** 的写锁（`project-memory`
  锁 `MEMORY.md`、`project-context` 锁会话索引），因此移到 `shared/lock.ts`。拆完复核：55 个顶层声明逐字
  各归一处、模块间**零循环导入**（`importLegacyMemory` 归 `record`、`memoryComparisonKey` 归 `poison`，
  正是为了断开 `load ↔ record` 的双向依赖）。typecheck 0、**198/198**。
- 变更：`shared/llm.ts` 的 843 行按职责拆开——`text`（文本计量 / 裁剪 / 渲染）、`output-budget`
  （推理预留、自适应边界、重试余量）、`conversation`（会话分段渲染与记忆输入适配）、`reply-json`
  （从回复里读结构化 JSON 的容错扫描与解析，含 `ContextUpdate` / `ConsolidationResult` 两个形状）、
  `model-call`（插件来源的辅助调用、路由、元数据、`pluginUserMessage` / `CompletionOutcome`）。
  整理 pass 本身（`consolidateProjectState`、节流与单飞状态、提示词规则）本来就不是「共用」，
  移到 `project-memory/consolidate.ts`——它当初待在 `shared/` 只是因为 ③ 复用了那里的模型管线。
  拆完复核：59 个顶层声明逐字各归一处、模块间**零循环导入**（`pluginUserMessage` / `CompletionOutcome`
  归 `model-call`、两个回复形状归 `reply-json`，正是为了断开 `model-call ↔ consolidate` 与
  `consolidate ↔ reply-json` 两组双向依赖）。typecheck 0、**198/198**。
- 变更：`project-autolearn/autolearn.ts` 的 548 行拆成 `skill`（技能形状 / SKILL.md 渲染 / 安全校验）、
  `candidate`（候选文件、准入规则、approve/reject）、`inventory`（技能清单与可取证会话）、
  `parse`（回复 → 候选、回溯预算）、`prompt`（共享规则与两个 pass 的提示词）、`pass`（节流 + 单飞）。
  `project-context/import-archive.ts` 的 346 行拆成 `session-jsonl`（解析与索引元数据）、
  `zip`（导出包目录与 deflate 条目）、`import`（三个回填入口）。两者都是纯搬移：37 / 18 个顶层声明
  逐字各归一处。
- 变更：`shared/project-state.ts` 的 461 行拆成 `paths`（项目根定位与路径助手）、`limits`（字符预算）、
  `files`（原子写 / 缓存读 / 移动合并 / 临时清理）、`gitignore`、`error-log`（轮转与脱敏写入）、
  `redact`、`migrate`（旧布局一次性迁移）；`project-state.ts` 保留为**门面**——原始布局与迁移文档 +
  **逐字保持原有公共 API** 的再导出，因为它有 25 个导入方，而它本身确实是「共用基础设施」而非杂乱堆。
  56 个顶层声明逐字各归一处。最终全仓：**零循环导入**、typecheck 0、**198/198**、客户端 bundle 重建。

**记忆整理（②）**

- 修复：**journal 追加不 fsync**，掉电会以 `damaged:0` 丢掉一条已「写完」的记录。撕裂的尾巴下一次追加会修，但留在
  页缓存里的记录直接消失，而读路径无法区分「从未写入」与「尚未刷盘」。现在 `write` 之后、关闭之前 `sync()`。
  追加是**每次整理一次**、不是每轮一次，不在热路径上。
  （诚实边界：这条没有可复现的回归测试——页缓存丢失在进程内不可观测；只能靠读代码确认。）
- 修复：**旧布局迁移会静默删掉有分歧的 legacy 技能目录**。`importSkillDirs` 只要目标的
  `SKILL.md` 存在就 `rm -rf` 整个 legacy `<name>/`：更新过的手改正文与每个同级资产
  （`reference.md`、示例、脚本）一起消失，不比较内容、不备份、不记一条日志，也不算冲突。现在只有
  **规范化后逐字相同**的副本才被消费，有分歧的目录原地保留并作为冲突上报。配套地，`mergePath`
  不再把「目标更新、源被删掉」误报成 `merged`——新增 `superseded` 结果与
  `MigrationResult.superseded`，迁移日志点名被丢弃的路径；这正是「迁移说文件已移动、其实字节被
  丢弃」的那句假话。变异校验：恢复旧行为（照旧消费有分歧的目录）掉 1 项；把 `superseded` 改回
  `merged` 掉 1 项。
- 修复：**轮转期间 journal 会短暂不存在，读路径于是复活上一轮的渲染**。旧顺序是先
  `rename(memory.jsonl → memory-log-*.jsonl)`、再把折叠结果 rename 进来；两次 rename 之间被杀，
  `memory.jsonl` 缺失，`loadMemory` 直接落到 `MEMORY.md`——而那份渲染可能早于本趟整理，于是
  `/memory status` 报健康，真正的内容躺在没人读的归档里。现在**改为复制**：journal 在任一瞬间都
  有效（多出来的归档会被清理，缺失的 journal 无法自行恢复）；并且异步与同步两条读路径在 journal
  缺失时**从最新归档恢复**，而不是相信那份渲染。变异校验：去掉读路径的归档恢复 → 只掉新测试。
- 修复：输出预算**漏算推理模型的隐藏思考**。整理要求模型在一次 JSON 回复里重新写出记忆与上下文，但预算
  只按可见正文加 `REPLY_OUTPUT_MARGIN_TOKENS`（1024）计算，而推理模型的思考 token 计入**同一个输出上限**，
  于是思考吃掉一部分后 JSON 在字符串中途被截断。现在按上游 pi 的做法为推理模型预留正文的 35%
  （夹在 1024–8192，非推理模型为 0），并且上限贴着天花板时不再改要更多 token、而是**少发正文**。
  非推理模型且无重试余量时预算与旧实现**逐值一致**（3920 组组合零差异，另有专门测试独立复算旧公式钉住）。
- 修复：**唯一能说明「回答被输出上限截断」的信号被静默忽略**——`requestPluginText` 只检查 `error`/`aborted`
  两种结束原因，而 dsh 的结束原因是 `stop | tool-calls | max-tokens | aborted | error`，于是
  `max-tokens` 落到「不是可用的 JSON 对象」这句通用文案上，真正的原因与可操作项都看不见。现在该信号会被
  识别：以 `max-tokens` 结束且解析失败时，按 **+4096 token 余量**重新计算预算并重试一次（提示改为要求压缩），
  两次都截断则**点名输出上限**（含实际请求的 token 数，有隐藏思考时附上其数量）而不是通用 parse 文案。
  回答被截断但 JSON 本身完整时**不重试**（避免为一次成功多花一次调用）；`clipped` 跟随**最后一次实际发送**的
  输入，因为重试可能发了更少内容。注意 dsh 叫 `max-tokens`，pi 叫 `length`——照抄 pi 的字符串会永不命中。
  `error`/`aborted` 原有的抛错语义与文案不变。
- 修复：`MEMORY.md` 的字符上限此前用**裸 `.slice()`** 裁剪，会把最后一行从**句子中间**切断；更要命的是新记忆
  总是追加在尾部，正好落在上限之外，于是**写入即被丢弃**——项目一旦超过上限，后续学习就再也留不下来
  （实测本仓库自己的记忆：38457 字符被静默变成 24001，丢掉 14456 字符且毫无痕迹，切断处停在
  ``(b) `indexTimestamp` accepted only numeric``）。现在按**整行**裁剪，并在文档末尾留下
  ``_[memory truncated at <limit> characters: <dropped> dropped]_`` 标记，使被裁剪的记忆**不会看起来像完整的**；
  标记自身的宽度在裁剪前预留，因此结果仍然 ≤ 上限；只有该标记的**精确形状**会被识别，
  普通记忆行即便以同样字样开头也不会被剥离或搬移，连续归一化两次结果相同。
- 变更：上限改为可配置的 `maxMemoryChars`（默认从 24000 提到 **32000**，范围 4000–200000），并贯穿全部
  归一化调用点，使 journal 的 fold 与 render 在**同一上限**下比较。
- 修复：记忆目录 `.gitignore` 的注释头此前**每批追加都重写一次**。只有「无缺失行便提前返回」保护了稳态，
  保护不了行清单本身扩容——因此任何后续版本往 `MEMORY_GITIGNORE_LINES` 加一条，都会在文件**中间**留下
  第二个 `# project-context: local artifacts, do not commit`。现在只在文件**没有**该头时才写头（大小写不敏感
  比较），否则只追加缺失的行。已接受的残余：用不同大小写写成的头仍会多出一行注释（gitignore 注释无语义，
  彻底修复需要第二套折叠行集合）。
- 修复：`/memory` 的状态回执不报告**触顶裁剪**，于是在上限处丢掉三分之一内容的记忆与健康记忆读数完全一致。
  截断标记此前只写进 `MEMORY.md` 而没有任何地方读回（`isMemoryTruncated` 被导出却零生产调用），
  本仓库实测即为此例：41733 字符 → 裁到 31888、丢弃 9621，而 `damaged`/`unreadable`/`poisoned` 全部干净。
  （**2026-09-26 补注**：这里的「丢弃 9621」与「41733 → 31888」不是同一个减法。marker 的 `dropped`
  是 `归一化后文档长度 − 保留前缀长度`，而归一化会先剥掉 `# Project Memory` 头、代码围栏与旧 marker
  并 trim；探针复核：41,733 → 31,974 时 marker 报 `9834 dropped`，而两数之差是 9,759。别把这两个数
  相减来「验算」——要复现就 `normalizeMemoryDocument(doc, 32000)` 现跑。）
  现在回执在上述三种状态之外**追加**一句，点名配置的上限与后果，并保持既有分支措辞逐字不变
  （同时 damaged 与触顶时两句都在）。
- 修复：上下文（`CONTEXT.md`）此前会在**没有任何痕迹**的情况下被清空。回复里 `key_points`/`open_tasks`
  若**存在但不是字符串数组**（例如模型写成 `"a, b, c"` 或 `[1, 2]`），`Array.isArray` 三元式会把它静默
  换成 `[]`，而 `summary` 仍是合法字符串，于是整个 context **被接受**，`CONTEXT.md` 被原子重写为
  key_points/open_tasks 全空——**旧内容被抹掉且无任何日志**（实测：`key_points: "a, b, c"` → `kp: []` 但仍 ACCEPTED）。
  现在形状不合法的 context 会**整体拒绝**（`contextUnusable`），保留原有 `CONTEXT.md`，并每项目记一次日志；
  而 `context` **缺失或为 null** 仍视为「模型无话可说」，**不**报错——否则健康的一遍会被读成失败。
  提示词同时补上了字段**类型**与后果：此前只列了键名，模型无从知道形状写错要付出整个 context 的代价。
  已接受的残余：标题缺失仍退回 `Untitled session`（标题无语义，不构成丢失）。

**归档（①）**

- 修复：**活跃 flush 会静默丢掉外部写入的 session.jsonl 记录**。`writeSessionArtifacts` 在「文件不再是本进程所有」
  时按内存快照**重建**——这是对的——但磁盘上那份文件可能**比本会话的记录更多**（`import-archives.mjs --replace`、
  另一个宿主、手改），重建就把别人写的事件无声抹掉。现在这种情况下先把整份原字节**另存**为 `.broken-<8hex>` 兄弟
  文件（`session-logs/` 的忽略文件已覆盖）并在项目日志里写明「重建覆盖了一个更长的文件，N 行本会话没有的记录保存在
  X」；压缩导致的变短不算这一类，由 `persisted > events.length` 区分。
- 变更：索引的 **200 行上限不再静默丢行**，文档末尾用 HTML 注释写明「已有 N 个更早的会话因 200 行上限不在本索引中，
  其归档仍在 session-logs/」。计数**逐次累加**（每次写入读到的是已截断的文档，只能看到本次挤出的那一行；不累加的
  话它会永远声称「丢了 1 个」，和不说一样假）。注释是注释：`entryLines` 只取 `- [..]` 行，不会被当成条目。
- 变更：`safeSessionId` 现在**单射**。原来只做字符替换 + 截断 128 字符，于是 `a/b` 与 `a-b`（或两个前 128 字符相同
  的长 id）会映射到**同一个归档目录**，后一个会话的 `session.jsonl`/`session.md` 直接覆盖前一个。被规范化或被截断
  的 id 追加原 id 的 8 位摘要；`session-<uuid>` 这类本身就安全的 id 一字不变，既有归档目录不受影响。
  变异校验：去掉摘要 → 掉 1 项；去掉更长文件的另存 → 掉 1 项；去掉上限注释 → 掉 1 项。
- 变更：索引行现在链接到**权威的 `session.jsonl`**，而不是渲染产物 `session.md`。真正被程序打开的一直是
  前者（autolearn 的证据回溯、导入完整性检查都读它），而后者可由它逐字节重现（已对全部 dsh 归档验证）
  且体积大得多——链接指向可删的那个文件，删掉之后就只剩死链。解析本来就不看链接目标，新旧行等价；
  测试覆盖磁盘上出现过的三种形式。
- 修复：同一 `session-logs/` 里可能同时存在**两种宿主格式**（dsh 的具名事件，与 pi 的单条 `message`
  事件），而读取层只认 dsh 的事件名，pi 归档因此被**静默忽略**——`readArchivedConversation` 对它们返回
  空串，autolearn 的 `if (!text) continue` 便直接跳过，全程无报错。现在按事件形状识别两种格式；pi 的
  事件名与 dsh 全部事件名不相交，dsh 路径逐字节不变。
- 修复：索引标题同样只认 dsh 的 `user/message`，于是用 dsh 导入 pi 会话时标题退化成
  `Untitled session`，而标题正是 autolearn 在索引窗口里识别会话的依据。
- 修复：导入 pi 会话时起始时间取不到（pi 用 ISO 字符串 `timestamp`，dsh 用毫秒 `createdAt`），
  会回落到**导入当天**并写进索引——相当于在项目历史里记录一个错误日期。
- 修复：`Started:` 此前直接 `new Date(createdAt).toISOString()`，头部缺少可用时间戳时抛
  `RangeError: Invalid time value` 并中断整篇渲染；现在降级为 `unknown time`。
- 修复：`readSessionIndex` 的返回顺序此前没有测试守护，而它是**契约**——autolearn 取 `slice(-N)`
  当“最新 N 条”，在这里反转会让送给模型的窗口静默变成最老的 N 条。
- 修复：旧布局的 `<memory>/session-index.md` 此前只在“新索引为空”时被采纳一次，于是搬迁期间由旧宿主
  写入的条目会永久搁浅（磁盘上有归档、autolearn 唯一能导航的索引里没有）。现在**每次写索引都合并**
  （同 id 以新索引的行为准）、按行内日期排序——200 行上限丢的是头部，跨界旧文件里可能正是最新会话。
- 修复：源文件只在它持有的**每一行**都已进入新索引时才删除，删前再 `stat` 一次，因此上限丢行时不会
  连唯一副本一起删掉，读→删窗口内的追加也不会被连带删除（`7da3073`、`d87b244`）。
- 修复：索引写入的读-改-写此前只有**进程内**写链，两个宿主同时写一个项目的索引会丢掉大部分行
  （4 进程 × 25 行只剩 28 行）；现在整个读-改-写落在跨进程锁 `<memory>/session-index.lock` 内（复用
  `MEMORY.md` 的 30s 陈旧 / 35s 等待参数与 `.steal` 防双抢），实测 100 行全部保留。等不到锁时这次
  索引写入失败并记进 `errors.log`，该行会在下一轮写索引时补上。
- 修复：写锁把“锁文件已经不存在”误判成“锁已陈旧”——`lockMtimeMs` 对 ENOENT 返回 0，而 `now - 0`
  必然大于阈值，于是刚抢锁失败的写者会为一个不存在的锁去建 `.steal`，正在收尾的持有者见状便按“安全的
  分支”保留自己的锁不再删除，之后每个写者白等一整个陈旧窗口。索引写锁（每条归档一次）把这处既存缺陷
  放大到常态：修复前实测 20 次并发测试有 5 次卡住约 30.9 秒。现在只有真实存在且超过阈值的锁可被
  抢占。

**交接（④）**

- 修复：**后台子代理守卫有两处独立缺陷，2026-09-16/17「父子两个会话同时改同一个项目」那条防线其实一直没生效**。
  其一（形态漂移）：守卫用 `kind === "child" && activity === "running"` 过滤 `listChildren()`；0.1.6 的
  `listChildren` 确实返回带 `kind`/`activity` 的分类行，但 0.1.7-alpha.1 把分类行搬到 `listDescendants()`，
  `listChildren` 只剩裸目录行 `{id, createdAt, mode, label}`。过滤条件永远不成立、守卫返回 `[]`——而 `[]`
  不是 nullish，调用点的 `??` 连**会话日志回退**都不会走，整条「实时注册表」分支连续两个版本静默失明：有子代理
  在跑时自动交接照常触发。其二（字段语义，更根本）：即便形态对上了，`activity` 也**不是**「正在跑」，而是
  「Session store 还持有这个子会话」——`list-children.ts` 对每个有 live Session 的候选一律报 `running`，只有
  冷读的才报 `inactive`。所以 `db701fc` 从写下的那天起读的就是**驻留**：一个落定后仍驻留的 teammate（正是
  `send_message` 能唤醒它的原因）会被算成在跑，交接于是被无限期挡住。上游自己在同一位置重新判状态并写明理由
  （`list_agents` 的 "Report turn activity without exposing whether the child is loaded"），Team roster 与
  `archive-admission` 也都读 `agent.status`，而 `AgentStatus` 只有 `'idle' | 'running'`、在每个轮次边界翻转。
  现在：**枚举仍用 `listChildren()`**（0.1.6 的分类行与 0.1.7 的裸目录行都带 `mode`，一次读取同时覆盖两个
  版本），**活动改读活体注册表** `agents.get(id)?.status === "running"`；**读不懂的清单不再算「没有在跑」**
  （`diagnostic` 行、或没有 `mode` 的行 → 交回日志回退；只有空清单才是「确实没有」）；拿不到 `agents` 服务时
  同样交回日志，绝不拿驻留顶替活动。teammate 是 `subagents.startContinuable` 建的 continuable **直接**子会话
  （`continuation.ts` 会写 `subagent/catalog`），因此这条守卫覆盖「有 teammate 在跑就不要交接」。
  变异校验：退回读 `activity` → 掉 2 项；去掉「读不懂」的判断 → 掉 1 项；没有注册表时答「没有在跑」→ 掉 1 项。
- 修复：**手动 `/handoff now` 不再静默取消运行中的子代理/teammate**。交接先分叉、再退休旧会话，而退休的
  `stopActivity` 会取消旧会话**所有**仍在运行的子代理后代（`workspace/session-stop`）；此前只有自动档查那条
  守卫，手动档照常执行，于是敲一次 `/handoff now` 就会把 teammate 手上的活静默清掉，用户没有任何提示。现在手动
  档走**同一个** `pendingSubagentWork`（注册表读不出就从会话日志读，两处共用一个回退链，避免再次各读一份而漂移），
  有在跑的就**拒绝并点名**：回执给出数量、子会话 id 与杠杆（先 `interrupt_agent`，或等它们落定后重试），
  且**不创建任何子会话**。自动档的行为不变（延后）。
  变异校验：禁用拒绝 → 掉 1；共享回退丢掉日志 → 掉 2；回执不给杠杆 → 掉 1。
- 修复：**交接之后旧会话没有结束**。dsh 的交接是**分叉**——子会话是另一个会话——所以被交接的那个会话继续存活；
  而工作区列表按活动度分组，仍在活动的旧会话就排在自己延续的**上面**，于是用户看到 handoff 的新会话落在旧会话
  下面。宿主没有「结束会话」的 RPC；它的 `archiveSession` 是唯一等价物，而且必须带 `stopActivity`：不带该标志
  时宿主对仍有运行中工作的会话**拒绝**归档（`WorkspaceActiveSessionError`），带了才先写归档、再请求宿主停止。
  现在交接成功后把旧会话**退休**——停止其运行中的工作并归档（归档只隐藏：日志、归档产物与工作区位置都保留，
  客户端可撤销）。时机是重点：**自动档**触发时该会话已经落定，立即退休；**手动档 `/handoff now` 跑在自己那一轮
  里**，此时归档（带 stopActivity）会停掉正在渲染回执的那一轮，所以排到它的 `turn/end` 再退休，且消费后不重试。
  变异校验：整体去掉退休 → 掉 2 项；手动档改成立即退休 → 掉 1 项；归档不带 `stopActivity` → 掉 2 项。
- 变更：自适应（`auto`）交接阈值改为 **pi 的两层机制**，并**改变了触发点**。质量层是一条**回退链**——
  `quality = autoCompactTokenLimit ?? knee(contextWindow)`，不是相加、也不是封顶；dsh 宿主只暴露合并后的
  `contextWindow`（`LlmModelContext`），所以今天恒走 knee 分支，`qualityLimit(contextWindow,
  autoCompactTokenLimit?)` 的第二个参数就是宿主将来把「声明容量 / 可用输入」拆开后的接入点（字段名取自
  Codex 的 `auto_compact_token_limit`）。曲线为 pi 原文：
  `round(W − (W − 157K) / (1 + e^(−ln(W/450K)/0.04)))`，拟合自 MRCR 8-needle 的 46 个 ≥1M 模型，
  用途是**不轻信声明的窗口**。组合是**两项**：`threshold = min(quality(window), capacity(room))` ——
  质量层作基、**容量封顶有最终发言权**，`handoffTargetTokens` **不在这条线上**（见下条）。
  **这是一次行为变更**：默认配置下触发点从小窗口的「装配开销 + 保留尾巴 + target」抬到接近容量上限，
  大窗口则由曲线封在 157K。实测（baseline 6000 / keep 20000）：65K 37576→**45152**、128K 68808→
  **107616**、200K 90000→**179616**、400K 90000→**379616**、1M/2M 90000→**157000**。
  这些数字与 pi 文档中 `boundary` 的 84% / 90% / 95% / 16% / 8% 逐点一致。默认配置下与本项上一版
  （`min(max(baseline+keep+target, quality), capacity)`）**逐值相同**，唯一差别是把 `handoffTargetTokens`
  抬到曲线之上时不再抬升触发点（1M 窗口 target 200000：226000 → **157000**）。固定比例模式在曲线之前返回。
  变异校验：回退链反向掉 1 项、容量封顶失效掉 11 项、把 pi 的 `max(targetValue, …)` 加回来掉 1 项。
- 修复：**手动设定的阈值被护栏压掉时没有任何提示**。阈值有两个来源——护栏（质量层，再是可用窗口）和
  用户手动设的值（`/handoff target`，或固定模式 `/handoff 0.95`）——而护栏决定触发点。此前手动值一旦
  被压就**完全看不见**：1M 窗口上 `/handoff target 200000` 的回执同时显示 `adaptive target 200000` 与
  `threshold auto 157000`，没有任何一句说前者没有生效；`/handoff 0.95` 在小窗口被 4K 安全边际压到
  61536，标签却仍写着「95% of window」。现在 `resolveThreshold` 返回 `override`（`setting` / `asked` /
  `tokens` / `by`），`/handoff status` 据此**点名**被覆盖的手动值与压住它的那条护栏（质量膝 or 容量），
  并给出可用的杆杆；固定模式被压时标签改为 `95% of window (capped to 61536)`，不再自相矛盾。
  变异校验：分别让两个分支不再上报覆盖，各掉 1 项（都是 `tsc` 0、marker 已进 `lib/` 的有效变异）。
- 变更：质量层的回退链参数由 `upstreamUsableInput` 更名为 **`autoCompactTokenLimit`**，改用上游字段自己
  的名字（Codex `auto_compact_token_limit`）。语义不变，仍是 `??`：声明值优先，声明的 `0` 同样保留、
  不外溢到膝曲线。纯改名，`qualityLimit` 的两个分支与那三条断言原样保留。
- 修复：**质量膝低于物理下限时，拒绝原因被归给了 4K 安全边际，并给出反向的建议**。触发点改成两项之后
  「重 baseline」这条路径才第一次可达（此前 target 抬升把它挡在拒绝集之外）：1M 窗口、baseline 512000 时
  floor 540000、容量 979616、膝 157000，`thresholdRefusal` 返回 `summarizer-floor`，回执写着「窗口不是
  瓶颈……4K 安全边际让摘要装不下；更大的上下文窗口是杆杆」——而这里真正 binding 的是膝，且**更大的窗口
  会让膝更低**，建议正好与实际相反。现在新增 `quality-knee` 这一因，`thresholdRefusal` 用与编排器完全
  相同的比较（`qualityLimit(W) <= capacityLimit(room)`）区分膝与容量，回执改说「把 baseline / keep 调小
  才是杆杆（调大窗口只会降低膝，不会抬高它）」。两者必须分开：膝与容量要的杆杆方向相反。
  变异校验：去掉区分、恒返回 `summarizer-floor` → `tsc` 0、marker 已进 `lib/`、只掉 1 项（新断言）。
- 变更：`resolveThreshold` **拆开**为单一职责的纯函数——`handoffRoom`（① 只判可行性）、
  `qualityLimit`（② 只算质量层，回退链所在）、`capacityLimit`（③ 只算容量上界），`resolveThreshold`
  只做模式选择与 ①–③ 的组合（原 ④ `summarizeAmount` 随 target 退出触发点而删除）。
  原来一个函数里混着六件事（模式、可行性、基线、target 推导、容量、质量），这也是「拒绝原因」与
  「阈值公式」各写一遍、容易互相漂移的根源；现在 `thresholdRefusal` 直接复用 `handoffRoom`，
  两者只能因**组合**而分歧。
- 变更：**删掉自适应路径的 15 秒测压节流**（它没有进入任何发布）。它守的是 `resolveModelInfo`
  （无缓存，每次落到 provider adapter）与 `tokenMeter.measure`（进程内同步，给会话面定价），但触发点
  `turn/end` 本身就是**一轮一次**，没有忙循环可压：把本仓库 72 个归档会话拆开量，161 个 `turn/end`
  的 89 个相邻间隔里只有 **1 个（1.1%）**短于 15 秒，中位间隔 430 秒、p10 113 秒——约 90 轮才省下
  一次测量。代价却是真实复杂度（模块级时间戳 + 一个只为测试存在的可变全局 `setPressureCheckIntervalMs`），
  并且生出一个 bug：延后没有释放时间戳，导致用户回答后的第一个 `turn/end` 被吞掉（`ee6eb1e` 曾按
  「延后必须释放」修它，现在连机关带那次修复一起去掉）。删掉后回到「一轮一次」的天然节奏，形状与 pi
  一致（pi 的等价调用是进程内 `getContextUsage()`，它也没有测量节流）。若将来真测出代价，正确做法是
  按路由缓存 model info、面未变则复用上次测量，而不是在调用方加一道挂钟闸门。

- 修复：`/handoff status` 此前把**每一个**「阈值不可用」都渲染成
  `threshold unavailable at this window`——一句关于**窗口**的断言，而窗口往往不是原因。
  `resolveThreshold` 有三个 `undefined` 出口：窗口确实太小、被 `usable − SAFETY_MARGIN_TOKENS`
  挤压、固定比例算不出正值；实测在 `W=40000 / keep=0 / baseline=11800` 下窗口仅用约三成
  （`usable 23616 > floor 19800`），回执仍说窗口不足，用户于是去换模型或调 target，全都无效。
  现在回执按**真正生效的那一项**措辞（`thresholdRefusal` 只读复算、`resolveThreshold` 的公式
  按原样未动），并在窗口低于请求预留时不打印负的 token 数。
- 修复：`/handoff now` 把**可重试的暂态**报成终态失败。RPC 抛出的瞬时原因（连接被重置、限流、
  上游过载、429/502/503/504、会话已有一轮在跑）与真正的编程错误此前共用
  `Handoff failed: …`，而前者按自动路径的既有判断本来就该重试。现在三类分开：延后
  （`HandoffDeferred`，原样透传以保住 2026-09-17 的双写守卫）、暂态（提示可安全重试并保留原始
  原因）、其余仍是 `Handoff failed`。识别基于错误码（含 `.cause` 链上的 `UND_ERR_*`/`ECONNRESET` 等）
  与措辞，**刻意偏向终态**：未识别的形态按失败处理，而不是许下一个重试的承诺。措辞匹配是启发式，
  已知边界写在源码注释里。

**自动沉淀（③）**

- 修复：**learn-state 的读-改-写没有跨进程锁**（`autolearn-state.json` 的闸门时间戳）。两个宿主（或宿主与归档回填）
  可能读到同一份状态、各自发布自己的 patch，丢掉对方的时间戳。现在与记忆 journal 用同一把锁把 read→write 串起来。
  变异校验：把锁打到别的路径 → 只掉新测试。
- 变更：技能的**准入规则合并为唯一一条纯谓词** `shapeRejection(description, body)`，被提案路径
  （`saveProposedSkill` → `rejectionReason`）与手动路径（`/autolearn approve` → `approveCandidate`）
  共用。此前 `approveCandidate` 自己重写了其中四条：同一份文档由两处规则各判一次，谁漏一条，手动
  批准就会静默跳过它（pi 侧的同名副本已经漏掉 body 上限与注入检测，2.5 万字符的注入正文可原样
  激活）。现在两个入口对同一份文档给出同一个原因，拒绝文案也从笼统的「incomplete or unsafe」变成
  点名规则（`body too long` / `body looks like an instruction injection` / …）。
  新增回归测试从三个角度钉住同一原因：纯谓词、pass 路径、approve 路径；变异校验：让 approve 不再
  调用共享谓词 → 只掉新测试。
- 修复：`/autolearn` 此前用一句 `No new skill was warranted.` 覆盖**三种互不相同**的结局：模型
  根本没被调用（去重窗口内、没有素材、没有可归档的会话）、模型答了但准入规则拒了它的提案、
  以及模型的回答里没有可用技能。第三种说法在另两种下是**假**的——尤其第二种：一次**已付费**的
  模型调用真的返回了一个技能，只是被体积/证据/重名/注入检查之一挡下，用户被告知「模型没提出
  任何技能」，于是去重跑一个已经答过的模型。现在结局带 `skipped` / `rejected` 两个可选原因，
  回执按真实原因分四种措辞；没有拒绝时仍返回历史的三字段形状。

### v0.1.0（首个正式版本）

**交接（④）**

- 修复：**父会话还在跑下一轮时不再交接**。触发点是 `turn/end`，但 harness
  会在当前轮一关就立刻把队列里的用户消息开成下一轮，
  父会话可能在插件写摘要的几秒里就已经回到工作状态（2026-09-17
  实际发生：两个会话同时改本仓库）。现在有四处检查点（摘要前 / 摘要后 / 投递首条消息前 /
  投递后），并在投递前发现已开新轮时**撤销**已创建的子会话（取消可能已投递的那一轮、去掉切换标记、
  归档掉未播种或确认已取消的子会话），而不是留下一个空会话；`HANDOFF.md`
  改到最后写，被放弃的尝试不在项目里留文件。
- 修复：交接子会话继承父会话**当前模型/思考级别**（此前会退回部署默认）
  与**权限预设**（此前用户切到“完全访问”会在子会话里被重新逐项询问）。
- 修复：带入新会话的最近对话**包含工具输出**（此前每条工具结果都渲染成空）。
- 修复：子代理未落定时延后交接（读 `subagents` 注册表实时状态，缺失时回退扫会话日志）；
  “没有更早内容可摘要”的跳过改为限频服务端日志，不再每个 idle
  重复。
- 修复：会话被销毁时清掉待评触发点，进行中的尝试结束后不会把已销毁的会话重新交接出来；进行中到达的
  `turn/end` 记下来并在本次尝试结束后按**最新**触发点补评（走同一套闸门：`handedOff` / 开关 /
  失败退避）。
- 修复：“没有更早内容可摘要”的跳过此前只有一条限频服务端日志，用户看不到；现在 `/handoff status`
  会报告**从何时起被跳过**与原因（保留窗口不足），并在该会话重新可摘要时清除。dsh 没有 host
  侧通知服务，这条回执是唯一可见面。

**记忆整理（②）**

- 修复：**控制台诊断不再泄漏凭据**。`errors.log` 本来就会脱敏，但同一条失败还会原样交给
  `ctx.logger.warn`，而一条格式错误的模型回复最多带 4000 字符原始输出；现在控制台侧
  `diagnosticMessage` 统一脱敏 + 单行化 + 400 字符封顶，`replyHead` 也在源头脱敏；`redactSecrets`
  另补 Slack/GitLab、npm/PyPI、Google API key 形态。
- 修复：`loadMemorySync` 与异步折叠保持一致（缺渲染文件或日志有损坏行时不再静默丢弃整个折叠）。
- 修复：`withMemoryLock` 的等待窗口长于失效阈值，崩溃遗留的锁会被接管而不是让整理失败 30
  秒；`importLegacyMemory` 走锁并拒绝覆盖已有日志。
- 修复：旧布局迁移**先写新的** `session-logs/INDEX.md` 再删被接管的 `session-index.md`。
- 说明：`maxOutputTokens` 是增长边界而非硬上限（`max(configured, ceiling)`，与 pi 一致）。

**自动沉淀（③）**

- 修复：闸门改为双字段（`autolearnAt` 记录**真正蒸馏到的材料时间戳**，`lastAttemptAt`
  记录尝试时刻），且不再 `Math.round`——此前重启后可能重复沉淀，或对刚刚写入的材料漏判。
- 新增测试：`autoLearn` 开关（关闭 → 0 次模型调用）。

**归档（①）**

- 修复：导入归档时写入顺序为 校验 → 渲染 md → INDEX → **最后**写正式 JSONL；两者齐全才算导入成功。

