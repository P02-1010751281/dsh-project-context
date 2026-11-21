# 批次 AA：三个核的状态机、过期与碎片整理（规格，2026-11-21）

> 起因（用户 2026-11-21）：「session-log 的状态机、memory 的状态机、autolearn 的状态机；
> memory 和 skill 会过时会失效，而且需要整理碎片；各种其他问题都得处理，核心之间的相互配合。」
>
> 本文只做诊断与拆分，**不改 `src/`**。批次字母 `AA` 是暂定（见 §7 第 6 问）。
> 所有断言都指向当前 `HEAD` 的源码；读不到的路径已重读过一次再下结论。

## 0. 结论先行

1. **状态机大多已经存在，只是没被叫这个名字**：记忆条目有 id、年龄、退役原因与不确认扫描
   （`retirement.ts`）；任务有 `active/dormant/archived` 三态且由 `lastSeen` 派生（`tasks.ts:35/42/140`）；
   会话索引是目录与 `meta.json` 的投影（`session-index.ts:495`）；autolearn 有候选队列 +
   `autolearn-generated` 标记 + `/autolearn approve` 唯一取代通道。
2. **真正的缺口是「同一个事实有两只探测器、结论不同、其中一只不行动」**：按存在性判定并**会退役**的
   `anchorDriftReasons`，与按内容指纹判定、**只上报**的 `bindAndMeasure`。两者共享词法
   （`anchors.ts`），但没有任何一处把它们合成为一个「条目状态」。
3. **技能没有过期通道**：被提升的技能只能被「下一次 autolearn pass」取代，没有任何东西检测它所
   描述的东西已经变了。
4. **碎片整理只有预算驱动的**：条目因整体到帽才被丢；没有合并/再平衡步骤。当前
   `MEMORY.md` 51,448/52,000，Pitfalls 106%、Index 118%，全靠别的节闲置额度借用。
5. 本文给出 6 条批次的拆分与 **6 个待裁定问题**（§7）。**未裁定前不动一行源码。**

## 1. 现场事实（每个核：状态载体 / 转移 / 判定 / 消费者）

### 1.1 memory

| 面 | 事实 | 位置 |
|---|---|---|
| 身份 | 条目 id 是正文 sha256 派生的 **3 hex**，尾标 `（abc）`；`supersedes:` 目标解析到迁移后的 id | `retirement.ts:48`、`:60`、`:71`、`:131` |
| 会行动的过期 | ① 显式 `supersedes` → 退役；② **anchor drift** → 退役（原因 `anchor-drift`）；③ **180 天不确认** + 提及扫描（只在扫描完整时成立） | `retirement.ts:418`、`:419`、`:30`、`:438` |
| anchor drift 判据 | 词法候选必须带可检查扩展名；**父目录必须存在**；只判「不存在」与「行号越过文件尾」 | `retirement.ts:179-224`、`anchors.ts:39` |
| 只上报的过期 | 写入成功后绑定 shc 指纹（16 hex），测出 `stale / missing / unverifiable / bound`，进 `/memory` 回执与 `/memory status` | `staleness-source.ts:45`、`:57`、`index.ts:447`、`:986`、`status-report.ts:175` |
| 绑定范围 | 排除 `.agents/memory/`（自身产物）与 `lib/`（生成物）；**包含** `src/`、`docs/`、`.agents/skills/` | `staleness-source.ts:34`、`:42`、`:63` |
| 年龄时钟 | 日期存在 `entries.json`，**正文一改写就重置**（id 由正文派生 ⇒ 改字就换标）；现存尾标多数与按当前正文重算的结果不同 | `retirement.ts:60`、`entries.json` 的读写 |

**两只探测器的分工（关键）**：存在性/行号那只**行动**，内容指纹那只**只报**。因此
「文件还在但内容换了」这一类过期，既不会退役、也不会触发任何改写——它只出现在回执的一行计数里。

### 1.2 session-log

