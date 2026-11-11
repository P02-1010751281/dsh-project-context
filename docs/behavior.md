# 四个阶段的机制与闸门

① 存档、①补 回填、以及 ②③④ 的完整规则。要点版见 [README](../README.md#行为与边界) 的
「行为与边界」；这里写的是「为什么这样、边界在哪」。

## 自动归档（①）

| 时机 | 动作 |
|---|---|
| `turn/end` | `session.jsonl` 追加增量（不渲染 Markdown） |
| agent `idle` / `disposed` | 追加 JSONL + 追加 `session.md` + upsert `INDEX.md` |
| `session/disposed` | 收尾写出 + 释放进程内游标 |
| `session/flush` | 等待进行中的写入（上限 90s），保证落盘 |
| `/session-log write` | 手动立即写出（含索引刷新） |
| `/session-log tree` | 只读：把 `session-logs/<id>/meta.json` 的 `parentId` 读成缩进树（交接链），不写盘 |

- 本节的**归档**只表示「把会话写成 `.agents/memory/session-logs/` 下的存档文件」。它
  **不是**「交接后旧会话从侧栏消失」的那件事：后者是 ④ 的「退休」步骤调
  `workspaceRegistry.archiveSession()` 做的，与 `archiveEnabled` 无关（见「说明」的 ④）。
  被隐藏的会话并没有丢——侧栏视图选项切到「全部对话（显示已归档）」，右键「取消归档」即回来，
  日志、存档产物与工作区位置都还在。
- `session.jsonl`：首行 header，之后每个 dsh 事件一行。进程内按游标增量
  append，长会话不重写整份；每次写入记下目标文件的 **inode + 字节数 +
  mtime**，只有三者都仍是本进程写下的那一份才追加——被外部改写（`--replace`
  回填、手工截断/重写）时下一次写入**整份重建**，不把新事件接到别人的内容后面；
  没有新事件的写入不产生任何字节。
- `session.md`：全事件 pretty-JSON 渲染（含 tool 调用/结果、thinking、compaction、模型切换），
  供人阅读与交接导航，不参与自动流程。
- `INDEX.md`：每会话一行 `- [id](id/session.md) — YYYY-MM-DD — 标题`，标题取
  `session/title`（回退首条用户消息），同一会话原位刷新、按 id 去重后只留最新 200
  行；同一进程内的写入走一条写链，跨进程则走 `<memory>/session-index.lock`（与 `MEMORY.md` 同一套
  30s 陈旧 / 35s 等待参数；仍在运行旧构建的宿主不遵守此锁，重启后才受同一把锁约束）。等不到锁时这次
  索引写入失败并记进 `errors.log`，该行在下一轮写索引时补上。
- 项目根 = 会话 cwd 的 git 顶层（`git rev-parse --show-toplevel`），非 git 目录回退
  cwd；首次写日志时自动放一个忽略整个目录的 `session-logs/.gitignore`，不动项目根
  ignore。
- 只归档插件启用后实际发生的会话（首次写出会带上该会话此前的完整事件快照）；
  更早结束的会话用下面的回填补。异常写入 `.agents/memory/errors.log`（scope
  `session-log`），单条截断 8000 字符，文件超过 1MB 时保留最新约 64000
  字符并写入截断标记，不打断会话。

## 回填历史会话（①补，无模型调用）

```bash
# CLI（不依赖运行中的 dsh；自带 zip 读取，无需 unzip）
node scripts/import-archives.mjs --project <项目根> <archive.zip|session.jsonl|目录>…
node scripts/import-archives.mjs --project . --dry-run sessions_archive/   # 只解析并报告
node scripts/import-archives.mjs --project . --replace --no-md archives/   # 覆盖；不渲染 session.md
# 交互 profile 里：/session-log import sessions_archive/
```

- 导入结果落在 `<项目根>/.agents/memory/session-logs/<session-id>/`，`session.md`
  用与实时路径**同一份**渲染器、`INDEX.md` 用同一份索引写入，
  因此后续整理/沉淀/交接读到的回填会话与实时归档无法区分。
- `session.jsonl` **逐字节保留原文**（只把结尾规范化成一个换行；重序列化会丢掉旧版 header
  里已删除的字段）。
- 幂等：已归档的会话默认跳过，`--replace` 才覆盖；全程不调用模型。`--no-md` 只写 canonical JSONL +
  索引（`session.md` 体积是 JSONL 的数倍，纯机读场景可省）。
- 输入支持 dsh 自己导出的 zip：会话日志在 zip 根，文件名随格式代次变化（当前 `session.v3.jsonl`，第
  0 代才是 `session.jsonl`），子代理日志在 `subagents/<id>/`
  下——导入只看根目录并优先取最高代次。
- 实测规模参考：21 个 zip / 586,909 个事件 → 13s 导入，约 1.1GB（`session-logs/` 自带
  `.gitignore`，不随项目入库）。

## 说明

- ② 由 `project-memory` 独占：idle / disposed 触发，`session/flush`
  等待进行中的调用；同一项目一次只跑一个整理 pass，版本去重避免重复写入。
- ② 的 pass 之后跟一条**清洗通道**（`src/project-memory/prune.ts`）：`*.memory-backup-*` 只留最新 3
  份、`memory-log-*.jsonl` 与 `memory.jsonl.*.tmp` 超 90 天、`errors.log` 超 1 MB（归档后原地截断到最新
  约 64000 字符的整行尾巴）、`skill-candidates/*.md` 超 60 天。**先写 `trash/<date>.tar`、读回磁盘字节逐
  成员核对，再删**；每次真的清理都往 `purge.log` 追加一行（`/memory prune` 预览不删也不写，`--apply` 才
  执行）。`session-logs/` 与活的 `memory.jsonl` 永不在候选里——时间线是审计线，Z2 的「被取代」「久未证
  实」两个触发都读它。
- ② 里有一段**机械写入**（`src/project-memory/todo.ts`）：`turn/end` 时读本会话的 `todos` 投影，把未完成项
  写成该会话文档 Open tasks 顶部的 `- [todo] …` 行（`in_progress` 标 `(in progress)` 的，`completed` 不写），
  其余条目与全文其余字节不动。**不调模型**，也不改 Summary / Key points。投影为 `null`（本轮没写 todo）
  时一行不写、上次的快照继续站着；只有空列表才清掉机械行。快照没变就不落盘，所以多数轮次没有 diff。
  整理 pass 用同一个函数接着维护这段（投影没有意见时沿用已存文档里的行），否则它在 `turn/end` 后几秒就会
  把刚写下的清单重写掉。写不下预算的项计入 `droppedItems` 并写 `errors.log`，不让下一次 pass 去裁模型
  写的条目。
- ③ 由 `project-autolearn` 独占：先读 `MEMORY.md` + `CONTEXT.md` + `INDEX.md`，模型可返回至多 3
  个待回读会话，插件从对应 `session.jsonl` 提取对话（忽略 `assistant/message.stream`
  等大负载、各截断 16KB）后二次调用。闸门时间戳持久化在 `.agents/memory/autolearn-state.json`，
  **重启后不会重复沉淀**；它记录的是**本次真正蒸馏的材料时间戳**（而不是调用时刻），
  所以整理恰好在同一 idle 写入的新记忆不会被当成“已沉淀”而漏掉。
  **自动**沉淀时项目里一个真实存档都没有就直接跳过（正式技能要两个、候选要一个，跑了也不会有产物，
  白花一次模型调用；`/autolearn` 显式强制仍会调用）；prompt 里带 `<existing-skills>`
  清单并禁止重名；已学习技能的正文**不再随每次提示词推送**，模型要用 `inspect_skill` 点名索取
  （最多 2 个），跟进轮才附上——**没展示过正文的已学习名字一律拒绝覆盖**
  （`body not shown this pass`）；回读前逐个校验 `session-logs/<id>/session.jsonl` 真实存在（模型幻觉出的 id
  会被丢弃，全部落空时按“无证据”处理）；输出上限按需自适应上调（受 `maxOutputTokens`
  约束）。正式技能需要至少两个**已验证**的存档会话做证据，只举一个会话的提案进 `skill-candidates/`
  等 `/autolearn approve`；已存在的技能不覆盖，含提示注入话术的 body
  一律拒绝。
- ④：摘要输入是 `MEMORY.md`、最近对话窗口与文件操作索引，不依赖整理是否运行；摘要失败退避 5
  分钟；未答问题按 `handoffPendingQuestion` 处理——`wait`
  会把问题原文作为独立段落带进新会话（此前只跳过延后、问题实际会丢），
  并以该段落**取代**常规的“先做下一步”结尾。
  **用户自己的最后一次输入**会被单独带入，且不依赖 `handoffBudgetRecentTokens`：它既可能是用户手打
  的消息，也可能是 `ask_user_question` 的选择或自填答案（读 `answers[].selected` 与
  `answers[].custom` 两者）。它与“未答问题”段落**按位置取胜者**，只有更新的那一项进入续会话——所以
  用户刚答完的问题不会被当成“仍在等他回答”，而答案之后新问的问题也不会被旧答案顶掉。用户**跳过**的
  问题、以及 timed 模式返回的 `{"pending":true,…}` 都不算表态，不会被当成“用户说过的话”带入（上游
  `tool-ask-user` 的两种结果形状里只有 `answers` 是答案）。带入该段落时结尾改为「用户已经表态，不要
  再问一遍；若球在用户手上就说清在等什么」，正是为了拆掉“没有下一步就再问一次”那条指令。
  自动交接在**本会话还有未结束的后台子代理时延后**（枚举读 `subagents.listChildren()` 并取其中
  `mode: continuable` 的直接子会话：0.1.6 的分类行与 0.1.7-alpha.1 的裸目录行
  `{id, createdAt, mode, label}` 都带 `mode`，一次读取同时覆盖两个版本；**是否在跑读活体注册表**
  `agents.get(id)?.status === "running"`，**不能**读清单里的 `activity`——那个字段的含义是「Session store
  还持有这个子会话」，落定后仍驻留的 teammate 也会报 `running`，会把交接无限期挡住；上游 `list_agents`
  在同样位置重新判状态，并写明 “Report turn activity without exposing whether the child is loaded”。
  **读不懂的清单必须交回**会话日志扫描，而不是当成「没有在跑」：`diagnostic` 行、没有 `mode` 的行、查询失败、
  或拿不到 `agents` 服务都走日志，只有空清单才是「确实没有」。teammate 是同一个注册表里的
  **continuable 直接子会话**（`subagents.startContinuable` 建的，会写 `subagent/catalog`），所以正在跑的
  teammate 同样让自动交接延后。**手动 `/handoff now` 也受这条守卫约束**：交接会退休旧会话并取消其中在跑的
  子代理，所以有在跑的直接**拒绝并点名**——回执给出数量、子会话 id 与杠杆（先 `interrupt_agent`，或等它们
  落定后重试），且不创建任何子会话）：
  子代理落定会唤醒父会话并开启新一轮，此时交接会变成父子两个会话同时改同一个项目（本仓库 2026-09-16
  实际踩到过），所以等到没有在跑的子代理再交；**同一个失败还会从另一侧发生**——触发点是
  `turn/end`，但 harness 会在当前轮一关就立刻把队列里的用户消息开成下一轮，
  所以只要交接时队列里已经有消息，父会话在插件写摘要的那几秒里就已经在跑新一轮了（本仓库 2026-09-17
  实际踩到过：`turn/end` 与下一轮 `turn/start` 只差 4 毫秒，8.3
  秒后子会话被创建，父子同时改了同一处代码）。所以自动交接在**触发它的那个 `turn/end`
  之后本会话又开了新轮**时直接放弃（不算失败、不占失败退避、不写
  `errors.log`，只记一条限频服务端日志）。检查点有四处：摘要调用前、摘要调用后、
  **投递首条消息前**（创建子会话是 RPC、再带上权限与模型，这段窗口里开的新轮同样要拦）、
  以及**投递之后**（消息 RPC 本身也是窗口）。前两处还没创建任何东西，直接放弃；后两处子会话已存在，
  于是**撤销**而不是硬删（dsh 没有删除会话的 RPC）：未播种的——不播种、标题改成
  `handoff deferred · …`（不带切换标记，浏览器不会切过去）、并用
  `workspaceRegistry.archiveSession()` 归档掉，侧栏不会多出一个空会话（归档只隐藏不删除，客户端
  `uiWorkspace.unarchiveSession` 可以还原）；已播种的——先用 `sessionController.cancel()`
  撤销刚投递的那一轮，**取消成功才归档**，取消失败或运行时没有该调用就保持可见，
  免得把一个可能还在跑重复续接的会话藏起来。`HANDOFF.md` 放最后写，
  所以任何被放弃的尝试都不会在项目里留下文件。真正的交接**失败**（不是延后）保持可见，仍以
  `handoff failed · …` 留在列表里以便排查。这套守卫是**尽力而为**的：最后一次检查之后还剩一个
  `rename` RPC 的窗口，无法再收窄；下一次尝试照常。判定读的是会话日志里更晚的 `turn/start`，因为
  `turn/end` 提交时 driver 的 phase 仍是 `running`，读 `agent.status`
  无法区分“这一轮刚结束”和“已经在跑下一轮”；落在某次尝试进行中的 `turn/end`
  不会被丢掉，而是记下来、等这次尝试结束后**按它补评**（否则一次被吞掉的、真正空闲的 `turn/end`
  可能让该会话再也不交接；若这次尝试以失败告终，则补评先受 5 分钟失败退避约束，不会立刻重试）。手动
  `/handoff now` 不受**这条轮次落定**限制（它本身就在一轮里执行），但仍受上面的子代理守卫约束（有在跑的
  就拒绝并点名）。**自动**交接因“没有更早内容可摘要”
  而跳过时写一条**限频的服务端日志**（约 10 分钟一次），并在 `/handoff status`
  的回执里报告**从何时起被跳过、以及原因**（同一个会话一旦重新变得可摘要，这条报告随即清除）——dsh
  没有 host 侧的通知服务，UI 里不会主动弹提示，`/handoff status`
  是唯一可见面；要看当时的上下文占用也用它，要强制移交用 `/handoff now`（手动路径的回执是可见的）。
  本会话的路由（provider/model）在本机解析不出来时，自动交接按失败退避重试，并把这件事写进**同一条上下文注入行**
  （模型转述给用户，不是客户端弹窗）；`/handoff status` 的回执同时点名该配对与适配器原话——不再只有
  `errors.log` 里的一行。
  没有可摘要的更早消息时（空会话，或整段对话都落在 `handoffBudgetRecentTokens` 原文窗口内）直接拒绝，手动
  `/handoff now` 回一条错误说明而不是伪造摘要，并提示用 `/handoff budget recent 0`
  摘要整段对话。交接**跟随对话语言**（`handoffLang`，含摘要指令、六个段落标题与首条消息）；
  重放中**上一轮交接提示会被替换成一行标记**，不再把陈旧的交接提示原样带进孙会话。
  带入的"最近对话原文"是把消息渲染成文本（`## user` / `## assistant` /
  `## tool result`，助手只调工具时是 `[tool: 名称]`）——dsh 的交接只能把文本投给子会话、
  不能重放结构化消息，所以这里是**渲染**而不是 pi 的**真消息重放**；
  **工具输出会一并带入**（每条截断 1500 字符，`textOf` 读 `tool-result`
  块），同一份渲染也是整理/沉淀的输入。新会话沿用父会话的 **agent
  preset**、**权限预设**与**当前模型/思考级别**（`sessionController.create` 既不接受 model
  也不接受权限：创建后先按 `permissionPresets.current(父会话)` 取预设并经服务的 `set(子会话, 预设)`
  写入沙箱模式与审批策略，再按父会话最后一次请求的路由调 `selectModel`，
  最后才投递首条消息——否则用户切到的"完全访问"到了子会话会退回"每个敏感操作都要问"；父会话是
  `custom` 组合、子会话尚未进入内存、或运行时没有这些服务时按原样创建，失败只记警告不影响交接），
  workspace 按 cwd **精确匹配**接入（匹配不到就只用 cwd 创建），首条消息里的存档指针是绝对路径、
  `HANDOFF.md` 里写仓库相对路径；浏览器端在标题出现时自动切换，
  但**当前会话输入框非空或正在提交时不抢**。新会话被标记后，**被替换的旧会话会被「退休」**：先停掉它
  仍在运行的工作，再归档掉。dsh 的交接是**分叉**（子会话是另一个会话），旧会话不结束就仍算「活动」，
  而工作区列表按活动度分组，于是它排在自己延续的上面——这正是用户报的「handoff 的新会话落在旧会话
  下面」。宿主没有「结束会话」的 RPC，`archiveSession` 是唯一等价物，且必须带 `stopActivity`：不带该
  标志时宿主对仍有运行中工作的会话直接**拒绝**归档；归档只隐藏，日志、归档产物与工作区位置都保留，
  客户端可还原。这一步受 `handoffRetireReplaced` 控制（默认开启；键见 README 的配置表）：关掉后旧会话留在列表里，其中在跑的子代理也不会被停，代价是它仍排在自己的续接会话上面。带 `stopActivity` 时宿主还会经 subagent 家族的 `workspace/session-stop`，把该会话**仍在
  运行的子代理后代**（含 teammate）逐个 `cancel`——所以被替换会话里在跑的子代理不会变成孤儿，反过来
  也意味着交接会中断它们手上的活。时机是重点：**自动档**触发时该会话已经落定，立即退休；**手动档 `/handoff now` 跑在
  自己那一轮里**，此时归档会停掉正在渲染回执的那一轮，所以排到该会话的 `turn/end` 再退休（一次性，
  `session/disposed` 丢掉标记）。pi 侧不需要对应处理：它的 handoff 走 `ctx.newSession()`，是**替换**
  而非分叉，旧会话随之结束。阈值 0.4 早于 dsh 内置压缩的
  0.8，两者可共存。
- ②③④ 只作用于顶层会话（`origin !== "subagent"`），① 对子会话同样留档；各阶段的**异常**都写
  `.agents/memory/errors.log`，不打断会话（④ 的“交接延后”按设计不算异常，只记服务端日志）。
