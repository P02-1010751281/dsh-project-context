# 同类系统与组件级相似物调研

> 调研日期：2026-11-18。对象：`dsh-project-context` v0.4.3（四个 dsh 插件：会话存档 → 记忆整理 → 技能沉淀 → 上下文交接）。
> 原始证据：`.agents/evidence/2026-11-18-similar-projects-research/`（76 个原始文件，`manifest.tsv` 带 SHA-256）。
> 本文把「组件」理解为**流水线组件**（归档 / 整理 / 沉淀 / 交接，以及注入、检索、可观测），不是前端控件。

**目录**：0 结论 · 1 方法 · 2 全景 · 3 DSH 生态 · 4 同族仓库 · 5 跨宿主产品 · 6 宿主原生 · 7 研究谱系 · 8 矩阵 · 9 差异 · 10 借鉴清单 · 11 证据 · 12 术语

---

## 0. 结论摘要

1. **这个赛道已经拥挤，而且最近一圈就在同一个宿主里。** DSH 生态至少有 12 个记忆/上下文插件，其中
   `dsh-memory-evolve`、`dsh-auto-memory`、`dsh-mnemon`、`dsh-project-memory` 已经把「记忆 + 技能 +
   交接」中的两到三段做成了产品，并且有面板、检索、跨设备同步。我们不是「第一个做这件事的」，
   而是「把四段做成同一条可审计流水线的」。
2. **本项目的真正差异不是功能清单，而是写路径纪律。** 我们独有的四件套是：
   追加式 `memory.jsonl` 作为权威源、渲染文档作为派生、**有损回复整次拒绝且字节不变**（tier C）、
   以及每条拒绝/裁剪都有具名回执和 `errors.log` 行。竞品普遍是 DB-first 或「模型直接写文档」，
   优化的是召回率和体验，不是「一次坏整理不能吃掉旧事实」。
3. **交接有两种完全不同的解法，不能混为一谈。** 主流做法是**同会话压缩**（Claude Code、Codex、
   OpenHands、`dsh-block-ptc`）；我们做的是**开新会话 + 原文尾料 + 文件清单 +
   未答问题 + 父子会话元数据**。跨会话交接的产品（ai-memory、deja-vu、agentmemory）存在，但
   没有我们把「阈值膝 + 未答问题 + 在跑子代理 + 退休旧会话」做成门控。
4. **我们缺的是「第二层」：检索与可观测。** 有代表性的同类产品大多有语义/混合检索、记忆浏览器或
   每轮「本轮用了什么」的面板；我们只有设置卡、命令回执和 `errors.log`。归档和记忆都是纯文本，
   却没有一个「按需检索」的工具面。这是最便宜、收益最高的一块。
5. **不要照搬的方向**：DB-first 权威源、静默压缩、无审核的自动采纳技能、云端/服务端依赖。
   这些会直接破坏本仓库已有的不变量（可 diff、可回滚、无损失败、本地优先）。

**一句话定位**：别人做「更聪明的记忆」，我们做「不会悄悄丢事实的项目记忆 + 可验证的交接」；
下一轮应该把「可检索、可看见」补上，而不是把记忆做得更花。

---

## 1. 调研问题、方法与基线

### 1.1 问题

- 谁在解决同一个问题：coding agent 的项目级持久上下文（跨会话、跨压缩、跨工具）？
- 哪些系统只解决其中一段（组件级相似），它们的机制是什么？
- 本项目的四段流水线在 2026-11 的生态里处于什么位置？哪些是独有、哪些是落后？

### 1.2 纳入与证据规则

- 纳入六类：同宿主 DSH 插件、同族三仓库、跨宿主 coding-agent 记忆产品、宿主原生能力、
  记忆基础设施、研究原型。
- 外部断言只写在原始文件里读到的东西；厂商 benchmark 标注「厂商自述」；「未检出」只描述
  「在该文档/该版本里没读到」，不写成「不存在」。GitHub 星数是 2026-11-18 的 API 快照，
  只表示生态规模。
- 每条关键断言在证据包 `README.md` 里有「断言 → 文件」映射；本文引用时给相对路径。

### 1.3 本项目基线（用于比较的 8 条轴）

| 轴 | 本项目的事实（v0.4.3） |
|---|---|
| ① 归档 | 每轮 `turn/end` 追加 `session.jsonl`，idle/disposed 落 `session.md`；`INDEX.md` 是机械投影；`/session-log tree` 用 `meta.json.parentId` 读成森林；`/session-log import` 可回填 |
| ② 记忆权威源 | `memory.jsonl` 追加式权威，`MEMORY.md` 是渲染产物；四节 schema；`CONTEXT.md` 是工作态；任务会话写 `tasks/<slug>.md` |
| ② 整理 | idle/disposed + 轮数/间隔节流，或 `/memory update`；读入折叠 journal；模型返回优先 `record_memory` 工具，其次四节 Markdown |
| 有损防线 | 会丢整条目的回复先定向重试；仍丢则整次拒绝、`MEMORY.md` 字节不变、`lossy-refused`、释放版本声明；单条超 800 字符、段预算、整体 cap 各自具名 |
| ③ 技能 | 新材料 + 轮数/间隔 + 至少一个真实存档才触发；证据不足写 `skill-candidates/`；`autolearn-generated` 标记；`/autolearn approve/reject` |
| ④ 交接 | 仅 `turn/end` 评估；`auto` 阈值由质量膝/容量/安全边际取小；未答问题默认 `defer`；有在跑子代理延后；开新会话、写 `HANDOFF.md`、默认退休旧会话 |
| 注入 | `MEMORY.md` + `CONTEXT.md`（+ 绑定任务文档）每轮注入；常驻小节 + 指针；`interpolate:false` |
| 边界 | ②③④ 只对顶层会话生效；① 也归档子代理；纯本地文件；无服务端 |

这些事实来自本仓库 README、`docs/behavior.md`、`docs/settings.md` 与 `AGENTS.md`；不是外部推断。

---

## 2. 全景：六类玩家