| 面 | 事实 | 位置 |
|---|---|---|
| 状态载体 | 目录 `session-logs/<id>/`（`session.md`、`session.jsonl`、`meta.json`），项目级 `INDEX.md` | `src/shared/project-state.ts` |
| meta | `kind` / `parentId` / `task`；交接子会话在播种前写入 | `session-index.ts:469`（`setSessionTask`） |
| INDEX 是投影 | 每次按目录 + `meta.json` 重生成；非 `LINE_PATTERN` 的行被忽略（不报错、不保留） | `session-index.ts:37`、`:178`、`:495` |
| 触发点 | `agent/created` 时补一次（迁移/装机留下的目录靠它捡起），外加各写入点 | `project-context/index.ts:150` |
| 显式生命周期 | **没有**：状态由「目录在不在」+ `meta` 隐含，没有 live/settled/archived/retired 字段，也没有被放弃交接的墓碑 | 见上 |

### 1.3 autolearn

| 面 | 事实 | 位置 |
|---|---|---|
| 候选队列 | `.agents/memory/skill-candidates/<name>.md`，本地不跟踪 | `candidate.ts:22` |
| 状态文件 | `.agents/memory/autolearn-state.json`（轮次/窗口计数），本地不跟踪 | `learn-state.ts:10`、`:34` |
| 取代通道 | 被提升的技能带 `<!-- autolearn-generated: … -->`；`/autolearn approve <name>` 是**唯一**取代路径 | `skill.ts:33-38`、`candidate.ts:168` |
| 材料窗口 | 回溯窗口按索引条目取（`MAX_INDEX_ENTRIES = 50`），不是整份历史 | `pass.ts:70` |
| 过期 | **没有**：没有任何东西检测技能所引用的代码/路径已变，也没有「候选长期未审」的提示 | 见上 |

### 1.4 核心之间怎么咬合

咬合不是函数调用，是**路径即锚点**：

- memory 条目引用 `.agents/skills/…`、`docs/…`、`src/…`；这些路径进了绑定集合（§1.1），所以
  「被引用的文件消失/行号越界」**会**退役引用它的条目（`anchor-drift`）。
- 反向没有：技能被取代（同名、新正文）时，指向它的 memory 条目**不会**被标脏——技能文件还在，
  指纹变了也只进 `stale` 计数。
- 整目录移动是**盲点**：父目录不存在时 `anchorDriftReasons` 直接跳过（那是刻意的，否则每个跨仓引用
  都会被判死）⇒ 技能族改名后，旧指针既不退役也不报漂移。

## 2. 缺口清单（按影响排序）

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| G1 | 内容漂移只报不行动 | `staleness` 只被 `index.ts:986` / `status-report.ts:175` 消费 | 「文件还在、事实已不成立」的条目可以永久留在文档里 |
| G2 | 两只探测器、两套词汇、无单一条目状态 | `retirement.ts:418` vs `staleness-source.ts:143` | 同一个条目可能「退役原因=drift」而「回执=stale」，或都不报；违反「一种义务一处判定」 |
| G3 | 年龄时钟会被改写重置 | 记忆不变量 `ffa` | 180 天不确认规则对常被改写的条目永不触发 |
| G4 | 整目录移动是盲点 | `retirement.ts:191`（rule 2） | 改名/搬家后指针悬挂，既不退役也不报警 |
| G5 | 技能无过期通道 | 仅 `skill.ts:33-38` 的 marker + approve | 技能描述的代码已改，技能照旧被注入/被指向 |
| G6 | 碎片整理只有预算驱动 | 四节占用 Pitfalls 106%、Index 118% | 只能靠整理 pass 的合并措辞，无结构性再平衡 |
| G7 | session-log 无显式生命周期 | `meta.json` 无 `state` | 「被放弃的交接」「长期未 settle」这类状态无法查询，只能靠目录存在与否推断 |

## 3. 建议的批次拆分（每批一个可验收行为）

- **AA1（单一状态层，无新判据）**：一个纯函数，从现有事实派生每个条目的状态词汇
  `healthy / anchor-drift / content-stale / age-unconfirmed / superseded`，让退役、回执、`/memory status`
  三处消费同一结果。**不新增判定条件**，只统一。验收：三处读同一个函数；变异「退役忽略 drift」打红。
