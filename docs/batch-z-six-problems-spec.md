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