| 类别 | 代表 | 与本项目的关系 |
|---|---|---|
| A. 同宿主 DSH 插件 | dsh-memory-evolve、dsh-auto-memory、dsh-mnemon、dsh-project-memory、dsh-meow-memory、dsh-noema、dsh-context、dsh-block-ptc、dsh-fish-memory | **直接竞争**：同一个宿主、同一批用户、同一类问题 |
| B. 同族仓库 | pi-project-context、codex-project-context | 同一套设计在另外两个宿主的实现，移植基线 |
| C. 跨宿主产品 | claude-mem、ai-memory、agentmemory、OpenViking、Trail-Code、deja-vu、Continuous-Claude、planning-with-files、Cline/Roo Memory Bank、ConPort、basic-memory、beads、SpecStory、Letta | 功能与体验上的参照；多数不绑定 dsh |
| D. 宿主原生 | Claude Code（auto memory / compaction / skills）、Codex（AGENTS.md / auto compact）、Gemini CLI、Cursor、Windsurf/Devin、Copilot、aider、OpenHands | 决定「用户为什么可能不装插件」 |
| E. 记忆基础设施 | mem0、Zep/Graphiti、Cognee、MemOS、MemU、memsearch、supermemory | 组件级机制来源（抽取、图、遗忘、技能演化） |
| F. 研究原型 | MemGPT、MemoryBank、A-MEM、Generative Agents、ACE、ReasoningBank、Voyager、AWM、ExpeL、Dynamic Cheatsheet、ACON、LongMemEval、Context Rot | 解释「为什么这样设计有效」 |

一个重要的生态观察：**「记忆」正在从插件功能变成宿主原生功能，又同时被插件商品化。** Claude Code
2026 年已有 auto memory + 自动压缩 + skills；Codex 有 AGENTS.md + `model_auto_compact_token_limit`；
DSH 生态则出现了十几家插件。对本项目而言，纯「记住更多」不是壁垒，**可信的写路径、可复核的归档、
可控的交接**才是。

---

## 3. 同宿主 DSH 生态：最近的一圈

### 3.1 总表（2026-11-18 快照）

星数来自 GitHub Search API；`—` 表示在 README 中未检出该能力，不等于产品没有。

| 插件 | 星 | 记忆 | 技能 | 交接/压缩 | 备注 |
|---|---:|---|---|---|---|
| `dsh-memory-evolve` | 851 | 五轨长期记忆 + 项目日志 + 归档 | 技能自我进化 + 技能管理 | 书签/分支、长会话 | 还带待办、多会话编排、记忆同步（git 分支） |
| `dsh-mnemon` | 1029 | 运行时记忆 + Project Documents | SKILL.md 进化 + 回测 | 文档含 handoff | 每轮「本轮用了什么」记忆条、可编辑 Memory System |
| `dsh-meow-memory` | 397 | 七层 SQLite | — | reflect/dream | 228 项逻辑测试（README 自述） |
| `dsh-project-memory` | 32 | 文档/代码符号/经验/洞察混合索引 | 洞察含 procedures 层 | 「survives compaction and handover」 | 任务桥、`path:line` 引用、触发式注入 |
| `dsh-auto-memory` | 204/133（两个同名仓库） | 三层记忆 + 主动召回 | 对话结晶为技能 | **四段式 handoff 笔记 + 阈值 0.75** | 召回证据链、Recall review |
| `dsh-noema` | 147 | 持久召回 + 实体抽取 + 导入 | — | — | 设置页管理、keep-alive |
| `dsh-fish-memory` | 525 | 会淡忘的长期记忆、每条带时间 | — | — | 可视化星图（同作者生态） |
| `dsh-context` | 5245 | —（上下文洞察） | — | 记录 compact/prune | 七类上下文占用、Skill Injections 单列 |
| `dsh-block-ptc` | 103 | — | — | AI 自主决定 compact 块与保留内容 | append-only 会话日志上做块压缩 |
| `memsearch` | 2894 | `.memsearch/memory` + PROJECT.md/USER.md | **从记忆蒸馏技能** | — | 支持 DSH（另有 Claude/Codex 等 20+） |
| `memtrace` | 515 | 双时态图 + 事件 | 17 个使用技能 | session-continuity 技能 | 零 LLM 调用、25+ MCP 工具 |
| `mneme` | 238 | 文件记忆 + autoDream | — | — | 空闲合并/压缩/归档，整理留 receipt |

> 星数是快照，且同名/分叉仓库会分裂计数（`dsh-auto-memory` 有两个仓库）。不要把星数当质量。

### 3.2 四个最接近的深描

**(1) `dsh-memory-evolve`（功能最全的「大而全」）**
五轨记忆（项目关键记忆、项目日志、归档、全局用户档案、每日日志等）、按 git 分支生效的记忆、
回合内自我审查（默认关）、技能自我进化与技能管理器、四轨待办、书签/分支、记忆同步（把记忆放到
代码仓库的专属分支或独立共享仓库）、会话编排与外部代理派单。它把「记忆 + 技能 + 交接 + 协作」
做成了一个套件，代价是配置面和概念面都更重。证据：`sources/dsh-memory-evolve.md`。

**(2) `dsh-mnemon`（最像「第二层」的体验）**
三类记忆：每轮注入的 runtime memory（USER.md/MEMORY.md）、按需检索的 Project Documents、以及
可进化的 Skills。它的差异点是**可见性**：每条回复下面有 turn memory bar，列出本轮读了/写了
哪些文档与记忆，一键打开；技能进化会「起草新 SKILL.md → 对当前版本回测 → 你采纳」。
证据：`sources/dsh-mnemon.md`。

**(3) `dsh-project-memory`（最像「项目记忆」的索引）**
TaskBridge 把会话 todo 和触碰过的文件持久化成跨会话任务；文档分块摘要、代码符号扫描、经验笔记
（问题→解法，按重叠去重）、分层洞察（lesson/decision/procedure，近似合并、按使用衰减）；
召回带 `path:line` 引用；注入有 trigger/guard/prevents 三门，且「证据分级」：只有宿主事实
（结构化工具调用、fs/todo 事件）和人类点名的不可逆动作能注入全文。它把「记忆该不该注入」
做成了权限模型。证据：`sources/dsh-project-memory.md`。