- **AA2（内容漂移的可行动通道）**：给「文件在、内容变了」一个显式出口（建议独立命令
  `/memory reconcile`，或在整理 pass 里的一个可选步骤），把条目改写成指针或交给人裁定；
  默认仍不自动退役。
- **AA3（移动/重命名的指针改写）**：引用路径不存在、但同名文件在别处存在时，给出「改写指针」候选
  而不是退役（先出候选、后写盘）。
- **AA4（技能过期与取代）**：技能自身引用的锚点同样做 drift 检测，产出的只能是**候选**，
  仍需 `/autolearn approve`；替 autolearn 补「候选长期未审」的提示。
- **AA5（碎片整理）**：显式的整理步骤——同节/跨节合并重复、再平衡；以预算与损失闸为边界，
  复用指针化流程。
- **AA6（session-log 生命周期，最小版）**：先只加**派生视图**（`/session-log status` 一行给出
  live/settled/archived 计数），不加 `meta.json` 字段；确有需要再谈持久字段。

## 4. 不做什么

- 不引入数据库/索引服务（记忆不变量 `4e1`）。
- 不让插件自己压缩会话（`347`：压缩归宿主）。
- 不新增第二份真相：条目状态的唯一来源是现有事实，AA1 只是派生。
- 不动交接阈值与压缩策略（AOCI 裁定的「明确不做」）。

## 5. 复验方法

- 每批落地后跑 `pnpm test`（现 725 条），并对新判据做变异轮（`dsh-plugin-mutation-round`）。
- 涉及文档写入的，仍走插件写路径并以 `loadMemory` + `isMemoryTruncated` + 逐字节往返复验。
- 派生视图类（AA1/AA6）用离线探针喂真实文档，测三处消费者读到同一状态。

## 6. 残余（现在就写清楚，不留给「以后再说」）

- 集成商不透明的两条：`staleness` 的 16 hex 指纹只是变更检测，不是签名；扫描不完整时不判不确认
  （`retirement.ts` 的 `complete` 门），所以「没被提及」永远只是「这次没扫到」。
- AA2/AA3 一旦能改写正文，就必须复用 tier C 与整篇重写损失闸，否则会开出第二条静默丢失路径。

## 7. 待裁定（编号；每题带推荐，答「是」即接受推荐）

1. **先做 AA1（单一状态层）？** 推荐：**是**。它不改任何判据，只把已有事实合成一处，
   风险最低，且是后面几批的前提。
2. **内容漂移（G1）怎么处置？** 推荐：**B —— 报 + 显式 `/memory reconcile`**，默认不自动退役；
   A 自动退役会误删仍成立的事实，C 维持只报等于不治理。
3. **整目录移动（G4）？** 推荐：**A —— 改写指针**（先出候选），B 退役会丢事实，C 维持盲点。
4. **技能过期（G5）谁有权处置？** 推荐：**A —— 只产候选，仍走 `/autolearn approve`**；
   B 自动标记 `superseded` 会绕过唯一的评审门。
5. **碎片整理（G6）何时触发？** 推荐：**A —— 只在 ≥90% 上限时**，与「取用顺序」同一触发器；
   B 常开会每轮多花 token，C 纯手动容易忘。
6. **批次字母与顺序？** 推荐：**AA1 → AA2 → AA4**（先统一、再治理内容、再管技能），
   AA3/AA5/AA6 视前三条的结果再排；字母 `AA` 若无异议即定，否则用 `Z9`。

### 7.1 裁定结果（2026-11-21，用户已答）

| # | 裁定 | 落地含义 |
|---|---|---|
| 1 | **AA1 先做** | 先统一状态层，不改判据 |
| 2 | **显式 `/memory reconcile` + 自动维护**（自定义组合） | 见下方合并说明 |
| 3 | **改写指针，先出候选** | 不自动退役 |
| 4 | **只产候选 + 自动标记**（自定义组合） | 见下方合并说明 |
| 5 | **AA1 → AA2 → AA4**，字母用 `AA` | AA3/AA5/AA6 后续排期 |

