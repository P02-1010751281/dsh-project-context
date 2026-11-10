# Batch Z — 六个结构性问题：取证与规格

> 状态：**只取证、只出规格，未改任何 `src/`**。用户 2026-11-09 提出六个问题，其中前三条同日先提过一次。
> 取证现场有两台：本机 `/mnt/Data/Projects/dsh-project-context`（dev 仓库，跑 link 安装）与
> `406-12`（CachyOS 笔记本，跑 `vendor/dsh-project-context-0.4.3.tgz` 打包安装，即真实使用现场）。
> 所有读数都带复现命令；引用前请重跑，不要抄本文的数字。

## 0. 两台机器的部署差异（决定了证据该怎么读）

| | 本机 | 406-12 |
|---|---|---|
| 安装方式 | `~/.dsh/profiles/*/package.json` → `link:/mnt/Data/Projects/dsh-project-context` | `"file:./vendor/dsh-project-context-0.4.3.tgz"` |
| 版本 | `0.4.3` + 未发布提交（HEAD 含 `73f6184`、`d8ee04f`） | 发布版 `0.4.3`（tgz 日期 2026-11-02） |
| 项目记忆 | 本仓库自己的 `.agents/memory/` | `~/.agents/memory/`（`~` 当项目根）、`~/.pi/.agents/`、`~/.dsh/dsh-chat-import-workspace/` |

结论：**406-12 是唯一能反映「日常使用」的证据源**；本机是开发树，缺陷可能已被未发布提交修掉。下面每个问题都标注证据来自哪台。

---

## 1. 旧的过时记忆会干扰

### 现象与证据

406-12 `~/.agents/memory/CONTEXT.md`（7975 字符，`Last updated: 2026-11-06T13:29:59Z`）：

- `## Summary` 整段在讲 **dsh-multi-root 打包/脱敏/RULES.md/浏览器工具** 这一次工作；
- `## Open tasks` 有 **14 条**，横跨至少 8 个互不相关的任务：dsh-multi-root 发布裁定、GPU hostfix、`cc-switch` 卸载、Codex provider、pi 退役、skills 分层、config-sync、UU 远程……
- 该文件在**每一个** cwd 为 `~` 的会话里被当作「项目上下文」注入，无论那个会话在干什么。

406-12 `~/.agents/memory/MEMORY.md`：40358 字符 / 152 条 bullet（161 行）。本机：41809 字符 / 120 条。

### 根因（两条，互相独立）

**R1 — `CONTEXT.md` 是「每项目一份」，但内容是「每会话一份」，最后写的会话覆盖前一个。**
`src/project-memory/context-schema.ts:32` 的三节（Summary / Key points / Open tasks）描述的是**当前会话的工作状态**，落盘位置却是 `<project>/.agents/memory/CONTEXT.md` —— 单文件、无会话标识、无任务标识。同一项目并发两个会话时，A 的 Summary 会被 B 整段覆盖；只有一个会话时，上一个任务的 Open tasks 被原样带进下一个任务，越攒越多（远端 14 条即此）。

**R2 — 记忆条目没有「这是什么时候、针对哪个任务、还成立吗」的字段。**
`src/project-memory/memory-schema.ts` 的四节（Project / Invariants / Pitfalls / Index）只按**内容种类**分，条目是纯 `- ` 文本，没有 id、没有日期、没有作用域、没有 supersede 标记。所以整理 pass 只能靠模型「读起来像不像过期」来决定去留，无法机械淘汰，也无法指向「这条被哪条取代」。

### 可机械判定的那一半（建议做成门禁）

锚点漂移是可以自动查的：扫条目里反引号包住的 `src|test|docs|client|scripts|lib/…` 路径，逐个 `existsStat`，并校验 `:line` 是否超过文件行数。本机实测：

```
node /tmp/anchor2.mjs .agents/memory/MEMORY.md
bullet=120 代码路径锚点=24 路径不存在=2 行号越界=0
```

2 条里 1 条是真漂移（`scripts/check-dsh-plugin-patches.sh` 实为 `/etc/nixos/scripts/` 下的外部脚本），另 1 条也是外部路径。**结论：本机锚点健康，「过时」不在路径层，在语义层。** 这条探针仍值得留下——它是唯一不依赖模型判断的过期信号。

---

## 2. session 索引不全

### 现象与证据（406-12）

```
磁盘=194 索引=131 漏写=63 悬空=0
漏写按年月：2026-09 ×8，2026-10 ×47，2026-11 ×8
63/63 都有 session.jsonl
```

本机同一套判定：**磁盘=185 索引=185，漏写 0，悬空 0**（`/tmp/idxaudit.sh`）。所以这是**迁移机器**的问题，不是所有安装的问题。

### 排除了三个候选原因

1. **不是 cap 截断**：`MAX_INDEX_LINES = 200`（`src/project-context/session-index.ts:35`），远端 194 < 200，索引尾部也没有 `<!-- N older sessions dropped -->` 标记。
2. **不是并发丢行**：跨进程锁自 `b4794af`（2026-09-25）就存在，`0.4.3` 已含。
3. **不是「写后被删」**：`~/.agents` 是 git 仓库，`git log -S<id> -- memory/session-logs/INDEX.md` 对抽样的三条都是 **0 次提交**——它们从未进过任何版本的索引。

### 根因

**`migrateProjectState` 把 `~/.pi/session-logs` 整目录 `mergePath` 搬进 `.agents/memory/session-logs/`，只搬目录、不补索引行**（`src/shared/migrate.ts:74-100`，`moves` 数组里 `[path.join(legacyPi, SESSION_LOGS_SUBDIR), logsDir(projectRoot)]`）。pi 时代的会话目录因此有 `session.jsonl` 却永远没有 INDEX 行；只有在旧布局另有 `session-index.md` 时才靠采纳路径补上，而那部分本身也不全。

时间上吻合：远端 8 条 11 月的漏写全部落在 **11-01 / 11-02**，早于 11-02 16:47 的 tgz 安装；安装后（11-03 起）新增会话都在索引里。

### 关键缺口

代码里**没有任何**扫描 `session-logs/` 目录做对账的路径：

```
grep -rn 'readdir(logsDir|readdirSync(logsDir' src/   → 0 命中
```

索引只由「归档一个会话时顺手 append 一行」维护，因此**任何绕过归档写路径产生的目录（迁移、外部导入、手工拷贝）都会永久缺席**，且没有修复通道。这正是问题 2 与问题 3 同源的证据。

---

## 3. 没有废弃的清洗通道

### 现状盘点

