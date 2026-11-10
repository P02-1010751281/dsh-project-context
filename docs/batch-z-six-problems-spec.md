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

**事实**（dsh `packages/todo/tool-todo`，子系统文档 `docs/subsystems/todo.md`）：

- `TodoItem = { content: string, status: "pending" | "in_progress" | "completed" }`——**刻意极简**：无 id、无优先级、无 activeForm，因为每次 `todo_write` 是**整表快照**（last-write-wins）；
- 事件 `todo/write` 落在**会话日志**里，跨轮次、跨重开都在；列表属于**创建它的那个 agent 会话**。

**建议**：不新增存储，做三件读的事：

1. 整理 pass 读当前会话的 `todo/write`，把未完成项渲染进 `CONTEXT.md` 的 Open tasks（带 task 标记）——这样 Open tasks 有作者、有状态，不再是自由发挥；
2. 交接时把当前 todo 快照写进种子（它已在父日志里，但种子要重述，否则子会话看不到）；
3. 跨会话的长期任务仍归 `CONTEXT.md` / 任务注册表，todo 只当会话内工作集——两者别混。

## 10.8 插件注入 skill：可以，而且有两条路

**事实**（dsh `packages/skill/README.md`）：

- `ctx.skills.register({...})` —— 注册**内存里的 embedded skill**，无需文件；registry 自动补 invocation policy，来源标为 `runtime`；同一层内同名 `runtime` 注册**先到先得**并告警。
- `ctx.skills.registerProvider(provider)` —— 注册一个目录提供者，**同步**注册，返回 disposer；`runtime` 是保留名。
- 每个 skill 带 `{modelInvocable, userInvocable}` 四象限，模型面与人类面各自取舍。
- 已知限制（README 明写）：provider 串行查询（一个慢的拖后面所有）、被拒 provider 不留 last-good 目录、同名遮蔽没有查询 API。

**判断**：能注入，但不该把它当主通道。

- 本项目现在的 autolearn 走的是**文件**（`.agents/skills/<name>/SKILL.md`），由 `skill-filesystem` 发现——可 review、可 diff、可 commit、重启仍在；
- `register()` 的价值在**短生命周期、会话级**的指引（例如「本项目交接流程」这种随配置变化的提示），代价是**重启即消失**、不可审阅、与磁盘技能同名时先到先得会**悄悄遮蔽**；
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