**第 2 问的合并（「显式通道 + 自动维护」怎么同时成立）**：两条通道分权，不互相越界——

- 显式：`/memory reconcile` 按需跑，可以改写正文（改写成指针或按当前代码重述），走 tier C 与整篇重写
  损失闸，逐条可预览。
- 自动：整理 pass 在**到达触发条件**时（与取用顺序同一阈值，≥90% 上限）把内容漂移条目**重述/指针化**，
  **不删条目**；仍是「无证据不删」。自动通道不退役任何仍成立的事实，退役只能来自
  supersede、anchor-drift（路径消失）或显式 reconcile 的裁定。

**第 4 问的合并（「只产候选 + 自动标记」）**：按证据强弱分权——

- 强证据（技能引用的锚点**全部**消失或行号全部越界）→ 允许自动标记 `expired`，生成一条 tombstone 记录，
  这份技能不再被注入、也不再作为 memory 指针的目标；
- 弱证据（部分锚点漂移、内容可能只是变化）→ 只产候选，仍走 `/autolearn approve`。
- 不变量保持不变：**内容替换**（同名新正文）仍只有 `/autolearn approve` 这一条路；`expired` 是
  「失效标记」，不是「用新内容取代」。两者的区别必须写进命令回执。

## 8. AA1 的实现契约（已裁定，下一轮直接照此落地）

**新增** `src/project-memory/entry-state.ts`（纯函数，无 I/O）：

```ts
export type EntryState = "superseded" | "anchor-drift" | "content-stale" | "age-unconfirmed" | "healthy";
export interface EntryStateFacts {
  readonly superseded?: ReadonlyMap<string, string>;   // 被取代的 id -> 取代者
  readonly drifted?: ReadonlyMap<string, readonly string[]>; // id -> anchorDriftReasons
  readonly stale?: ReadonlySet<string>;                // StalenessFacts.staleIds
  readonly unconfirmed?: ReadonlySet<string>;          // 过 180 天且扫描完整的 id
}
export function entryStateOf(tid: string, facts: EntryStateFacts): { state: EntryState; detail: string };
```

- **优先级**（与现有退役顺序一致，也是「越确定越先」）：superseded → anchor-drift → age-unconfirmed →
  content-stale → healthy。`content-stale` 排在最后，因为它是唯一**不行动**的状态（AA2 才给它出口）。
- **消费者**：退役（`retireSections` 三条循环各问一次，顺序与 tombstone 文案不变）、`/memory status`
  （只能供 superseded + content-stale，drift/不确认需要异步扫描，回执里注明是子集）、`/memory` 回执
  （暂保持文件级计数不变，AA1b 再统一）。
- **验收**：纯函数用例覆盖优先级与四种事实来源；`retireSections` 行为不变（现有用例全绿、无需改写）；
  变异两个必须打红：① 优先级里把 content-stale 提到 anchor-drift 之前；② `retireSections` 忽略 drift。
- **残余**：`/memory status` 报的是子集（drift 要读盘、不确认要扫会话），这点写进回执文案，
  不能假装它与退役看到的是全量。

### 8.1 落地状态（2026-11-21）

- **AA1a 已落地**（`2119010`）：`src/project-memory/entry-state.ts`（`entryStateOf` / `retiresEntry` /
  `countEntryStates`，零新探测）+ `retireSections` 三条触发循环改为向它提问，tombstone 文案与顺序不变；
  7 条新测试（6 纯核心 + 1 退役引擎仲裁），4 个变异各自被命名用例打红，`pnpm test` **732/732**。
- **AA1b 未做**：`/memory status` 与 `/memory` 回执仍说文件级词汇。接入时必须注明「drift 与不确认
  需要异步扫描，回执只报 superseded + content-stale 子集」，不得用一个 0 让人以为扫过。
- 下一批按裁定是 **AA2**（内容漂移的显式 + 自动两条通道），`AA4`（技能过期）在其后。

## 9. 质量门：三个产物坏法不同，门也不同（2026-11-21 第二轮）

