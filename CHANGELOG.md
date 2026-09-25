# 更新日志

本仓库以 **`v0.1.0`** 作为首个发布（`package.json` 为 `0.1.0`）。更早的 `v0.1.0`/`v0.2.0`
标签因对应提交上的代码有误，已在本地与远端一并删除并作废。下面按插件记录变更，最新发布的
内容放在“未发布”之后；标注“修复”的条目都伴随一条**变异校验过**的回归测试（把修复改回
原样，测试必须失败）。

### 未发布（`v0.2.0` 之后）

（暂无）

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