**(4) `dsh-auto-memory`（最像「交接」的同宿主实现）**
明确反对「把整本书烧成一行书评」的压缩，改为**四段式 handoff 笔记**（状态、目标、死路及原因、
进度与下一步），关掉当前窗口开下一个，完整历史仍可搜索；默认阈值 0.75；三层记忆 + 主动召回
（host 监视上下文，在模型开口前注入）+ 召回证据链 + 对话结晶为技能。证据：
`sources/dsh-auto-memory.md`。

### 3.3 组件型：不是竞品，但会吃掉某一格

- `dsh-block-ptc`：把「何时压缩、压哪些块、保留什么」交给模型，通过 `block_compact({ids, content})`
  在 append-only 日志上做块级压缩；原生自动压缩仍是 fallback。它证明「压缩」在 DSH 里可以是
  一等公民。
- `dsh-context`：不做记忆，只做**上下文账本**——七类占用、每次注入/压缩/清理/模型切换的净变化、
  Skill Injections 单独成类。它是「可观测」这一格的标杆。
- `memtrace`：双时态图 + 零 LLM 调用 + 25+ MCP 工具 + 17 个技能；`memsearch`：把重复工作流
  蒸馏成可安装技能，并维护 PROJECT.md/USER.md。
- `mneme`：`autoDream` 空闲时合并重复、压缩陈旧、归档过期，整理过程留 receipt（输入快照、
  决策、结果哈希）。

### 3.4 这一圈给出的结论

1. **同宿主竞争已经不靠「有没有记忆」，而靠「记忆怎么被看见、怎么被检索、怎么被信任」。**
2. 在我们读到的 DSH 插件里，「归档 → 整理 → 沉淀 → 交接」四段全链未见第二家；但 `dsh-memory-evolve`
   和 `dsh-auto-memory` 已经覆盖三段，`dsh-mnemon` 的体验明显更好。
3. 我们唯一明显领先的是**写路径的可验证性**（journal 权威、字节不变量、具名拒绝、回执）；
   这在竞品 README 里基本没有对应表述。

---

## 4. 同族仓库：dsh / pi / codex

三仓库做同一件事，宿主不同，实现形态与发布节奏不同；本仓库不改另外两个的工作树，只读勘查。

| | dsh-project-context | pi-project-context | codex-project-context |
|---|---|---|---|
| 宿主 | dsh 的 `ctx` 事件/服务 | pi extension | Codex hook 协议（子进程） |
| 形态 | TypeScript，4 个 cordis 插件 | TypeScript，`extensions/` 入口 | Python，`hooks/context_hook.py` + `scripts/contextctl.py` |
| 版本 | 0.4.3 | v0.4.14（最新 tag） | 无 tag，`plugin.json` 版本 |
| 跟踪文件 | 546（2026-11-18 现读；AGENTS 快照为 423） | 577 | 16 |
| 四段 | 全部 | 全部 | 全部（由 maintenance skill 执行整理） |
| 交接差异 | 原文尾料 + 文件清单 + 未答问题 + 父子 meta | 额外的 replay-safe marker、会话日志指针 | SessionStart 注入、Stop 触发维护 |
| 技能 | `autolearn-generated` 标记 + 候选/批准 | 同类机制 + `/autolearn approve` | skills 目录 + 覆盖规则 |
| 测试 | `node --test`，39 个测试文件（2026-11-18 现读） | 自有测试套件 | `tests/run_tests.py` |

本地快照：`local/siblings-snapshot.txt`（HEAD、分支、最后提交、README 哈希）。

**判断**：同族仓库不是竞品，是**移植基线**。pi 的交接多了 replay-safe marker 与会话日志指针；
codex 把整理交给 maintenance skill、没有辅助模型调用；这些差异在 `docs/sibling-repos.md` 与
`docs/harness/` 已有登记。本次调研不重复展开，只提醒：**跨仓移植时必须先读那里的写路径**，
不能按本仓的不变量推断。

---

## 5. 跨宿主产品

### 5.1 七个「整套系统」级样本

**claude-mem（~118k stars，Apache-2.0）** — 最接近「自动记忆」的产品形态。9 类 hook 把工具调用
交给本地 worker，第二个 agent 把活动写成 observations，会话结束写 summary；新会话以「索引 +
分层展开」注入；存储是 SQLite（sessions/observations/summaries）+ Chroma 语义检索；有 viewer、
My Work、TeamBrain、`<private>` 脱敏。**据其 README**，它没有项目级「记忆文档 + 预算 + 有损拒绝」，
也没有阈值触发的新会话交接。证据：`sources/claude-mem.md`。

**OpenViking（火山引擎，~42k stars，AGPL-3.0）** — 把知识、记忆、技能统一成 `viking://` 虚拟文件
系统，目录带 L0 摘要 / L1 概览 / L2 全文三级；会话提交后成为可读文件并抽取记忆；技能是目录；
有 Studio、CLI、MCP。它代表「上下文数据库」路线：**用文件系统语义解决可检查性**，和我们的
「纯 Markdown + 指针」是同一哲学的不同规模。证据：`sources/openviking.md`。

**ai-memory（~16k stars，MIT）** — 与本项目四段最同构的跨宿主产品：
`capture（hooks）→ consolidate（session-end 摘要成 wiki 页）→ recall（全文/实体/链接/可选向量）→
handoff（下一个 agent，任意 harness）`。它明确说「每个平台的原生记忆都只属于一个 agent、一台机器」，
用共享 wiki + bounded brief + 显式 handoff 解决。证据：`sources/ai-memory.md`。

**agentmemory（~30k stars，Apache-2.0）** — 本地 server + 12 hooks + 54 MCP 工具 + 四层记忆 +
三种召回流 + 17 个技能（`remember`/`recall`/`recap`/`handoff`/`lesson`/`commit-context` 等）；
有 viewer、session replay、knowledge graph。它把「记忆」做成平台，任何 agent 通过 MCP/REST 接入。
证据：`sources/agentmemory.md`。

