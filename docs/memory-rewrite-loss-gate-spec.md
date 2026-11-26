# 记忆整篇重写的静默概括（规格）

状态：**已落地**（2026-11-21，§10 的只报不拒观测版 `406835f`；§11 的修复闸属批次 AC）。本文件保留当时的诊断、候选设计与裁定过程。
起因是一次观测事故：两次自动整理 pass 把 `MEMORY.md` 整篇重生成，结构计数器全 0、回执报 `updated`，
但一批精确标识符被概括成散文，没有任何一道闸看得见。

---

## 0. 一句话

模型「整篇重写」记忆时，会把具体标识符（符号名、配置键、错误串）压成散文；tier C 数的是条目存亡，
数不到条目**内部**的信息密度。需要一道机械可证的**标识符存活校验**，首版只报不拒。

---

## 1. 现场（2026-11-20，可复现）

| 时刻 | journal `op` | 落盘字符 | 条目 |
|---|---|---|---:|---:|
| 09:37 | `replace` | 39,900 | 150 |
| 10:06 | `replace` | 41,659 | 157 |
| 基线（提交前版本） | — | 44,996 | 145 |

- `memory.jsonl` 末条 `{ts, op, text}` 的 `text` 长度**恒等于**落盘文档长度 ⇒ 两次都是整篇重生成，不是增量编辑。
- 同期线上 `consolidate.js` / `record.js` 与 HEAD 的 sha256 相同（`6e6e8e23…`），`src/shared/` 在 35 个提交里零改动
  ⇒ 不是版本差异，是这条路径的固有行为。
- 逐行抽反引号 token（**必须按行**，跨行会让抽取错位）：旧 553 / 新 514，74 个缺失；
  其中 13 个只是反引号被去掉、文本仍在，**61 个真的消失**。例：
  `LoadedMemory.cappedDroppedChars`、`fitted.clipped`、`sectionsSemanticallyEmpty`、`withTodoLines`、
  `fallbackUpdate`、`cachedProjectRoot`、`x-opencode-session`、`reason === "manual"`、`HandoffRouteError`、
  `engines.dsh`、`dsh.profile.bundles`、`handoffBudgetRecentTokens: 0`、`N section(s) exceeded their budget`。
- 两版都能被 `renderMemoryDocument(sections, cap)` 逐字节往返，`sectionDropped` / `droppedItems` / `itemTruncated` 全 0。

**结论**：「结构完好 + 回执干净」不构成「事实未丢」的证据。

---

## 2. 现有闸各自看什么，为什么都漏

| 闸 | 判据 | 漏在哪 |
|---|---|---|
| tier C | `sectionDropped` / `droppedItems` / `itemTruncated` | 只数条目存亡，概括后条目还在 |
| partial guard / batch Q2 | section 级遗漏、Project/Index 条目丢失 | 同上，粒度是条目 |
| opaque gate | 文档是否四节形状 | 形状对就放行 |
| `normalizeMemoryDocument` | 长度是否超 cap | 变短不触发 |
| `renderMemoryDocument` | 预算内丢条目 | 概括换来的余量让它什么都不丢 |

共同的盲区：全是「条目的存在与否」，没有一道看**条目内部的信息密度**。

---

## 3. 候选设计

### A. 标识符存活校验（推荐）

- **定义**：单行内被反引号包住的串，长度 ≥ 3，不含换行。按行抽取，不跨行。
- **时机**：落地写之前抽旧文档；新回复渲染成文档之后抽新文档。
- **判定**：`lost = old − new`；对每个 lost 再查它是否仍以裸文本存在（只丢了反引号，不算丢）；
  余下的计入 `generalized <n>`，并留最多 10 个样本进 `errors.log`。
- **首版只记不拒**：回执追加一行、日志写一行，不改任何拒绝逻辑。
- **理由**：误报未测（见 §6），先攒真实数据；这与 tier C 当初「先报告、后拒绝」的落地顺序一致。

### B. 回复改成补丁（结构化差分）

模型只返回 add / remove / replace 指令，写侧把指令应用到既有文档。

- 优点：从根本上不可能「整篇重写」。
- 成本：解析器、冲突检测、部分应用语义、全部写侧测试重写；比 A 大一个量级。
- 结论：留作 A 跑出数据后的下一步，本批不做。

### C. 让模型自报删除清单

回复里带 `dropped: [id…]`，与写侧算出的差异比对。

- 缺点：模型对结构变化感知是准的（本次出现的是零丢失的结构），对语义压缩是盲的；
  指望它自报「我概括了什么」不可靠。
- 结论：不做。

---

## 4. 推荐路径

1. 先做 **A 的观测版**：回执与日志各一行 `generalized <n>` + 样本，不拒绝。
2. 跑 3~5 次真实 pass 看这个数：
   - 稳定为 0 → 极端案例，A 只作为诊断行长期保留。
   - 经常 > 0 → 升级为拒绝（`generalized-refused`），复用 tier C 的形状：一次定向重试，仍失败则整次不写。
3. B 只在数据证明「概括是常态」时才考虑。

---