**先立一条原则**：门只能守**机械可判定**的属性——结构、预算、字面量存活、形状、指纹、重复度。
「这条事实现在还对不对」
不可门禁，它只能靠证据绑定（已有 shared 指纹）+ 退役/改写通道（AA1/AA2/AA4）。
把不可判定的东西写成门，只会得到一个永远为绿的装饰。

| 产物 | 坏法 | 已有哪些门（证据） | 缺什么 |
|---|---|---|---|
| `MEMORY.md` | **事实消失或失真**（压缩措辞、整篇重写、锚点失效） | 形状（`sectionsFromMarkdown`）、节预算 + 全篇帽（`memory-schema.ts`）、单条 800、空骨架闸、截断守卫、tier C 拒绝、整篇重写损失度量（`index.ts:395`，报告）、行锚漂移退役（`retirement.ts:418`）、源指纹（`staleness-source.ts`，报告）、id 身份 | 损失度量仍**只报不拒**；没有「重复度」阈值；没有「事实密度/可检索性」指标 |
| `CONTEXT.md` / `tasks/<slug>.md` | **陈旧与重复**（每轮重写、可能与 MEMORY 冲突、Open tasks 混入已完成项） | 形状（`context-schema.ts:47` 的工具 schema + `consolidate.ts:217` 形状错就整份丢弃）、读帽 `MAX_CONTEXT_CHARS`（`index.ts:110`）、渲染预算与 `dropped`（`context-doc.ts:93/109`） | **没有任何重写损失度量**：`missingLiteralsBetween` 只接了 memory（`index.ts:395`）；没有与 MEMORY 的重复检测；Open tasks 的「只含未完成」只有 todo 机械行受约束 |
| `.agents/skills/**` | **适用性丧失** + 近名/同 procedure 重复 | 名字 kebab、描述 ≤1024、正文上限、注入启发（`candidate.ts:48-51`）、同名冲突规则（`:83`，只有 autolearn 自己的可被取代）、`autolearn-generated` 标记、`/autolearn approve` 唯一取代路径 | **零适用性门**（描述的代码改了没人管，AA4）；去重是 **exact-name**（`:83`），同义两名会永久并存；没有引用计数（谁在用这份技能） |

### 9.1 建议新增（按成本递增，全部先报告、不拒绝）

1. **context 的重写损失度量**（最便宜）：同一只 `missingLiteralsBetween` 直接吃 context 重写前后的两段文本，
   进 `/memory` 回执第二行与 `/context` 状态。纯函数、零新依赖，且与 memory 的度量口径一致。
2. **memory × context 重复句检测**：token Jaccard ≥ 0.5 的跨文档对 → 报告「同一事实有两份拷贝」。
   今天实测**最高 0.16、≥0.5 的 0 对**，所以它先是一条常驻体检项，不是救火项。
3. **Open tasks 机械校验**：`- [todo]` 行已受 `todo.ts` 约束，但模型写的散文项不受；检查「已完成」字样
   出现在 Open tasks 段落时报告。
4. **技能近名/同 procedure 检测**：名字族（前缀 + 编辑距离）+ 正文 Jaccard ≥ 0.5 → 候选合并，
   先在 `/autolearn` 报告里出，不动 `rejectionReason`（拒绝新候选会误杀）。
5. **技能引用计数**：memory 指针 + 会话提及统计；长期 0 引用 → 归档候选。

## 10. 碎片整理：先量，再谈过程

**「碎片」必须先有度量，否则「整理」不可验收。** 2026-11-21 实测（三个口径都跑了）：

| 口径 | 度量 | 结果 |
|---|---|---|
| memory 内部 | 条目两两 token Jaccard（170 条） | 最高 **< 0.30**，没有可合并的真重复 |
| memory × context | 跨文档 Jaccard（170 × 21） | 最高 **0.16**，≥0.5 的 **0 对** |
| skill 正文 | 两两 token Jaccard（40 份） | ≥0.30 的 **0 对** |

所以**当前没有「重复型碎片」可清**。真正的不平衡是三处结构性的：

1. **memory 的节占用与需求不匹配**：Pitfalls 106%、Index 118%，靠别的节闲置额度借用（Batch N 的
   「份额是目标不是帽」）。这不是重复，是布局问题。