**Trail-Code（~11k stars，MIT）** — 两条腿：tree-sitter 的 code map（graft）+ 团队 learnings。
learnings 是**提交进仓库的 Markdown**，带 `touches` 文件、`Decided / Tried and ruled out / Watch out`
三段，PR 里像代码一样 review；`trail check` 会把改动与 learnings 冲突点名；技能一栏写「soon」。
它是「技能/经验沉淀」最接近我们 autolearn 的产品，但把**人类 review 放在 git 里**而不是
模型证据门。证据：`sources/trail-code.md`。

**deja-vu（~1.6k stars，MIT）** — 不做自己的记忆格式，直接读 48 个 agent 的本地会话存储，提供
跨 agent 搜索、`deja handoff --to codex`、`restore`（恢复被覆盖的代码）、`blame`、`audit`；
仓库记忆是 `.deja/memory.jsonl`，候选由人挑选、脱敏后写入、`merge=union`。它是「归档 + 交接」
的极简路线。证据：`sources/deja-vu.md`。

**Continuous-Claude（~4k stars，MIT）** — 用 PostgreSQL+pgvector 存 archival memory；会话结束由
daemon 起 headless Claude 分析 **thinking blocks** 抽 learnings；另有 continuity ledger
（`thoughts/ledgers/CONTINUITY_<topic>.md`）保存会话内状态。它证明「从推理过程而不是结果抽记忆」
是一个可产品化的信号源。证据：`sources/continuous-claude.md`。

### 5.2 六个「轻量/文件型」样本

| 系统 | 机制 | 与本项目的差别 |
|---|---|---|
| Cline Memory Bank | 固定 6 个 Markdown（projectbrief/productContext/activeContext/systemPatterns/techContext/progress），靠规则让 agent「initialize/update memory bank」 | 无自动整理、无预算、无有损防线；交接靠手动 `/newtask` |
| Roo Code Memory Bank | 同上，Architect/Code 模式在变更时主动更新 | 仍是文档约定，不是写路径 |
| planning-with-files | `task_plan.md`/`findings.md`/`progress.md` 三文件；hook 每轮注入；在 60+ agent 上以 Agent Skills 安装 | 解决「计划不丢」，不解决长期记忆与技能；明确支持 dsh |
| ConPort（context-portal） | 每 workspace 一个 SQLite，项目知识图谱 + 向量检索，MCP 工具面 | DB-first；无归档流水线；无交接种子 |
| basic-memory | Markdown + wikilinks 的知识图谱，双向读写，MCP | 通用知识库，不是项目会话记忆；无预算/整理/交接 |
| claude-code-log | 会话 JSONL → HTML/Markdown、TUI、watch、token 统计 | 只读展示与浏览；无记忆、无整理、无交接 |

### 5.3 记忆基础设施：组件级参照

| 系统 | 核心机制 | 对本项目的映射 |
|---|---|---|
| Letta（MemGPT） | memory blocks（label + description + 字符上限，可共享）；MemFS（git-backed）；`/init`、`/doctor` 审计放置/重复/系统提示 token；`/remember`；**dreaming** 用后台 subagent 复盘会话、合并教训；重组前备份 | 与我们的「整理 + 预算 + 去重」最接近；dreaming 是「后台 pass」的产品化 |
| mem0 | ADD-only 单次抽取（不 UPDATE/DELETE），实体抽取+链接；图变体；厂商自述 LoCoMo 92.5 / LongMemEval 94.4 | 抽取式记忆的默认范式；与我们的「整篇文档重写 + 去重」相反 |
| Zep / Graphiti | 时序知识图谱：事实带有效期、双时态、增量更新、混合检索；DMR 94.8 vs MemGPT 93.4（论文） | 我们有意不做图：纯文本可 diff 是更强的审计性 |
| Cognee | 文档/代码/会话 → 图 + 向量；`improve` 把 session 知识桥接进图；**session distillation 把被接受的教训纳入永久记忆** | 「教训」与 autolearn 同构 |
| MemOS | 统一 Memory API；本地插件 SQLite + FTS5 + 向量；**L1 traces / L2 policies / L3 world model 的分层技能演化** | 技能分层比我们的单层 `SKILL.md` 更细 |
| MemU | 轻量 agent-driven：宿主 adapter 读会话 → `prepare` 切 job → agent 决定新建/修补/不动 → `commit` 写 Markdown 技能并索引；`MemoryService` 本身不调 LLM | 与 autolearn 的「模型判断 + 机械写入」几乎同构 |
| memsearch | 从重复工作流蒸馏可安装技能；后台维护 PROJECT.md/USER.md；DSH 有 dock | 同宿主直接竞品（技能 + 项目文档） |
| 官方 Memory MCP server | 本地 JSON 知识图谱（entities / relations / observations），跨会话持久 | 通用记忆的最小实现；没有项目会话、归档、预算与交接 |
| supermemory | 记忆/上下文引擎 API，可本地部署 | 基础设施型，不直接竞争 |

---

## 6. 宿主原生能力：用户为什么不装插件