## 5. 明确不做

- 不引入语义相似度 / 嵌入 / 模型判分：dsh 没有文本 tokenizer，且判定不稳。
- 不改 tier C 三个计数器的含义（它们描述的是另一件事）。
- 不在 v1 拒绝。

---

## 6. 误报源（实现前必须定清）

- **合法合并**：两条并一条必然丢 token，需要「显式声明合并」的通道（沿用 `supersedes:` 的思路）。
- **跨行抽取**：反引号成对但跨行时会错位，既多报又漏报——必须按行。
- **中英混排**：`token` 里可能混入标点或全角符号。
- **示例 / 代码块**：正文里讲反引号用法的条目会自报。
- **重命名**：条目把旧符号名换新名是真实更新，机械校验会报 lost。

---

## 7. 待裁定

1. 先做 A 的观测版（只报不拒）？**推荐是。**
2. 观测样本量：3 次 / 5 次 / 一周？
3. `lost` 口径：只数「条目仍在但被概括」，还是也含「整条消失」（后者 tier C 已覆盖，需避免重复计数）？
4. 回执位置：`/memory` 状态行、`/memory update` 回执，还是两处都放？（Batch V 的 stale 是两处都放）
5. 是否同时把 profile 的 `maxMemoryChars` 提高作为运营缓解——本轮已把我方 profile 从 45,000 提到 52,000，
   这是运营手段，不进代码。

---

## 8. 复现

以下三条都在 2026-11-20 实跑过（输出见 §1）。

```bash
# 1) 证明是整篇重写而不是增量：journal 末条长度 == 落盘长度
python3 -c "import json;l=open('.agents/memory/memory.jsonl').read().strip().split('\n')[-1];print(len(json.loads(l)['text']))"

# 2) 逐行抽反引号 token 并比对（必须按行，不跨行）
git show <base>:.agents/memory/MEMORY.md > /tmp/old.md
cp .agents/memory/MEMORY.md /tmp/new.md
node -e 'const fs=require("fs");const t=s=>new Set([...s.matchAll(/`([^`\n]{3,})`/g)].map(m=>m[1].trim()));const o=t(fs.readFileSync("/tmp/old.md","utf8")),n=t(fs.readFileSync("/tmp/new.md","utf8"));console.log("old",o.size,"new",n.size,"missing",[...o].filter(x=>!n.has(x)).length)'