注册的命令面只有五个：`/context`、`/session-log`、`/memory`、`/handoff`、`/autolearn`（`src/*/index.ts` 各一处 `ctx.commands.register`）。**没有任何 purge / prune / clean 子命令**；`grep -niE 'retention|ttl|keepDays|maxAge|prune|purge' src/shared/config.ts` 只命中三条无关注释 ⇒ **无保留期配置键**。

唯一存在的清洗工具是仓库外的**一次性脚本**：

```
/mnt/Data/Backups/dsh-project-context/purge-subagent-archives.mjs   5355 B
```

它只做一件事：按 header 判定子代理会话 → tar 到仓库外 → 删目录 → 经插件锁重写 INDEX.md。不覆盖：过期记忆条目、过期会话日志、过期技能候选、积压备份、`memory-log-*.jsonl`。

### 实际积压（406-12 实测）

| 对象 | 体积/数量 |
|---|---|
| `MEMORY.md.memory-backup-*` | 5 份，32–36 KB（本机 5 份，最大 41809 B） |
| `memory-log-*.jsonl` | 2 份 × 约 530 KB（本机 3 份 × 约 540 KB） |
| `memory.jsonl`（journal） | 512 KB（本机 360 KB） |
| `errors.log` | 52 KB / 229 行（本机 85 KB） |
| `skill-candidates/` | 2 项 |
| 未入索引的会话目录 | 63 个（含 `session.md`） |

这些都不影响正确性，但都是**只能手工处理**的熵：没有命令、没有保留期、没有「归档到仓库外再删」的统一路径。

---

## 4. 同一个项目可能有多个任务

### 现象

远端 `~` 项目就是极端样本：**一个项目根，14 条互不相关的 Open tasks，一份共享 MEMORY.md**。`~` 下任何会话（发布 dsh-multi-root、修 GPU、聊 Codex）都在读写同一份记忆与上下文。

本机也一样：`.agents/memory/` 里同时躺着「发布流程」「记忆预算」「交接阈值」「离线探针」四个工作流的约束。

### 根因

**schema 里没有「任务」这一维。** 四节按内容种类分（`memory-schema.ts:27-32`），上下文三节按会话状态分（`context-schema.ts:32-36`），两者都没有 `task` 字段或作用域键；索引层也没有（`INDEX.md` 一行只有 id/日期/标题）。于是：

- 记忆无法回答「这条属于哪个工作流、现在还有效吗」；
- 上下文无法回答「这个 Summary 是哪个任务的」；
- 交接无法只带**当前任务**的切片，只能整包搬。

### 与问题 1 / 6 的关系

问题 1 是「旧条目干扰」的**后果**，问题 4 是它的**结构原因**；问题 6（交接摩擦）是同一结构在交接面的表现——种子只能带全量上下文，带不了「这一个任务」。

---

## 5. schema 需要进一步细化

### 现状（精确）

- **记忆文档**：`# DSH Project Context — Project Memory` + 固定四节，节内纯 `- ` bullet；`sectionsFromMarkdown` **只接受**这种形态，否则返回 `undefined`（整份文档按不透明文本原样保留）。
- **上下文文档**：`# Project Context` + Summary（prose，独立 6000 上限）/ Key points（list）/ Open tasks（list）；`maxMemoryChars` 默认 40000，`MAX_CONTEXT_CHARS` 32000，`MAX_LIST_ITEM_CHARS` 800。
- **预算**：节份额 `0.17 / 0.45 / 0.29 / 0.09`；份额是目标不是上限（batch N），只有整份到 cap 才丢条目。

### 缺什么（按依赖顺序）

1. **条目级身份**：无 id ⇒ 无法引用「这条被那条取代」，无法写 supersede 标记而不被当成新条目。
2. **作用域**：无 task/workspace 归属 ⇒ 问题 4 无解。
3. **时效**：无「最后一次被证实」的时间 ⇒ 过期只能靠模型观感。
4. **状态**：无 active / retired 区分 ⇒ 问题 3 的「废弃」无处落笔。
5. **优先级**：Open tasks 14 条平铺，交接与注入都不做取舍。

**兼容性要点**：把标记写在条目**正文内**（例如 `- （retired 2026-11-09）…` 或 `- [task:release] …`）不会破坏 `sectionsFromMarkdown` 的解析——它只要求「四节 + `- ` 开头」。这是唯一不需要迁移解析器就能加的维度；任何把状态搬到 bullet 之外的方案（子行、缩进、front-matter）都会让整份文档失效为不透明文本。

---

## 6. 交接还是会出现摩擦

### 已观测到的三类摩擦

1. **陈旧 provider/model 配对**（本机 2026-11-07 20:03:46）：`resolveTarget` 回落到 `session.requestHeader().config`，切换模型后的首个 `turn/end` 拿到旧配对，`gate.ts:55` 的 `resolveModelInfo` 无保护抛错，被 `index.ts:120` 吞成一行 `errors.log` + 5 分钟退避。用户侧表现是「这次没交接，也没说为什么」。
2. **种子只能带全量上下文**：与问题 4 同源。远端 CONTEXT 有 14 条跨任务 open tasks 时，交接种子会把它们整体带走（或按 token 预算截断，截掉哪些不可控）。
3. **交接后父会话滞留**：`73f6184` 之前按路径判定，闲置会话不退休；该提交已修（未发布），但 0.4.3 仍带旧行为。

### 远端读数（说明摩擦不是报错型）

```
406-12 errors.log: handoff=0  memory=91  autolearn=12
406-12 INDEX.md 里 "↪ handoff" 会话: 11
本机 errors.log: handoff=3（陈旧配对 1、429 1、QUOTA 1）
```

**结论：交接的摩擦几乎不产生错误日志，因此不能靠 `errors.log` 验收。** 它表现为「结果不合意」——带错东西、带太多、或没发生而无人知晓。

---

## 7. 建议的批次切分

按「证据已足 → 风险低 → 用户可感知」排序，每批单独规格、单独验收：

| 批次 | 解决 | 内容 | 风险 |
|---|---|---|---|
| **Z1** | 问题 2 | `reconcileSessionIndex()`：扫 `session-logs/` 目录，把缺行补进 INDEX（幂等、走现有锁、不删任何东西）；`/session-log index` 触发；启动时按需自检 | 低（只增不删） |
| **Z2** | 问题 3 | 清洗通道：`/memory prune`（按标记/锚点/日期退役条目）、`/session-log prune --before <date>`（tar 到仓库外→删→重写索引，复用 purge 脚本的形态）、保留期配置键、备份轮转上限 | 中（首次有删除语义，必须默认 dry-run） |
| **Z3** | 问题 1+5 | 条目级标记约定（写在 bullet 正文内）+ 整理提示词要求「无证据支持则标 retired」+ 锚点漂移门禁 | 中（改提示词与文档形态） |
| **Z4** | 问题 4 | 任务维度：先做 `CONTEXT.md` 的分任务块（最小改动），再评估是否需要 `tasks/` 子目录 | 高（影响注入与交接契约） |
| **Z5** | 问题 6 | 种子按任务切片；陈旧配对失败改为用户可见提示 | 高（交接是本仓风险最高的一支） |