| 宿主 | 持久上下文 | 压缩/交接 | 技能 | 结论 |
|---|---|---|---|---|
| Claude Code | CLAUDE.md 多级加载 + `@import` + `.claude/rules`（路径生效）+ **auto memory**：`~/.claude/projects/<project>/memory/{MEMORY.md, topic 文件}`；MEMORY.md 前 200 行或 25KB 注入；写超限会报错要求重写索引；条目可带修改时间 | 自动 compact + `/compact [focus]`；压缩后保留启动内容、最近 5 个读写文件（>5k token 只留路径）、skill 正文、SessionStart `compact` hook 输出 | Agent Skills（SKILL.md，名称/描述常驻，正文按需） | 原生覆盖「记忆 + 压缩 + 技能」，但**压缩是同一会话**，不是新会话交接；auto memory 是模型在会话中随手写，无整理 pass |
| Codex | AGENTS.md 全局/项目分层；`model_auto_compact_token_limit`（默认随模型）、turn-end compaction、`model_post_turn_compact_threshold_percent`、可替换 compact prompt | 自动压缩 + resume | —（未见技能机制） | 原生覆盖「静态指令 + 压缩」，无项目记忆整理 |
| Gemini CLI | 三层 GEMINI.md（仓库 / 私有项目 / 全局），模型用 `write_file`/`replace` 直接编辑 | — | — | 「模型直接改 Markdown」的极简路线 |
| Cursor | 四类规则：Project / User / Team / AGENTS.md；`.cursor/rules` 路径生效 | — | — | 当前文档只讲 Rules；`/context/memories` 入口返回 Rules 页，未检出自动记忆 |
| Windsurf | 文档已切到 Devin Local：AGENTS.md / `.devin/rules/*.md` / hooks / skills | — | skills（Devin） | 产品线重组，记忆叙事弱化 |
| GitHub Copilot | 仓库级 custom instructions（`.github/copilot-instructions.md` 等） | — | — | 静态指令 |
| aider | `CONVENTIONS.md` + `/read` 或 `--read` | — | — | 静态指令，无自动记忆 |
| OpenHands | Skills（Agent Skills；旧 microagents 目录仍兼容） | `LLMSummarizingCondenser`：超阈值时保留最早若干事件 + 最近消息，中段用 LLM 摘要替换 | ✅ Skills | 压缩是 in-session；无项目记忆 |
| OpenAI Agents SDK | Sessions（会话持久化） | — | — | 基础设施：session 存储，无记忆语义 |

**结论**：宿主原生把「静态指令 + 同会话压缩 + 技能」变成了默认能力。这意味着：
- 我们的 ②「记忆整理」必须比 auto memory 更可信（否则用户用原生的就够了）；
- 我们的 ④「交接」必须强调「新会话 + 原文尾料 + 门控」，因为原生压缩不解决「会话已经脏了、
  需要换一个干净窗口」的场景；
- 我们的 ③「技能沉淀」要面对 Agent Skills 生态的竞争：技能格式已被标准化，价值在「从项目证据
  里长出来」，不在格式。

---

## 7. 组件级研究谱系：每个阶段为什么这样设计

### 7.1 归档与索引

- **Generative Agents**（arXiv 2304.03442）：完整记录经历 → 随时间合成更高层 reflection → 动态
  检索。它把「记忆流 + 反思 + 检索」三件套讲清楚；我们的 journal→render 是「记忆流 + 机械渲染」，
  reflection 由模型在整理 pass 里做。
- **LongMemEval**（2410.10813）：长期记忆的五项能力（抽取、多会话推理、时间推理、知识更新、拒答）；
  索引/检索/阅读三阶段；商业助手在持续交互上有约 30% 的准确率下降。它是「记忆要能被测量」的
  基准，也解释了为什么「只注入一大段文档」不够。
- **claude-code-log / SpecStory**：把会话 JSONL 变成可读 HTML/Markdown、可搜索、可恢复。归档本身
  是独立品类；我们的 `INDEX.md` + `tree` 是「机械索引」，比它们更结构化，但没有搜索/浏览 UI。

### 7.2 记忆整理：reflection、遗忘、图

- **MemoryBank**（2305.10250）：受艾宾浩斯遗忘曲线启发，按时间与重要性遗忘/强化。我们目前是
  **按年龄退休**（Z2）而不是按重要性/使用频率衰减；这是可借鉴但需谨慎的一格。
- **MemGPT**（2310.08560）：虚拟上下文管理，快/慢记忆分层 + 中断。它是「把上下文当 OS 管理」的
  原型；Letta 的 blocks/MemFS/dreaming 是它的产品化。
- **A-MEM**（2502.12110）：Zettelkasten 式动态索引与链接，新记忆可触发旧记忆的属性更新。
  我们的「条目 id + supersedes + 去重」是它的极简版，但没有「链接网络」。
- **ACE**（2510.04618）：把上下文当**演化中的 playbook**，用 generation/reflection/curation 的
  模块化增量更新，明确对抗 **brevity bias** 与 **context collapse**（迭代改写侵蚀细节）。
  这两个词几乎就是本仓库 tier C / 字节不变 / 整条目不丢的设计动机；ACE 的「结构化增量更新」
  是我们 journal + 渲染的另一种表述。
- **Letta dreaming**：后台 subagent 复盘、合并、重组，重组前备份；`/doctor` 审计放置/重复/token。
  这是「整理 pass」最完整的产品化参照。

### 7.3 技能沉淀：从经验到可复用单元

| 工作 | 机制 | 与本项目 autolearn 的关系 |
|---|---|---|
| Voyager（2305.16291） | 可执行代码的技能库 + 自动课程 + 迭代提示（环境反馈/错误/自验证） | 技能是「可执行程序」；我们是「Markdown 指令 + 证据门」 |
| Agent Workflow Memory（2409.07429） | 从轨迹归纳可复用 workflow，离线/在线注入 | 我们的 autolearn 是「从会话证据归纳项目技能」 |
| ExpeL（2308.10144） | 从成功/失败经验抽自然语言 insight，推理时召回 | 与「候选 → 批准」同构，但 ExpeL 不做人类门 |
| Dynamic Cheatsheet（2504.07952） | 持久、自 curated 的策略/代码片段记忆，测试时学习 | 我们的 `SKILL.md` 更像「项目 cheatsheet」 |
| ReasoningBank（2509.25140） | 从自判成功/失败中蒸馏推理策略；MaTTS 用更多经验改进记忆 | 「证据不足写 candidates」与「自判失败」可互补 |
| ACE（2510.04618） | playbook 增量更新，避免 brevity bias / context collapse | 技能文档也会「越改越薄」；我们的预算/去重是防线 |
| MemU / memsearch | agent 决定新建/修补/不动，机械提交并索引；从重复工作流蒸馏 | 与 autolearn 最接近的产品形态；它们更强调后台与 UI |

**结论**：技能沉淀的学术共识是「从经验中蒸馏可复用策略，并防止迭代改写侵蚀细节」。我们的
「证据门 + 候选/批准 + `autolearn-generated`」在**治理**上更强，在**抽取信号**（只用会话摘要）
和**回测**（没有）上更弱。

### 7.4 交接与压缩：两种问题，两套指标