2. **context 是每轮重写的摘要**：它的风险不是重复而是**漂移**（与 MEMORY 分叉、Open tasks 留旧项）。
3. **skill 的去重只有 exact-name**：今天 0 对近名，但机制上不防，一旦出现就会长期并存。

**建议的整理过程**（每条带触发与验收）：

- **memory**：触发 = 文档 ≥90% 上限 **或** 最高 Jaccard ≥0.5；过程 = 合并真重复 → 指针化 →
  节间再平衡；验收 = `missing-literals-between` 只报主动搬走的字面量 + 渲染往返逐字节 +
  `itemTruncated 0`。（这套流程本轮已手工跑过两次，是可复现的。）
- **context**：触发 = 每次整理 pass（它只有 ~3.7K 字符，成本可忽略）；过程 = 去重（MEMORY 留全文、
  context 留指针）+ 清已完成项；验收 = 与 MEMORY 的跨文档 Jaccard 不上升 + 形状仍可解析。
- **skill**：触发 = 每次 autolearn pass 只**出候选**（不自动合并/不自动归档）；过程 = 近名/同 procedure
  合并、0 引用归档；验收 = 合并后引用该 procedure 的 memory 指针仍指向存在的路径。

## 11. 第二轮待裁定

1. **context 的损失度量**：复用同一只 `missingLiteralsBetween`、报告-only 起步？推荐**是**——同一口径，
   零新依赖，先看现场分布再谈是否设阈值。
2. **质量门的强弱**：默认报告-only，只对「可证明必然有害」的写入拒绝（tier C、形状错、注入启发）？
   推荐**是**；把 `Missing literals > N` 直接设成拒绝线会重演「误杀比漏放贵」的教训。
3. **碎片整理的触发**：memory 按「≥90% 或最高 Jaccard ≥0.5」、context 每 pass、skill 只出候选？
   推荐**是**；三条都没有自动写盘。
4. **顺序**：AA2（内容漂移通道）→ AA4（技能过期）→ AA5（context 门 + 三处整理）仍然是主线；
   context 的门（9.1 第 1 条）成本最低，若想先见到收益，可以插在 AA2 之前单独成一条 **AA2b**。

### 11.1 落地状态（2026-11-21）

裁定四条全按推荐，先做了插队的 **AA2b**：

- **AA2b 已落地**（`1ee6524`）：`ConsolidationOutcome.shownContext` + 落地后 `contextMissingLiterals`
  → `/memory` 回执（点名 `CONTEXT.md` 或绑定的 `tasks/<slug>.md`）+ `errors.log`；首写不量；只报不拒。
  2 条测试、3 个变异各自被命名用例打红，`pnpm test` **734/734**。
- **残余（写进 CHANGELOG）**：`/memory status` 尚未显示这一项；pass 窗口内的外部改写会让基线不是
  模型看到的那份，与 memory 半边同类。
- 下一批按裁定是 **AA2**（内容漂移的显式 + 自动两条通道），随后 **AA4**（技能过期），**AA5** 收三处整理。
  AA2 的规格已按「先量后设计」写成 [batch-aa2-reconcile-spec.md](./batch-aa2-reconcile-spec.md)：实测 25 条有绑定、
  6 条已漂移（精度 1/6），自动阶梯（85%）已存在，故 AA2 收窄为「让阶梯看得见漂移」+「`/memory reconcile` 的
  报告 / 强制 pass / `--accept` 再基线」。

## 12. 落地：会话日志的状态判定（AA3，2026-11-21）

§3 的 AA6 原本只写「派生视图」。补上之后它同时是 AOCI 那四个失败名的报告面：

| AOCI 名 | 本核的判定 | 修复方向 |
|---|---|---|
| Missing | 索引有一行、目录不在 | 重新归档或删行 |
| Orphan | 目录在、索引没有行 | 补一行（`reconcileSessionIndexOnce` 的下一次） |
| Stale | 行与 `meta.json` 的日期/标题不一致 | 重生成那一行 |
| Unbaselined | 目录没有 `meta.json` | 补 meta 或重新归档 |