**依赖**：Z1 独立可做；Z2 依赖 Z3 的标记约定才谈得上「退役记忆条目」；Z4 是 Z5 的前置；Z3 与 Z4 都要先定 schema 形态。

## 8. 需要用户裁定的事（先别写代码）

1. **清洗的删除语义**：默认 dry-run + 显式 `--apply`，还是直接删但先 tar 到仓库外？（现有 purge 脚本是后者）
2. **任务维度的落点**：`CONTEXT.md` 内分块（改动小、注入不变），还是 `.agents/memory/tasks/<slug>.md` 多文件（干净、但要改注入与交接）？
3. **条目标记的形态**：`- [task:<slug>][status:retired] …` 这类前缀，还是自然语言尾注（`（已废弃，2026-11-09）`）？前者可机械解析，后者更省字符。
4. **索引自检时机**：宿主启动时扫一次（194 目录，开销小但每次启动都跑），还是只在显式命令/归档失败后跑？
5. **问题 2 的存量修复**：406-12 那 63 条要不要现在就补？（本机 0 条，补的动作只影响那台机器）

## 9. 复现命令

```bash
# 索引对账（两台通用；参数是 session-logs 目录）
/tmp/idxaudit.sh <project>/.agents/memory/session-logs      # 见本文 §2 脚本

# 记忆锚点漂移
node /tmp/anchor2.mjs .agents/memory/MEMORY.md

# 命令面与保留期配置
grep -rn 'ctx.commands.register' src/ | wc -l
grep -niE 'retention|ttl|keepDays|maxAge' src/shared/config.ts

# 远端现场（需 ssh 406-12；远端 shell 是 fish，必须 bash -lc 包一层）
ssh 406-12 "bash -lc 'awk \"/\\[handoff\\]/{h++} END{print h}\" /home/user/.agents/memory/errors.log'"
```

---

# §10 第二轮提问的回答（2026-11-10）

用户追加五问。下面每条都给代码锚点，不给印象。

## 10.1 索引的硬上限不合理，而且「保留」也是错的方向

**事实**

- `MAX_INDEX_LINES = 200`（`src/project-context/session-index.ts:35`）。触顶时 `ordered.slice(-200)` 丢最旧的行，并写一条 `<!-- N older sessions dropped … -->`，注释里的数字会**累计携带**（`carried`）。
- 唯一的索引消费方是 autolearn，而它**只读最新 50 条**：`MAX_INDEX_ENTRIES = 50`、`index.slice(-MAX_INDEX_ENTRIES)`（`src/project-autolearn/pass.ts:70,142`）。
- 200 行 × 约 90 字节 ≈ 18 KB。这个量级不值得为它牺牲可导航性。

**判断**：上限保护不了任何资源，却在**破坏可导航性**——第 201 个会话起从索引里消失，而那条 `dropped` 注释让它读起来像「有意为之」。更糟的是它给了人一个错觉：以为「保留了最新的就够了」，但索引不是缓存，它是**归档的唯一目录**。

**建议**：分两层而不是截断。

1. `INDEX.md` 不收上限，永远只增不删；
2. 若要控制单文件体积，另开 `INDEX-archive.md`（冻结、只追加），`INDEX.md` 顶部写一行指针，**移动而非删除**；
3. 删除 `MAX_INDEX_LINES` 与 `dropped` 注释；真正的保留策略属于「归档保留期」，由 §3 的清洗通道决定。

## 10.2 索引现在确实没有 schema，而且额外字段会被静默吃掉

**事实**：`HEADING = "# Session Index"`；行格式 `LINE_PATTERN = /^- \[([^\]]+)\]\(([^)]+)\) — (\d{4}-\d{2}-\d{2}) — (.*)$/`（`session-index.ts:32,37`）。只有 **id / 链接 / 日期 / 标题** 四个位置，没有版本号、没有 front-matter。

两个具体的容纳缺陷（都已从实现读出，不是推测）：

1. 写入时只保留 `- [` 开头的行（`entryLines`），所以**任何版本注释/front-matter 行会在下一次写时被直接丢弃**——我本想加的 `<!-- index-schema: 2 -->` 现在活不过一轮；
2. 行内多余的字段不会报错，而是被 `(.*)$` **并进标题**，下一次写就固化成标题文本；同理日期解析失败的行会被 `orderIndexLines` 排到**最新端**，看起来像刚创建。

**建议**：加版本头 + 结构化尾注，保持 v1 行可解析。

```markdown
<!-- index-schema: 2 -->
- [session-abc…](session-abc…/session.jsonl) — 2026-11-09 — 标题 <!-- parent:session-xyz…; kind:handoff; tags:release,memory -->
```

- 版本头缺失时按 v1 读（现状兼容）；
- 未知字段忽略但**回写时保留原文**（现在的实现会把整行当新行重写，等于丢字段）；
- `parseSessionIndex` 返回结构化对象，`renderSessionIndexLine` 负责序列化，两者成对——避免再出现「多一个字段就丢一行」。

## 10.3 会话树与交接关系：dsh 侧根本没有，现在是靠文本猜

**事实**

- dsh 原生会话头只有 `{harness, id, version, createdAt, cwd, isSeeded, agentPreset}`（实测：`session-8cb9feac…/session.jsonl` 第一行），**没有 parent**。pi 时代有 `parentSession`，迁进来的文件里还留着，dsh 自己不再写。
- `INDEX.md` 行里没有父子字段（见 10.2）。
- `HANDOFF.md` 里**有**父会话 id，但它是**项目级单文件、每次交接覆盖**（`src/project-handoff/perform.ts:146`），保留不了历史。
- 交接关系唯一的长久痕迹是标题文本 `↪ handoff · <短 id>`，由 `handoffLabel` 生成，属**展示层**。

**结论**：树是缺的。可以「推导」（读标题 + HANDOFF.md），但推导会失败：标题可被用户改、HANDOFF.md 会被下一次覆盖、短 id 只有 8 位。

**建议**：在交接事务里**写明**而非推导——`performHandoff` 同时知道父子两个 id，零成本：