- **同会话压缩**：Claude Code 自动 compact（保留启动内容 + 最近 5 文件 + skill 正文 + hook 输出）；
  Codex auto compact；OpenHands condenser（保留首尾、摘要中段）；`dsh-block-ptc` 让模型决定压哪些块；
  ACON（2510.00615）用失败分析迭代压缩指南，峰值 token 降 26–54%。
- **跨会话交接**：ai-memory 的显式 handoff、deja-vu 的 `handoff --to`、agentmemory 的
  `session_handoff`、`dsh-auto-memory` 的四段式笔记。它们共享一个判断：**摘要会丢「为什么」，
  所以要把状态/目标/死路/下一步结构化带过去**。
- **长上下文退化**：Context Rot（Chroma，18 个模型）显示性能随输入长度非均匀下降；Anthropic 的
  context engineering 文章给出 compaction / structured notes / sub-agents 三件套，并强调
  「最小高信号 token 集」。本仓库的膝曲线（`docs/changelog/v0.2.0.md`：拟合自 MRCR 8-needle 的
  46 个 ≥1M 模型，饱和在 ~157K）与「不要等到窗口满」是同一判断的定量版。
- **术语冲突**：多智能体框架里的 `handoff` 指「把任务转给另一个 agent」；本项目指「把上下文
  交接给新会话」。报告与文档里应始终写清是「会话交接」。

### 7.5 渐进披露

- **Agent Skills 规范**：`name` + `description` 常驻系统提示，正文按需读取，附属文件第三级。
  这与本仓库 ② 的「常驻小节 + 指针」、③ 的「description 常驻、body 按需拉取」同构；也是
  OpenViking L0/L1/L2、claude-mem 索引分层、dsh-mnemon 三类记忆的共同逻辑。
- 结论：**渐进披露已是行业默认**，我们的实现不落后；差距在「按需」那一半——别人有检索工具，
  我们只有「读整份文档」。

---

## 8. 对比矩阵

符号：✅ 覆盖；◐ 部分/不同解；— 在该来源中未检出。**不是质量评分**；「未检出」只限于读到的文档。

### 8.1 系统级（选 26 个代表）

| 系统 | ①归档 | ②整理/权威 | 有损防线 | ③技能 | ④交接 | 注入/召回 | 跨工具 | 可观测 |
|---|---|---|---|---|---|---|---|---|
| **dsh-project-context** | ✅ 每轮+索引+树+导入 | ✅ journal→文档 | ✅ 拒绝+字节不变 | ✅ 证据门+候选 | ✅ 新会话+尾料+门控 | ✅ 常驻+指针 | — | ◐ 回执/日志 |
| pi-project-context | ✅ | ✅ | ✅ | ✅ | ✅ + replay-safe | ✅ | —（pi） | ◐ |
| codex-project-context | ✅ | ✅（maintenance skill） | ◐ | ✅ | ✅ | ✅ | —（codex） | ◐ |
| claude-mem | ✅ 观察/摘要 | ◐ SQLite | — | ◐ 检索技能 | ◐ 会话启动注入 | ✅ 分层索引 | ✅ 15+ agent | ✅ viewer |
| OpenViking | ✅ 会话文件 | ✅ FS+摘要 | ◐ | ✅ 技能目录 | ◐ 会话提交 | ✅ L0/L1/L2 | ✅ | ✅ Studio |
| ai-memory | ✅ hooks | ✅ wiki 页 | ◐ | — | ✅ 显式跨 agent | ✅ bounded brief | ✅ 20+ | ◐ 控制台 |
| agentmemory | ✅ 会话/replay | ✅ 四层 | ◐ | ◐ lessons+17 技能 | ✅ `handoff` | ✅ 混合检索 | ✅ | ✅ viewer |
| Trail-Code | — | ✅ learnings 文件 | — | —（README 标 soon） | — | ✅ 每 prompt | ✅ 3 agent | ◐ |
| deja-vu | ✅ 读 48 家 | ◐ 手工候选 | — | — | ✅ `--to` | ✅ 搜索 | ✅ 48 | ✅ view |
| Continuous-Claude | ◐ ledger | ✅ pgvector | ◐ | ◐ 109 技能库 | ✅ ledger | ✅ | — | ◐ |
| planning-with-files | ◐ 三文件 | ◐ 无整理 | — | ✅ 一个 skill | ◐ 抗 /clear | ✅ 每轮 hook | ✅ 60+ | ◐ |
| Cline Memory Bank | — | ◐ 6 文档手动 | — | — | ◐ 手动新任务 | ✅ rules | — | — |
| ConPort | — | ✅ SQLite KG | ◐ | — | ◐ | ✅ MCP | ✅ MCP | ◐ |
| basic-memory | — | ✅ Markdown KG | — | — | — | ✅ MCP | ✅ MCP | ◐ |
| beads | — | ✅ 图+衰减 | ✅ 压缩 | — | ◐ `bd prime` | ✅ | ✅ | ✅ Dolt |
| SpecStory | ✅ | ◐ | — | ◐ Lore | ✅ resume | — | ✅ | ✅ |
| Letta | ◐ | ✅ MemFS+dreaming | ◐ 备份 | ◐ | ✅ 压缩触发 | ✅ blocks | ◐ | ✅ |
| mem0 | — | ✅ ADD-only | ◐ | — | — | ✅ API | ✅ | ◐ |
| Zep/Graphiti | — | ✅ 时序图 | ◐ | — | — | ✅ 混合 | ✅ | ◐ |
| MemOS | — | ✅ | ◐ | ✅ L1/L2/L3 | ◐ | ✅ | ✅ | ✅ |
| MemU | — | ✅ wiki | ◐ | ✅ 自动技能 | — | ✅ | ✅ | ◐ |
| memsearch | — | ✅ | ◐ | ✅ 从记忆蒸馏 | ◐ | ✅ | ✅ | ✅ |
| **Claude Code** | ◐ transcripts | ◐ auto memory | ◐ 超限报错 | ✅ skills | ✅ 同会话压缩 | ✅ | — | ✅ /memory |
| **Codex** | ◐ rollouts | ◐ AGENTS.md | ◐ | — | ✅ auto compact | ✅ | — | ◐ |
| **Gemini CLI** | — | ◐ GEMINI.md 三层 | ◐ | — | ◐ | ✅ | — | ◐ |
| **OpenHands** | — | — | ◐ | — | ✅ condenser | ✅ Skills | — | ◐ |