加两个本核自己的状态：`dangling`（它继承的父会话已不在磁盘上）、`abandoned`（交接子会话超过 `SETTLED_DAYS`
且一个人类回合都没有）与健康的 `live` / `settled`。`/session-log status` 输出计数 + 最坏若干条，首行带载荷。

**只读是有意的**：把生命周期写进 `meta.json` 会成为第二份真相，而它能与目录本身不一致——这套判定的
全部价值就是发现这种不一致。所以这里没有「转移」，只有「修复」：四种失败态各自的补救都在回执的
detail 里点名。

现场：211 个会话、10 live、201 settled、0 需修。

## 13. 落地：技能核的状态与转移（AA4，2026-11-21）

`src/project-autolearn/skill-state.ts`（纯）+ `skill-state-source.ts`（I/O）。五态：

| 状态 | 判据 | 谁动它 |
|---|---|---|
| `unbaselined` | 没有指纹基线（提升前的老技能） | `/autolearn bind`（显式） |
| `expired` | **每一个**引用路径都不存在，且**每个都从其父目录仍在的目录里消失** | 系统（autolearn pass 开始前）/ `/autolearn expire` |
| `drifted` | 有引用文件变了，或部分消失 | 只报告 |
| `moved` | 每个引用都随其父目录一起消失（搬家，不是删除） | 只报告：补救是指针改写 |
| `orphan` | memory / context 里没有任何一行引用它 | 只报告 |
| `intact` | 基线存在、全部未变、仍被引用 | — |

两条拒绝是这套自动化的地基：**只动带 `autolearn-generated` 标记的技能**（手写技能只读），
**父目录消失不算过期**（与记忆核 `anchorDriftReasons` 的 rule 2 同源，否则一次搬家会被读成删除）。

`/autolearn status` 只读；`/autolearn bind` 补基线；`/autolearn expire <name>` 显式移出（移到
`.agents/memory/expired-skills/`，可搬回）。现场：18 个学习型技能全部 `unbaselined`。

### 13.1 与 AOCI 的关系

这是 AOCI 那笔账的落点：四个失败名（Missing / Orphan / Stale / Unbaselined）只是词汇，当初被拒是因为
没有报告面；AA3 建了会话日志那一面，AA4 复用了同一套命名。**不借代码、不引依赖**（FSL-1.1-MIT），
边界与记忆 `4c9` 一致。

## 14. 落地：两个设置项与 bind 的报告缺口（AA6，2026-11-21）

三条判定此前把决定它们的事实写死在代码里，验收时又暴露一处报告歧义，本批一并收口。

| 设置项 | 默认 | 管什么 | 此前 |
|---|---|---|---|
| `sessionSettledDays` | 7（1–365） | `live`/`settled` 分界、`abandoned` 判据、交接子会话日志扫描门槛 | `session-state.ts` 的 `SETTLED_DAYS` 常量 |
| `autolearnExpireSkills` | true | 过期技能移出服役 | 隐式跟着 `autolearnEnabled` |

两个开关的语义边界：`autolearnEnabled` 管「要不要花模型调用去沉淀」，`autolearnExpireSkills` 管
「要不要把已失效的技能移出服役」。沉淀关闭时，handler 只调 `retireExpiredSkills`（无模型调用），
所以关掉沉淀不再意味着让过期技能永久注入。

报告缺口：`bindableAnchors`（`src/project-autolearn/skill-state-source.ts:77-93`）跳过 `lib/`、
`.agents/memory/` 与项目根外绝对路径，这是对的（构建产物每次构建都变）；错的是它对「永远绑不上」
沉默。`bindSkills` 现在返回 `{bound, skipped}`，回执第二行点名 skipped；`SkillFacts.bindable` 让
`unbaselined` 分成两句不同的 detail：有可绑锚点但没记录过 vs 根本没有可绑锚点。

变异 6 个全部具名打红；其中「命令硬编码 7」首版不编译（`SETTLED_DAYS` 未在该文件导入），改成字面量
`7` 后才算证据——不编译的变异不是证据。