1. 子会话归档目录写 `meta.json`：`{parent, kind: "handoff", root, at}`；
2. 索引行带 `parent:` 尾注（10.2）；
3. `HANDOFF.md` 改为只追加或按 `<child>/handoff.md` 存，保留链条。

有了这三样，树、链、`/session-log tree` 都是读出来的，不需要猜。

## 10.4 记忆分层：两层已经有了，但没有「升降级」和「失效」

**事实**：现在是两份文档——`CONTEXT.md`（会话工作状态，每轮重写）与 `MEMORY.md`（项目长期，四节）。所以「短期 + 长期」**结构上已存在**，缺的是三件事：

1. `CONTEXT.md` 是**每项目一份**而不是每会话一份 → 后写的覆盖前写的（这就是远端 14 条跨任务 Open tasks 的机制）；
2. 没有**晋升规则**：一条事实进 context 还是进 memory，全凭模型当轮判断；
3. 没有**失效/降级**：进 memory 之后只有「文档到 cap」才会掉条目，而那是拒写而非退休。

**建议**：显式三层 + 两条规则。

| 层 | 载体 | 生命周期 | 注入 |
|---|---|---|---|
| 工作集 | `CONTEXT.md`（**每会话**，按会话 id 命名或分块） | 会话内 | 总是 |
| 项目记忆 | `MEMORY.md` | 跨会话，带 `last-verified` | 总是（按节预算） |
| 归档 | `session-logs/` + `retired.md` | 永久、只追加 | 不注入，按需检索 |

- **晋升**：同一事实在 ≥N 个会话的 context 里重复出现且未被反驳 → 提议进 memory；
- **降级/失效**：见 10.5。

## 10.5 记忆失效：三条机械触发，替代「靠模型观感」

现在**没有任何失效路径**（`MEMORY_SECTIONS` 无 status 字段，无 TTL 配置键，唯一删条目的地方是 cap 溢出）。建议三条，都能机械判定：

1. **锚点漂移**：条目里的代码路径/`:line` 不存在（§1 的探针已能跑，本机 24 个锚点里 1 条真漂移）；
2. **被取代**：后来的条目声明 `supersedes: <id>`，旧条目标 `retired`；
3. **久未证实**：`last-verified` 早于 M 个会话且期间无引用。

退休 = **移到 `retired.md` / journal，不删除**。这同时解决「旧记忆干扰」与「不敢删」。

标记必须写在 bullet **正文内**（10.6 的兼容边界），例如：

```markdown
- [status:retired since 2026-11-09] 旧结论……（由 2026-10-xx 的 X 取代）
- [task:release] 发布顺序：先跑门禁再打 tag……
```

## 10.6 兼容边界（重申，因为它约束 10.4/10.5 的形态）

`sectionsFromMarkdown` 只接受「四节 + `- ` 开头」的纯 bullet 文档；子行、缩进、front-matter 都会让整份文档变成**不透明文本**（原样保留、不再结构化）。所以标记只能放在 bullet **内部**。

## 10.7 todo：不要造第二套，dsh 已有且是日志持久化

**事实**（读自 dsh 0.2.2-rc.1 源码，非文档转述：`packages/todo/tool-todo/src/types.ts`）：

- `TodoItem = { content: string, status: "pending" | "in_progress" | "completed" }`（`types.ts:23-27`）——**刻意极简**：无 id、无优先级、无 activeForm，因为每次 `todo_write` 是**整表快照**（last-write-wins）；
- 事件 `'todo/write': { todos: TodoItem[] }`（`types.ts:33`）落在**会话日志**里，跨轮次、跨重开都在；投影给出该 agent 当前整表，**首次写入前是 `null`**（`types.ts:40-41`），不是空数组——读取方必须区分「没有清单」与「清单为空」；
- 列表属于**创建它的那个 agent 会话**：子代理有自己的清单，父会话的清单不会自动对它可见。

**建议**：不新增存储，做三件读的事：

1. 整理 pass 读当前会话的 `todo/write`，把未完成项渲染进 `CONTEXT.md` 的 Open tasks（带 task 标记）——这样 Open tasks 有作者、有状态，不再是自由发挥；
2. 交接时把当前 todo 快照写进种子（它已在父日志里，但种子要重述，否则子会话看不到）；
3. 跨会话的长期任务仍归 `CONTEXT.md` / 任务注册表，todo 只当会话内工作集——两者别混。

## 10.8 插件注入 skill：可以，而且有两条路

**事实**（读自 dsh 0.2.2-rc.1 源码 `packages/skill/skill/src/index.ts`，2026-11-10 现读；README 只是转述）：

- `register(skill: SkillRegistration): () => void`（`:439`）—— 注册**内存里的 embedded skill**，无需文件；`SkillRegistration` 即 `SkillDefinition` 去掉 `invocation`/`provider`（两者可省、有默认），所以 `{ name, description, source, content }` 是**必填四件**。`validateRuntimeSkill`（`:741`）只校验 kebab 命名与空描述，**不校验 `content` 与 `source`**——类型层必填、运行期不设防，绕过类型就得到一个空正文技能。
- `registerProvider(create: (control) => SkillProvider): () => void`（`:390`）—— 注册目录提供者，**同步**注册，返回 disposer；`runtime` 是 registry 自用的保留 provider 名（`:24`；有人拿它注册 provider 会被 `:406-407` 抛 `"runtime" is reserved for runtime skill registrations`）。
- 每个 skill 带 `{modelInvocable, userInvocable}` 四象限（`:49-55`），模型面与人类面各自取舍；省略时两者都是 `true`。
- **优先级是两张表，不是一条「先到先得」规则**（上一轮那句是错的，此处更正）：
  - **层优先**：一次读取合并 global 层与观察者 scope 链，**最近层的条目直接胜出，与 rank 无关**；rank 只在**同一层内**决定同名去重（`:346-353` 类注释）。宿主插件注册落在 global 层，预设挂载的落在该预设层。
  - **层内 rank，数字小者胜**：project `.dsh/skills` **100** → project `.agents/skills` **200** → **runtime 250** → custom **300** → user `~/.dsh/skills` **400** → user `~/.agents/skills` **500** → bundled **600**（`skill/src/index.ts:25-28`、`skill-filesystem/src/index.ts:35-39`）。
  - tiebreak：provider 注册顺序 → provider 内部顺序（`:807-811`）。
  - 同层同名 runtime：**先到先得**，重复者记 warning 并拿到 no-op disposer，删不掉胜者（`:439-447`）。
- 已知限制：provider 串行查询（一个慢的拖后面所有）、被拒 provider 不留 last-good 目录、同名遮蔽没有查询 API。