### 8.2 DSH 同宿主（补充）

| 插件 | ②记忆 | ③技能 | ④交接 | 注入/召回 | 可观测 |
|---|---|---|---|---|---|
| dsh-memory-evolve | ✅ 五轨 | ✅ 自我进化+管理 | ✅ 书签/分支 | ✅ | ✅ tabs |
| dsh-mnemon | ✅ 运行时+文档 | ✅ 进化+回测 | ◐ | ✅ | ✅ turn bar |
| dsh-project-memory | ✅ 混合索引+洞察 | ◐ procedures | ◐ | ✅ 触发式 | ✅ panel |
| dsh-auto-memory | ✅ 三层 | ✅ 结晶 | ✅ 四段+0.75 | ✅ 主动召回 | ✅ hub |
| dsh-meow-memory | ✅ 七层 | — | ◐ | ✅ | ◐ |
| dsh-noema | ✅ | — | — | ✅ | ✅ 设置页 |
| dsh-block-ptc | — | — | ✅ AI compact | — | ◐ |
| dsh-context | — | — | 记录 compact | — | ✅ 账本 |
| dsh-fish-memory | ✅ 衰减 | — | — | ✅ | ◐ |
| memtrace | ✅ 双时态图 | ◐ 使用技能 | ◐ continuity | ✅ MCP | ✅ |
| mneme | ✅ autoDream | — | — | ✅ | ✅ 面板 |
| memsearch | ✅ | ✅ | ◐ | ✅ | ✅ dock |

---

## 9. 差异分析

### 9.1 我们独有的（有代码/文档依据）

1. **追加式 journal 作为唯一权威，Markdown 是渲染产物**。竞品要么 DB-first（ConPort、mem0、Zep、
   agentmemory），要么「模型直接写文档」（Cline、Claude auto memory、Gemini）。在我们读到的系统里，
   只有我们把「权威日志」与「可读文档」分开，并且文档可被外部编辑后按基线拒绝覆盖。
2. **有损写入的硬闸**：会丢整条目的回复先重试，仍丢则整次拒绝、`MEMORY.md` 字节不变、
   `lossy-refused`、释放版本声明；单条 800 字符、段预算、整体 cap 分别具名。竞品最多有
   「超限提醒」（Claude Code 的 MEMORY.md 超 200 行/25KB 会报错），没有「整次拒绝」。
3. **机械归档与记忆解耦**：`session-logs/<id>/` + `INDEX.md` + `parentId` 森林，归档不依赖模型；
   在我们读到的实现里，claude-mem/SpecStory 归档但不产项目记忆，Cline/Letta 有记忆但没有机械归档。
4. **交接是新会话，不是压缩**：原文尾料 + 文件清单 + 未答问题 + 父子 meta + 退休旧会话；门控是
   「阈值 + 未答问题 + 在跑子代理 + 本会话未再开新轮」。跨会话产品有 handoff，但没有这套门控。
5. **技能沉淀有证据门与取代标记**：`autolearn-generated`、候选/批准、正文未展示则拒绝。
   竞品的技能进化多是「建议 + 回测 + 你采纳」（mnemon）或「agent 决定」（MemU），没有
   「本轮没看到正文就不许写」这类机械门。
6. **四段共享一份配置/设置卡，纯本地、无服务端**：同宿主竞品里，memory-evolve 有同步/编排、
   mnemon 有 Memory System、auto-memory 有 hub；我们最轻，但也最「可审计」。

### 9.2 别人有、我们没有的

1. **检索**：语义/混合/图检索（OpenViking、agentmemory、memsearch、mnemon、mem0、Zep、MemOS）。
   我们的召回是「读整份 MEMORY.md/CONTEXT.md」，没有「按问题找条目」。
2. **可观测 UI**：viewer、turn memory bar、记忆浏览器、上下文账本（claude-mem、mnemon、
   dsh-context、dsh-project-memory）。我们只有设置卡 + 回执。
3. **跨工具/跨设备**：ai-memory、deja-vu、agentmemory、OpenViking、Letta MemFS、
   memory-evolve 同步；我们只服务 dsh。
4. **任务面板/文件符号记忆**：dsh-project-memory 的 TaskBridge + 代码符号 + `path:line`；
   memtrace 的双时态图；我们只有任务文档 + todo 行。
5. **衰减/重要性**：MemoryBank 的遗忘曲线、beads 的 memory decay、mneme 的 heat；
   我们只有年龄退休（Z2）与段预算。
6. **技能回测**：mnemon 的 draft→backtest→adopt；我们没有回测，只有证据门。
7. **主动召回**：dsh-auto-memory 在模型开口前按上下文召回；我们是固定注入 + 指针。

### 9.3 「相似但不同解」

| 问题 | 主流解 | 我们的解 | 取舍 |
|---|---|---|---|
| 上下文满了 | 同会话压缩/摘要 | 开新会话 + 原文尾料 | 我们保留「为什么/死路」，代价是用户要接受新会话 |
| 记忆存哪 | DB/图/向量 | Markdown + journal | 我们可 diff/可回滚，代价是无检索 |
| 谁来写记忆 | 模型随手写 / 后台 agent | 模型提议 + 机械校验 + 拒绝 | 我们防丢事实，代价是整理更重、更慢 |
| 技能怎么长 | 自动采纳/回测 | 证据门 + 候选 + 人工批准 | 我们更可控，代价是采用率低 |
| 记忆怎么用 | 语义召回 | 常驻摘要 + 指针 + 读全文 | 我们省 token、可预测，代价是「找不到」 |

### 9.4 定位建议

- **不要**在「记忆量、召回率、图、向量」上跟基础设施型产品竞争；那是另一个资本与数据游戏。
- **要**把「不会悄悄丢事实」做成可证明的卖点：拒绝回执、字节不变、版本基线、可复验的
  `errors.log`。这是竞品 README 里几乎没有的语言。
