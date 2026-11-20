# 记忆整篇重写的静默概括（规格）

状态：**规格，`src/` 未改**。等 §7 的裁定。
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