**判断**：能注入，但不该把它当主通道。

- 本项目现在的 autolearn 走的是**文件**（`.agents/skills/<name>/SKILL.md`），由 `skill-filesystem` 发现——可 review、可 diff、可 commit、重启仍在；
- `register()` 的价值在**短生命周期、会话级**的指引（例如「本项目交接流程」这种随配置变化的提示），代价是**重启即消失**、不可审阅；
- **遮蔽面与直觉相反，这是本轮最该记住的设计事实**：宿主层的 runtime 技能 rank 250 会静默压掉 custom（300）、用户自己的 `~/.dsh/skills`（400）与 `~/.agents/skills`（500）、以及全部 bundled（600），**但压不掉本项目自己的 `.agents/skills`（200）**。也就是说「我自己技能库里放一份同名技能就会赢」是错的，而且**没有查询 API 能看出遮蔽发生了**。真要做注入就得 ① 用命名空间前缀（如 `dpc-*`）② 启动时把注册名打进日志 ③ 只用于随配置变化的短时提示；
- 所以：**磁盘是唯一持久通道**；runtime 注册只用于「这次会话的可执行提示」，且必须日志可查（谁注册了什么）。

## 10.9 这批事的重新切分（替换 §7 的 Z1–Z5）

| 批次 | 覆盖 | 关键动作 |
|---|---|---|
| **Z1** | 索引 schema + 去上限 | 版本头、`parent/kind/tags` 尾注、删 `MAX_INDEX_LINES`、`INDEX-archive.md` 分层 |
| **Z2** | 索引对账 | `readdir` 对账 + `/session-log index`，只增不删 |
| **Z3** | 会话树 | 交接时写 `meta.json` + 索引 `parent:`；`/session-log tree` 读出 |
| **Z4** | 记忆分层与任务 | 每会话 CONTEXT、`[task:…]` 标记、晋升规则 |
| **Z5** | 失效与清洗 | `retired.md`、三条触发、`/memory prune`、保留期、备份轮转 |
| **Z6** | todo 接线 | 读 `todo/write` 渲染 Open tasks；种子带当前 todo |
| **Z7** | 交接种子按任务切片 | 依赖 Z4；顺带把陈旧配对的失败变可见 |

Z1/Z2/Z3 互相独立、风险低，可先做；Z4 是 Z7 的前置；Z5 依赖 Z4 的标记。

## 11. 实现规格（2026-11-10 四轮裁定后）

这一节把 §10 的诊断换成可执行的设计。**裁定来源**见每条的「裁定」行；没有裁定行的是从现有代码读出来的约束。
Z1–Z7 取代 §10.9 的表。

### 11.1 索引：改成 `meta.json` 的生成物

**裁定**：生成式（用户 2026-11-10 选乙），并接受连带改动——`date` / `title` 进 `meta.json`。

**真相源**：`session-logs/<id>/meta.json`，每会话一份：

```json
{ "id": "session-…", "title": "↪ handoff · …", "date": "2026-11-09",
  "kind": "session|handoff", "parentId": "session-…", "task": "release" }
```

- `title` 与现在的索引标题同一套生成逻辑（`MAX_TITLE_CHARS` 160，交接会话带 `↪ handoff · ` 前缀）。
- `kind` 取代「靠标题猜」：`subagent` 不入索引（与 `isTopLevel` 闸一致），`handoff` 是展示与树形用的。
- `parentId` 只有交接那一刻知道（dsh 会话头没有 parent），由 `performHandoff` 写进**子会话**的 meta（`src/project-handoff/perform.ts`，两个 id 都在手上）。
- `task` 由 `/context task <slug>` 写入（见 §11.4）。

**生成规则**（`writeSessionIndex` 改为整份重写，不再 append）：

1. `readdir(logsDir)`；跳过不以会话 id 形态命名的路径。
2. 读每个 `meta.json`；**缺 meta 的目录从 `session.jsonl` 头补 `id`/`cwd`，标题留空**（迁移期一次性回填，回填后写盘）。
3. 排除 `kind: subagent`。
4. 按 `id` 去重（一个目录一行，结构上不可能重复）；按 `date` 升序，同日按 id。
5. 渲染 `# Session Index` + 每行 `- [<id>](<id>/session.jsonl) — <date> — <title>`。

**删掉的东西**：`MAX_INDEX_LINES`（`src/project-context/session-index.ts:35`）与它那段「dropped 计数要 forward」的逻辑。行数不再设限。

**结构收益**：漏写（目录在、行不在）与悬空（行在、目录不在）都变成不可能——两者不再是「要修好的 bug」，而是写不出来的状态。这也让 `migrateProjectState` 整目录搬迁的缺口自动闭合。

**仍要保留的读取路径**：`readSessionIndex` / `LINE_PATTERN` 继续用于读**别人写的**旧索引（adoption 路径 `readLegacyIndexForAdoption`），但**写入方只用生成器**。

**迁移**（一次性、幂等）：首次生成时，若某目录没有 `meta.json` 但旧 `INDEX.md` 里有对应行，用该行的日期与标题回填；回填完写盘。406-12 那 63 条目录由此自动入索引（用户选「不单独补」，由生成器覆盖）。

### 11.2 会话树：读 `meta.json`，不再靠标题猜

- 关系链 = 每个 `meta.json` 的 `parentId`。一棵树 = 一次 `readdir` + 读 meta。
- `/session-log tree`：打印缩进树（父 → 子）；节点标 `kind`、`date`、`title`。
- **暂缓**：把 `HANDOFF.md` 改成按子会话存（`handoff/<childId>.md`）。理由：交接文档的正文已经在子会话的第一条 user 消息里，归档日志可恢复；为它改存储路径会牵动种子里的指针，收益不成比例。若日后要「一次交接一个文件」，单独一批。

### 11.3 记忆失效：删正文 + 写墓碑

**裁定**：退休 = 立即从 `MEMORY.md` 删掉 + 在 `retired.md` 写一行墓碑（用户选丙，明确用 git 与历史会话兜底）。

墓碑格式（一行一条，好解析也好人读）：

```
- 2026-11-10 · scripts/check-dsh-plugin-patches.sh 已不存在 · anchor-drift
- 2026-11-10 · 批量不续写 pi、单文件 append 在 0.2.1-rc.5 上崩 · superseded-by:d8ee04f
```

**三条机械触发**（都不靠模型观感）：