- **要**补「第二层」：检索 + 可视化。否则用户会被 mnemon/auto-memory 的体验吸走，
  即使我们的写路径更稳。
- **要**把「交接」讲成独立品类：不是压缩，是「换一个干净窗口继续」，并把门控与种子内容
  做成可检查的回执。

---

## 10. 可借鉴清单

### P0（便宜、直接补短板）

1. **只读检索面**：给归档与记忆加一个「按关键词/路径/会话 id 查」的工具或命令（先不做向量）。
   竞品证明「能查到」比「记得多」更影响日常体验；我们的纯文本天然适合 BM25/子串检索。
2. **记忆/归档状态面板**：至少一个 `/memory status` 或卡片区块，显示四节占用、条目数、最近一次
   整理结果、上次拒绝原因、归档数/索引行数。`dsh-context` 证明「账本」本身就是产品。
3. **交接回执可视化**：把「带了什么（尾料/文件/未答问题）、为什么触发、旧会话是否退休」做成
   一段可复制的回执；这是与「压缩」区分开的最便宜方式。

### P1（中期）

4. **技能回测/证据回执**：autolearn 采纳前，用一组历史会话检查新技能是否与既有 `SKILL.md`/
   `MEMORY.md` 冲突；至少记录「依据哪几条会话」。mnemon 的回测是参照。
5. **跨工具导出**：把 `MEMORY.md`/`CONTEXT.md` 投影成 `AGENTS.md` 兼容段落（只读导出），
   让不用 dsh 的协作者也能看到项目记忆；不做双向同步。
6. **任务面板**：把 `tasks/<slug>.md` + todo 投影做成只读列表（先不做编辑），对标 TaskBridge
   的最低配。

### P2（谨慎）

7. **按使用/重要性的衰减**：现有 Z2 是年龄退休；引入「使用频率」会改变不变量（条目不再只由
   正文哈希识别），需要单独一批设计与测试。
8. **代码符号索引**：与本项目的「项目记忆」相邻，但会引入语言解析依赖；dsh-project-memory
   已证明其价值，也证明其成本。

### 不建议照搬

- **DB-first 权威源**：破坏可 diff、可回滚、可手工修。
- **静默压缩**：与 tier C 的「拒绝有损」直接冲突。
- **无审核自动采纳技能**：与 `autolearn-generated` 的治理相反。
- **云端/服务端依赖**：与本仓库「纯本地、无服务端」的边界冲突。
- **把「记忆条数/召回率」当 KPI**：我们的价值是「事实不丢」，不是「记得多」。

---

## 11. 证据、复验与未闭合项

### 11.1 证据包

- [证据包 README](../../.agents/evidence/2026-11-18-similar-projects-research/README.md)：方法、选择标准、
  断言→文件映射。
- [sources.md](../../.agents/evidence/2026-11-18-similar-projects-research/sources.md)：76 个原始文件的清单
  （URL、字节、哈希前缀、抓取时间）。
- [manifest.tsv](../../.agents/evidence/2026-11-18-similar-projects-research/manifest.tsv)：完整 SHA-256，
  复验以此为准。
- [comparison-matrix.csv](../../.agents/evidence/2026-11-18-similar-projects-research/comparison-matrix.csv)：
  本报告矩阵的机器可读版本（36 行）。
- [api/](../../.agents/evidence/2026-11-18-similar-projects-research/api)：GitHub Search/Repo API 原始 JSON、
  arXiv Atom XML。
- [local/siblings-snapshot.txt](../../.agents/evidence/2026-11-18-similar-projects-research/local/siblings-snapshot.txt)：
  三个同族仓库的 HEAD/分支/最后提交/文件数/README 哈希。

### 11.2 复验命令

```bash
cd .agents/evidence/2026-11-18-similar-projects-research
# 哈希核对（manifest 是权威）
while IFS=$'\t' read -r t slug code size sha url; do
  f=$(ls sources/"$slug".* 2>/dev/null | head -1) || { echo "MISSING $slug"; continue; }
  [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$sha" ] || echo "MISMATCH $slug"
done < manifest.tsv
```

### 11.3 未闭合项

1. **厂商 benchmark 未复现**：mem0 / Zep / OpenViking / agentmemory 的数字是来源自述；本报告只当
   「厂商声称」，不当定论。
2. **没有逐个安装试用**：所有机制判断来自 README/官方文档/规范；「是否真的这样跑」需要各自
   安装后验证，尤其是 UI 与后台任务。
3. **文档站点在漂移**：Cursor 的 memories 入口现在返回 Rules，Windsurf 文档切到 Devin Local，
   Codex 文档迁到 learn.chatgpt.com；报告中的「未检出」只对 2026-11-18 读到的页面成立。
4. **DSH 生态名单不完整**：GitHub 搜索只能覆盖公开仓库；私有/未索引插件、以及 dsh-plugin.org
   之外的发布渠道未纳入。
5. **中文/闭源产品未覆盖**：Trae、Qoder、通义灵码、CodeBuddy 等的记忆能力未做一手核验。
6. **本仓库自身的数字是快照**：v0.4.3、39 个测试文件、546 个跟踪文件（2026-11-18 现读；AGENTS
   快照为 423）等，引用前应现读。

---

## 12. 附：术语对照

| 术语 | 本文含义 | 容易混淆的用法 |
|---|---|---|
| memory / 记忆 | 跨会话保留的项目事实与工作态 | 模型参数记忆、向量库 |
| consolidation / 整理 | 把会话材料蒸馏进记忆文档的 pass | 数据库 compaction、GC |
| compaction / 压缩 | 同会话内把历史摘要掉，腾出窗口 | 本项目 handoff 的「新会话交接」 |
| handoff / 交接 | 开新会话并播种上下文 | 多智能体框架的「任务转交」 |
| skill / 技能 | `SKILL.md` + 可选附属文件的项目程序性知识 | 工具（tool）、插件（plugin） |
| archive / 归档 | 会话原文的持久化与索引 | 压缩包归档（tar） |
| journal | 追加式权威日志 `memory.jsonl` | 普通日志文件 |
| tier C | 有损回复的定向重试 + 拒绝 | 普通错误重试 |