# 3) 证明结构计数器看不见这件事（应为 0 0 0）
node -e 'const fs=require("fs");(async()=>{const {sectionsFromMarkdown,renderMemoryDocument}=await import("./lib/project-memory/sections.js");const s=sectionsFromMarkdown(fs.readFileSync(".agents/memory/MEMORY.md","utf8"));const r=renderMemoryDocument(s,52000);console.log(r.sectionDropped,r.droppedItems,r.itemTruncated)})()'
```

注意第 3 条的 cap 必须是**当前 profile 的** `maxMemoryChars`：用库默认 40,000 会对一份 44,996 的文档报出
运行环境里不存在的丢弃（记忆 `aae`）。

## 9. 独立评审发现的规格缺陷（2026-11-20）

强模型（`gpt-6.2-astra`，只读、独立上下文）按本规格逐条复核，判定方向对、但**在允许它拒绝写入之前必须先修三处**：

1. **§8 的示例抽取器会错配反引号。** 在匹配阶段就过滤「短于 3 字符」的 span，会让一个短 span 的收尾反引号与下一个开头配对。同一份字节：规格的正则报 **61** 个缺失串，先配对再过滤则报 **57**。
2. **§3 的判定是「文档级集合」，量不了逐条存活。** 某个符号在别的条目里还活着，就会掩盖它从原本解释它的条目里消失；反过来，一次合法改名会被记成丢失。因此这个指标的正确名字是 **missing literals（字面量缺失）**，不是「条目存活」，也不能单独用作准入闸。
3. **§0 的前提有一处错。** tier C 量的是「候选文档渲染会丢什么」；模型完全可以在渲染之前就把一条旧条目省掉，于是 `sectionDropped` / `droppedItems` / `itemTruncated` 仍是 0、状态仍报 `updated`——所以「tier C 已经覆盖旧条目消失」不成立。

据此的落地顺序：先用 `memory.jsonl` 的历史 diff **离线校准**这个指标（不需要新的模型调用），**只报不拒**，且只在写入成功之后报；频率本身不足以构成阻断理由。

## 10. 落地（2026-11-21）：只报不拒的观测版

按 §3 A + §4 第 1 步落地，`src/project-memory/missing-literals.ts` + 写侧一处判定。四件事在这
一轮被独立评审与自证定死，写在这里免得下次重新论证：

1. **基线是「模型看到的那份」，不是库里的原文。** Batch Z2 的退休计划在建提示词之前删条目，拿
   `basisKey` 当基线会把这次 pass 自己做的、`retired.md` 已记账的删除报成「静默丢失」——正是本仓库
   最忌的报错因。所以 `ConsolidationOutcome` 多了 `shownMemory`，测量以它为准。
2. **落盘字节在同一把锁内读回。** 锁外读会读到并发宿主写入的另一份文档；测量必须描述这次真的落盘的
   那份字节（读回为空时视为「没有观测」，不把不可读当成清空）。
3. **裸文本判定要整词、且在反引号之外。** `next.includes(literal)` 会把 `memoryComparisonKey` 在
   `memoryComparisonKeyWithDrop` 里当成还在；同一批 66 次转换实测：子串判定 4.74/次，整词判定
   5.41/次，即子串规则掩盖了 44 条真实丢失（12%），方向恰好是让这个指标看不见它要看的东西。
4. **回执只放 `/memory update` 首行**（折叠卡只显示首行）。§7 第 4 问的答案是「不能两处都放」：这个
   计数不持久化，`/memory status` 读的是文件而不是上一次 pass，放上去只能靠猜。

最终校准（落地实现本身，6 份 journal 66 次转换）：零丢失 30 次（45%），均值 5.41 个字面量/次，中位
1，最大 67，p90 13；证据在 `.agents/evidence/2026-11-21-missing-literals-calibration/`。早先那份
59 次 / 6.41 / 68 是「先配对、但不做裸文本检查」在 5 份归档上的口径（本轮复现一致），缺的是裸文本这
一层；§8 那行「匹配阶段就过滤短 span」的正则在同一批上是 7.46 / 74。两者都不再引用。

下一步仍是 §4 第 2 步：跑 3~5 次真实 pass，看这个数稳定在 0 还是常态非 0，再决定是否升级为拒绝
（`generalized-refused`）。在此之前不拒绝、不写进承诺。

## 11. 落地（2026-11-21）：修复闸（批次 AC）

§10 的观测版在真实 pass 上报出了 3 次丢失，其中两次是**同一条 pitfall 在同一天被删两次**（20:40、
20:48），第三次是中文翻译 pass 掉的 19 个字面量。观测不足以阻止它，所以 §4 第 2 步的升级条件由现场
满足：不是「每周计数是否稳定」，而是「同一个事实被反复删除」。

实现 `src/project-memory/lost-entry-repair.ts`，判据与拒绝面：

1. **范围**：只有 `Invariants` 与 `Pitfalls`。`Project` / `Index` 每轮被重写是设计（§3 的
   `removedSectionEntries` 同样排除它们）。
2. **丢失的判据**：规范化正文（去条目 id、压空白）在新文档里不存在，**且**该条带的每个反引号字面量
   在整篇里既不作为反引号出现、也不作为整词出现。合并/改写至少保留一个字面量，这正是 §9.2「合法改名
   会被记成丢失」的反面：只在全部字面量一起消失时动手。
3. **无字面量的条目不修**：纯文字条目被改写与被删除在机械上不可分，猜就是复活。它们仍由
   `removedSectionEntries` 报告。
4. **拒绝面**（2026-11-21 评审后修正）：被判退休的 id 来自 batch Z2 的**返回值**（`droppedIds` ∪
   `supersededIds`），不是在回复文本里扫 `supersedes:`——`retireReply` 返回前就剥掉了标记，扫文本的
   过滤器在真实链路上恒为空，会把被替换的条目回填到它自己的墓碑旁边（评审实测）。声明的目标即使已
   不在回复里也进 `supersededIds`，否则“换掉但不重复旧条目”的回复会被当丢失。恢复后重渲染丢任何
   东西（整条、per-item 截断、解析不回）都算 `no-room`，此时**不写恢复版**，保留回复原样并报
   `Not restored:`——不拿新丢失换旧丢失。日志行改在写盘点并由 `snapshot.written` 门控：修复在写之前
   决定，但被 basis-key 拒绝的 pass 什么都没落盘，先写的 `restored …` 会是假话。
5. **位置**：tier C 之后、batch Z2 退休之后。恢复条目原文（含 id）并把它补进 `keepIds`，否则侧车剪枝
   会重置年龄；`retirement.ids` 因此仍描述落地文档。
6. **可见性**：`/memory update` 首行 `Restored: N …` / `Not restored: N …`，`errors.log` 各一行。
   回执仍只放首行（折叠卡），理由同 §10 第 4 条。

**已知残余（明确接受，不猜）**：模型把一条事实换掉但不写 `supersedes:<id>`（典型是改名：`Alpha` →
`Beta`，或整段翻译）时，旧条目会被当成丢失回填，落地文档同时含新旧两条。试过的“同段落词汇重合度”判别
器在它自己的 wiring 用例上就把一次真实丢失判成了替换，所以不采用——猜错的代价是静默不回填，而回填的
代价只是一条可见、可被下一轮正常退休的旧事实。回执的 `Restored:` 就是让人看见它。

变异轮（10 个，全部编译后具名打红）：字面量存活恒 false、无字面量条目也修、supersedes 失效、
Project/Index 也修、放不下也当成功、用回复自身当基线（永远无丢失）、找到但不追加、退休 id 过滤器失效、
`restored` 日志不受 `snapshot.written` 门控、`retiredIds` 漏掉 `supersededIds`。