| 触发 | 判据 | 现在能不能算 |
|---|---|---|
| 锚点漂移 | bullet 里带目录的路径不存在 / 行号越界 | 能，探针已跑过（本机真漂移 1 条） |
| 被取代 | 新条目显式声明取代旧条目 | 能，但需要条目 id（见下） |
| 久未证实 | 超过 180 天没有任何归档会话再提到它 | 能，扫 `session-logs/*/session.jsonl` 的关键词 |

**条目标记**：因为 `sectionsFromMarkdown` 只认「四节 + `- ` 开头」（§10.6），标记只能写在 bullet **正文内**。用尾部括注，不占行首：

```
- 某条事实……（tid:4f2a · 2026-11-10）
```

`tid` 是四字符短 id，只用于「被取代」的指向与墓碑引用；没有 id 的旧条目首次整理时补发。

**防复活**：整理 pass 的提示词里注入墓碑摘要——**只给日期与标题**（不带原因），最多 20 条，超了只报数量。裁定：用户选乙。

**压缩**：墓碑文件超过 200 行时，把最旧的一半搬到 `retired-archive.md`（移动，不删除）。

**落地（2026-11-10，`retired.ts` + `retirement.ts`）——三处按实测修正**

1. **标记只带 id，日期进侧车文件**。上文的 `（tid:4f2a · 2026-11-10）` 实测不可行：本机 134 条、文档 43720/45000 字符时，给它加 23 字符的标记是 **+3082 字符**，`renderMemoryDocument` 直接丢掉 **7 条整条目**；21 字符版丢 6 条，17 字符版丢 5 条。改成只写 `（4f2a）`（6 字符，+804）后 **0 丢弃**，渲染后 44524/45000。日期改由插件自有侧车 `.agents/memory/entries.json`（`tid → 首次见到日期`）记录：它是**本机时钟**而非事实，故按 `autolearn-state.json` 的先例列入记忆目录 `.gitignore`；干净 clone 没有它，于是没有任何条目能进入 180 天判定——保守方向，符合「宁可漏判」。
2. **锚点规则要窄到零误判**。第一节表格里「本机真漂移 1 条」无法在定稿规则下复现，按不可判定处理。校准过程：把「含斜杠即路径」当判据时 134 条里 30 条报漂移，全是散文（`turn/start`、`origin/main`、`provider/model`、`W/450000`）；加上「末段必须带源码/文档扩展名」剩 7 条，又全是缩写路径与外部 checkout（`.agents/evidence/…` 的简写、`packages/subagent/…`、`/etc/nixos` 下的 `scripts/dsh-plugin-patches/…`）。定稿再加两条：**父目录必须存在**才可判定（父目录不在时当作别处路径，跳过），以及**插件自己的本地生成物不算漂移**（`errors.log`、`memory.jsonl`、`*.lock`、`*.memory-backup-*` 直接从 `MEMORY_GITIGNORE_LINES` 派生——干净 clone 里它们本来就不存在）。定稿规则在真机文档上：**35 条可检验、全部通过、0 漂移、0 误退**，耗时 10 ms。代价：整目录被删时看不出来，这是刻意接受的盲区。
3. **墓碑只在写入落地后写**。墓碑断言「该条目已离开文档」，而 tier C 拒绝、Q2 拒绝、`basisKey` 竞态、空骨架闸都可能让这一次什么都没写；那时写墓碑就是在说一个还躺着的事实已经死了。因此 `ConsolidationOutcome.retirement` 只在**可存储**的回复上携带，真正的追加发生在 `index.ts` 里 `snapshot.written` 为真之后，失败只记 `errors.log`（写入已经落地，不能把一个已落地的写报成命令失败）。

**落地后的验收（真机文档只读测量）**：`stamped=true retired=0 added=134`；渲染 44524/45000、`sectionDropped 0`、`droppedItems 0`、`itemTruncated 0`；无条目超过 800 字符的单条上限；渲染→解析→渲染逐字节一致。

### 11.4 任务维度

**裁定**：`tasks/<slug>.md` 多文件；会话归属靠显式声明；模型只能在既有 slug 里挑；造新 slug 需确认；任务自身有生命周期（三态）。

**文件**：`.agents/memory/tasks/<slug>.md`，头部是同样的四节结构（Summary / Key points / Open tasks），另加一行元信息：

```
> created 2026-11-10 · status active · lastSeen 2026-11-10
```

**三态与自动降级**：

| 状态 | 进入方式 | 是否注入 |
|---|---|---|
| `active` | 创建 / 有任何会话活动 | 是 |
| `dormant` | **自动**：30 天没有会话绑定或更新 | 是（摘要一行） |
| `archived` | 显式命令，或 `dormant` 满 90 天 | 否（只留在文件里，可查） |

**会话归属**：`/context task <slug>` 写入 `session-logs/<当前 id>/meta.json` 的 `task` 字段（**落盘而不是内存**，否则重启即丢）。没有 `task` 字段的会话用项目级 `CONTEXT.md`，行为与今天一致。

**三种维护模式**（`config.ts` 新增一个枚举键，取值决定「谁可以造新任务」）：

| 模式 | 谁能造新 slug | 谁改状态 |
|---|---|---|
| `assisted`（默认） | 模型可以提议，**要用户确认**；用户也可直接用命令 | 自动降级 + 显式命令 |
| `delegated` | agents 按规则自动建（规则：出现**新的显式声明**才建；不猜） | 全自动 |
| `manual` | 只有用户命令 | 只有用户命令 |

**注入**：当前会话有 `task` → 注入 `tasks/<slug>.md`；否则注入 `CONTEXT.md`。两种情况都额外注入一行「其他任务」清单（只给 slug + 状态 + 标题，一行一个，不给正文）。

**存量迁移**：现有 `CONTEXT.md` 的 20 条 bullet 全部留在项目级文档里当「无任务」；不自动拆分（拆错比不拆更贵）。

**落地（2026-11-10，`src/project-memory/tasks.ts` + `/context task`）——五处按实现收敛**

1. **状态是派生的，只有 `archived` 是自主值**。`active` / `dormant` 由 `lastSeen` 的年龄现算，不落盘：一个昨天还有活动的任务不可能因为某次清扫没跑就显示 dormant——这与索引那条同源（能和证据不一致的状态就是 bug）。
   由此统一了上文「`dormant` 满 90 天」与 §11.8 验收 ③「91 天自动 archived」的矛盾：dormant 不是持久状态，"dormant 满 90 天"没有独立可观测的含义，唯一可测的边界是 `lastSeen` 的年龄。实现取验收那条：**> 30 天 dormant，> 90 天由 `delegated` 自动 archived**；`assisted` 只自动降级、归档要显式命令；`manual` 完全不派生（存的值就是答案）。
2. **三种模式收敛为「制造权限阶梯」**，因为规格里「模型可以提议」这半没有通道：本包不注册任何工具（AGENTS.md 的不变量），模型无法自己声明白名单外的 slug。于是确认门槛放在命令上——`assisted`（默认）与 `manual` 都拒绝裸 slug 并点名 `/context task <slug> new`，`delegated` 把裸 slug 当成声明并建文件；`manual` 另外冻结状态派生。**残留**：模型主动提议的通道未实现，`assisted` 与 `manual` 在"谁造"上目前一致，差别只在状态派生。
3. **绑定必须由归档写保护**。`meta.json` 的每轮刷新（`queueSessionIndexEntry` → `sessionMetaOf(session)`）会从活会话重建整份元数据，因此它会把 `/context task` 写的 `task` 擦掉——绑定"用一次就丢"，而症状看起来像命令没生效。`preserveForeign` 让新元数据缺失的 `kind` / `parentId` / `task` 从已存文件继承；命令自己的写（含解绑这种"缺失即删除"的授权写）走同一条队列与锁，因此解绑不会被下一次 settle 复活。`parentId` 的写方（`performHandoff`）仍未实现，这个继承是给它的前置。
4. **`archived` 既不注入也不写入**。只读侧不注入是表格原文；写侧同样要退回去，否则一次 pass 刷新 `lastSeen` 就把它自动复活了。两个半边共用一个判定 `boundTaskSync`（绑定 + 文件存在 + 非 archived），所以提示词与写入不会对"这个会话拥有哪个文件"给出不同答案；绑定本身留在 `meta.json` 里，`activate` 之后立刻恢复注入。
5. **任务文档不是第二套格式**：`CONTEXT.md` 与 `tasks/<slug>.md` 共用 `context-doc.ts` 的一个渲染核心（同一节 schema、同一预算、同一截断标记）。任务头是 `# Project Task: <slug>` 加一行 `> created … · status … · lastSeen … · title …`；`title` 进这一行是因为「其他任务」清单要一个标签而不该打开正文，"` · `" 在标题里安全（`title` 是最后一个字段且解析锚定在 `lastSeen` 之后）。`session-logs/<id>/meta.json` 的 `task` 字段读出即用，文件的 `created` / `status` 在每次写入时保留，`lastSeen` 由落地本身刷新。

**验收（`test/tasks.test.mjs`，19 条用例）**：① 无 task 的会话注入与今天逐字节一致（用 `buildContextInjection` 的同一输入比字符串）；② 绑定后注入的是任务文档（`## Project Task (slug)` + 指向 `tasks/<slug>.md` 的指针），且 pass 写的是任务文件、`CONTEXT.md` 逐字节不动；③ 30/31 天与 90/91 天的边界各有用例，`manual` 冻结与 `archived` 粘滞各有一条。
**变异校验**：11 个变异（dormant 边界、manual 冻结、delegated 归档、archived 粘滞、绑定继承、archived 注入、写目标、`lastSeen`、`created`、任务注入源、空清单块）各自只让目标用例转红；还原后 `src` 与哈希备份逐字节一致并重建。
**未做（残留）**：① 模型主动提议的通道（见上）；② 同一任务被多个会话绑定时后写覆盖前写（`CONTEXT.md` 今天也是这个语义，任务只是把它按工作流切开）；③ 子代理不继承父会话的绑定，它看到的是项目级文档。

### 11.5 清洗通道

**裁定**：自动跑（用户选乙），删前先 tar；清理记录进独立日志（用户选丙）。

- **触发**：每次整理 pass 之后（整理本身是低频的）。
- **自动处理的**：`MEMORY.md.memory-backup-*` 只留最近 3 份；`memory-log-*.jsonl` 与 `memory.jsonl` 超过 90 天的轮转；`errors.log` 超过 1MB 轮转；`skill-candidates` 里超过 60 天的。
- **绝不自动删的**：`session-logs/` 下任何会话目录。理由是本批改变了记忆的删除语义——**时间线就是审计线**，删了会话日志，「被取代」和「久未证实」这两个触发就再也无法回溯。
- **顺序**：tar 到 `.agents/memory/trash/<date>.tar` → 删 → `purge.log` 追加一行（时间 / 目标 / 字节数 / 结果）。
- **手动预览**：`/memory prune`（不带参数）只报告将删什么；`/memory prune --apply` 才真删。自动路径等价于 `--apply`，但同样先 tar。

**落地（2026-11-10，`src/project-memory/prune.ts` + `/memory prune`）——五处按实现收敛**

1. **归档器写在进程内，不 shell 出去**。本包有一条被 `test/project-root.test.mjs` 钉死的不变量：`src/` 与 `client/` 的任何模块都不许有命令能力，而 `tar` 是外部命令。于是 ustar 由 30 行代码自己写（512 字节头 + 补零 + 两个零块），用例用真 `tar -tf` 交叉验证它读得回来，包括超过 100 字节的成员名（走 ustar 的 prefix 拆分）。
2. **先归档、再校验、最后才删**。计划里的文件先全部读进内存 → 写 tar → 用同一个解析器读回**磁盘上的字节**逐成员核对 → 才开始删；任一步失败一个文件都不删，`purge.log` 记 `result=failed: …`。这与 §11.3 的墓碑同源：不可回滚的删除不值得它省下的空间。
3. **触发在 pass 之后，但只算"真的跑了"的那次**。清理挂在 `consolidateProject` 的写完成之后；返回 `deduped` 的 pass 不触发（什么都没发生，也就没有东西变旧）。失败只 `logger.warn` + 写自己的日志，不进 `/memory update` 的回执——清理失败不许把一次已落地的写报成失败命令。
4. **同一天第二次运行要能追加**。trash 是 `<date>.tar`，未压缩；`tar -r` 对压缩包不可用，所以格式选 ustar + 追加（先剥掉尾部零块再拼新成员），早上那份证据不会被下午覆盖。
5. **`purge.log` 的"每次一行"是"每次真的清理了"**。自动路径无事可清时不写（否则每个 pass 一行）；预览一行都不写（看过不留痕）；显式 `/memory prune --apply` 即使无事可做也写 `result=nothing`。`targets` 超过 6 个只列前 6 个并给计数，突发不会写出 4 KB 的行。

**验收（`test/prune.test.mjs`，17 条用例）**：① 自动与手动两条路径之后 `session-logs/` 的目录数与内容都不变（同一条用例里的正控：同一次运行真的删了文件，所以负控不是空转）；② tar 里有全部被删成员（真 `tar -tf` 交叉验证，含同日追加与超长成员名）；③ `purge.log` 每次落地一行、预览 0 行、清空之后的自动运行不再增行。
**变异校验**：11 个变异各只让目标用例转红——保留份数（3）、两个年龄地平线（90 天 / 60 天）、错误日志阈值（1 MB）、名字过滤放宽到 `backup`、计划扫进 `session-logs`、tmp 规则误吞活 `memory.jsonl`、归档写到别处却按内存校验、空闲也记日志、预览变成执行、自动钩子摘掉；还原后 `src` 与哈希备份逐字节一致并重建。
**未做（残留）**：① trash 里的 tar 本身没有保留期上限——它只按天增长，若某天真的清理了很多次，需要手工删（比自动删证据安全，暂不自动化）；② 同一秒内两次运行写同一个 `memory.jsonl.*.tmp` 候选时，tar 会记两条同名成员（解包取最后一条），实际不可达因为候选要求 90 天年龄；③ `errors.log` 的 1 MB 轮转在追加路径（`error-log.ts`）与清理通道各触发一次，两个入口共用同一段截断文本，但不是同一把锁。

### 11.6 todo 接线

**裁定**：只收当前会话（用户选甲），但**写入时机**用 `turn/end`（用户选甲），因为 todo 是每会话一份，不继承。

- `turn/end` 时读 `todo/write` 投影（`null` = 没写过，与空列表区别对待）。
- 与上次写入的 Open tasks 快照比较，**相同就不写**（多数轮次不写）。
- 不同则替换该任务 Open tasks 里带 `[todo]` 前缀的那些行，其余条目不动。
- **不调模型**。这是 §11.3 的例外：机械部分可以随时写，散文部分仍只在整理 pass 更新（用户 Q2 选乙）。
- 已知不一致窗口：todo 行已经更新、Summary 还是旧的。接受。

### 11.7 路由型技能

**裁定**：一个短的入口技能（用户选乙），渐进式披露。

- 位置 `.agents/skills/dsh-project-context-maintenance/SKILL.md`（名字要避开 autolearn 已生成的名字）。
- 正文只有一张判断表：**要做的事 → 跑哪条命令 / 读哪个文件 / 加载哪个技能**（记忆维护、索引与归档、交接、技能沉淀四块）。
- 专项细节**不复制**，指向既有技能（`dsh-project-memory-cap-guard`、`agents-memory-recovery`、`dsh-handoff-auto-trigger-forensics`、`dsh-skill-corpus-consolidation` 等）。
- `MEMORY.md` 的 `## Index` 节加一行指针，保证它被看见；不靠模型的自觉。
- 不使用 `ctx.skills.register` 注入（用户 2026-11-10 明确否决：要的是磁盘上可 review 的技能）。

### 11.8 批次与验收

| 批次 | 覆盖 | 依赖 | 验收（必须能机械判定） |
|---|---|---|---|
| **Z1** | §11.1 + §11.2 | 无 | ① 删上限后全部行保留（本机实测 187 目录 / 187 行，0 缺失、0 多余，整份重生成 61 ms）；② 经归档路径造一个新会话目录（那一步会写 `meta.json`）→ 同一次写入即出现一行；纯空目录（无 `meta.json`、无 `session.jsonl`、无旧行）不建行，因为没有日期/标题来源，硬造就得拿目录 mtime 编日期；③ 删一个目录 → 下一次写入行消失；④ 同一 id 永不出现两行；⑤ 老行回填后重复生成逐字节一致；⑥ 宿主启动时扫一次（`reconcileSessionIndexOnce`，每项目每进程一次，遵守 `archiveEnabled`，失败进 `errors.log` 并允许重试） |
| **Z2** | §11.3 墓碑 | 无 | ① 构造一条锚点漂移条目 → 退休后正文消失、`retired.md` 多一行；② 第二次整理不再把同一事实写回（用墓碑摘要做阴性对照） |
| **Z3** | §11.4 任务 | Z1（`meta.json` 的 `task` 字段） | ① 无 task 的会话行为与今天逐字节一致；② 绑定后注入的是 `tasks/<slug>.md`；③ 31 天不活动的任务自动 `dormant`，91 天自动 `archived` |
| **Z4** | §11.5 清洗 | Z2 | ① 自动清理后 `session-logs/` 目录数不变（负控）；② trash 里有 tar；③ `purge.log` 每次一行 |
| **Z5** | §11.6 todo | Z3 | ① 同一 todo 不重复写；② 会话结束前未完成项已在 Open tasks；③ 没写过 todo 的会话不产生 `[todo]` 行 |
| **Z6** | §11.7 技能 | 无 | ① 技能能被 `skill` 工具加载；② `MEMORY.md` 里的一行指针不超预算；③ 与既有技能无同名 |

**状态（2026-11-10）**：Z1、Z2、Z3、Z4 已落地；Z2/Z3/Z4 的落地小节在 §11.3/§11.4/§11.5 末尾，Z1 的记录在 `CHANGELOG.md` 的未发布段（§11.1/§11.2 未另写落地小节）。Z5（todo）与 Z6（路由型技能）未开始，Z7 仍是 Z4 的后续。

Z1 先做：它同时闭合「索引漏写」「悬空」「迁移不补」三件事，且不需要任何配置键。

**需要新增配置键的只有 Z3 一处**（任务维护模式），按 batch H 的教训：`config.ts`、`settings.ts`、`client/card-fields.ts`、`locales.ts`、读取方、`settingPatch` 六处一起动，并先改两个 profile 再重启。

### 11.9 已知风险与残留

- **生成式索引的代价**：每次写索引要读 N 个 `meta.json`（本机实测 187 目录整份重生成 61 ms）。归档是低频操作，接受；若要优化，按目录 mtime 缓存，不要改成增量 append（那会重新引入两处真相）。
- **首次重生成会重排行序**：新顺序是「日期升序、同日按 id」，旧文档是历史追加序，实测 187 行里 157 行换了位置。日期序列仍然非降（这正是 autolearn 取最新 50 行所依赖的），25 个同日日期改由 id 决定先后，结果确定。
- **`delegated` 模式的规则**：现在只定义了「出现显式声明才建」。若不定义得更细，agent 可能给每个会话都造一个任务——这是本批风险最高的默认值，建议上线时默认 `assisted`，`delegated` 由用户显式打开。
- **CONTEXT 机械写与散文写不一致**：接受（§11.6）。
- **墓碑只注入标题**：语义相近但措辞不同的事实仍可能复活；用「整理时发现重复就合并」的既有能力兜，不新增机制。
- **`HANDOFF.md` 仍是项目级单文件**：暂缓（§11.2）。
