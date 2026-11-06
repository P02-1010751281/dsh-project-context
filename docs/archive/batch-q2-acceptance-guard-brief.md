# 批次 Q2 —— 回复不得丢掉 store 里已有的段（验收守卫）

出处：第九次 pi triage 的 **batch Q 残留⑤**（`docs/upstream-pi-triage.md` 的 batch Q 段末），
pi 侧参考实现 `extensions/project-context/memory/pass.ts`（读自 `d25ecab`，即第九次 pass 记录的
`origin/master`；本节所有 pi 引用都指这一版）。用户 2026-10-11 裁决：**都做**——合并、拒绝、报告
四者都要，按下面的分层落地（它们不是四选一，是四种后果各管一层）。

## 1. 缺陷（现证，不引用 prose）

`sectionsFromMarkdown` 要求**四段齐全**（`src/project-memory/sections.ts:571` 的
`seen.size !== SECTION_KEYS.length` 直接 `return undefined`），而 batch Q 新加的形状门
（`hasMemoryDocumentShape`）**接受四段的任意子集**。两条合起来留了一扇门：

`consolidate.ts:363-365` —— 只带 `## Invariants` 的回复形状合法（过 Q 的门）→ `sectionsFromMarkdown`
读不出四段 → 落 `fallback-opaque` → `index.ts` 把回复**逐字**写成 `MEMORY.md`。于是 store 里原有的
Project / Pitfalls / Index **整段消失，且没有任何诊断**（dsh 侧 `grep -rn 'removedSectionEntries\|RemovedEntries' src/`
= **0**，也没有 `memory regression` 这类措辞；pi 有，但语义是「只报告、不拦」，见下）。

入库探针 `.agents/evidence/2026-10-11-batchQ2-acceptance-guard/probe.mjs` 现在 `exit 10`，逐条点名
**4 个未满足的期望**，同时两条对照（裸 store 上逐字写、完整四段重写照常落盘且无幻影诊断）已通过——
改完这两条必须仍通过：

```
A 只带 Invariants 的部分回复 → 期望：省略的段从 store 保留、带上的段生效
                              现状：replacedVerbatim=true，只剩 - i2
B 形状合法但不可合并（段里夹 prose）→ 期望：store 逐字节不变、不声称写过
                              现状：逐字替换、memoryWritten=true
C 四段重写丢掉一条 Invariants 条目 → 期望：照常落盘 + errors.log 点名
                              现状：落盘了，errors.log 为空
D 对照：裸 store + 部分回复 → 期望：与今天一致（逐字写）
E 对照：完整四段重写 → 期望：与今天一致
```

## 2. 分层规则（用户裁决「都做」的可落地分解）

③（拒绝**段级**丢失）与 ④（合并）在同一输入上互斥——合并之后就没有「丢段」可拒了。因此顺序是
**先合并、不可合并才拒绝**，而①只报告针对的是**条目级**丢失（粒度不同，互不冲突）：

| 层 | 粒度 | 行为 | pi 对应 |
| --- | --- | --- | --- |
| **L1 报告** | 条目级：本轮回复里少了的 Invariants/Pitfalls 条目 | 照常写入 + `errors.log` 一行 `memory regression: N Invariants/Pitfalls entry(ies) are no longer present, e.g. …` + 报告字段 | pi `removedSectionEntries`（`pass.ts:123-133`、`:300-320`），原样照抄：**Project/Index 故意排除**（它们本来就每轮重写），归一化后比对，**只报告绝不拦** |
| **L2 合并** | 段级：形状合法但不完整的回复 | 当 store 能解析出四段时，回复**按补丁**应用：带上的段替换、没带的段从 store 保留，再走 `renderMemoryDocument` 渲染 | 无（pi 不做） |
| **L3 拒绝** | 段级：形状合法但**无法**合并 | 段里夹 prose、未知标题、`*`/缩进条目等解析不出段的形状，而 store 又是一份文档 → **不写**，store 逐字节不变 + 一条具名拒绝（与 tier C 的 `lossy-refused` 同族） | 无（pi 在这里也是逐字替换） |
| **L4 可见性** | 两条路径 | L3 拒绝写 `errors.log` 一行（具名原因 + 具名解药）；L2 合并进 `report.mergedFromStore`，**不写例行日志**——合并不是损失，而 `errors.log` 是这个插件的损失/拒绝日志；合并顺手丢掉的**条目**仍由 L1 那一行点名。`ConsolidateReport` 另带 `partialRefused` / `partialRefusal` / `removedEntries`；注入与渲染行为不变 | 无 |

**为什么 L1 必须「只报告」**：拒绝条目级丢失会让每一次**压缩**都变成永久拒绝（本扩展的提示词本来就
要求「压缩而不是删除」，`MEMORY_KEEP_RULE`），store 从此再不更新——pi 选择报告正是这个理由。tier C
的拒绝针对的是**渲染器**因预算丢条目（机械溢出），粒度与语义都不同，那里拒绝是对的。

**为什么 L3 只剩「不可合并」这一种**：L2 覆盖了能解析的省略；剩下会整份替换 store 的，只有解析不出
段的形状（含 batch Q 已登记的 fail-open：`## Project\nsome prose\n- a` 算形状但不解析）。store 本身
不是文档（新项目、低于 `OPAQUE_DOCUMENT_MIN_CHARS`）时不受 L2/L3 影响，照今天逐字写——这是 D 对照。

## 3. 改动面（唯一所有者，不复制规则）

- `src/project-memory/sections.ts`：把 `sectionsFromMarkdown` 的解析循环抽成**一个**实现，公开
  `partialSectionsFromMarkdown(value)`（返回 `{ sections, missing }`，只有结构性违规才 `undefined`）；
  `sectionsFromMarkdown` 行为**一字不变**（完整性判据留在它自己的调用点），既有形状表用例是它的 pin。
- `src/project-memory/consolidate.ts`：新增 `removedSectionEntries(before, after)`（L1，pi 语义）与
  不可合并判定（L3）；opaque 解析结果增加 `merged-partial` / `unmergeable-partial` 两种 kind。
- `src/project-memory/index.ts`：按 kind 写合并后的渲染 / 记具名拒绝 / 写 L1 与 L4 的诊断；报告字段扩展。
- 测试：L1 报告、L1 不拦（压缩仍落盘）、L2 合并、L3 拒绝、D/E 两条对照各一条具名用例。
- 诊断措辞与 `errors.log` 的分类前缀沿用现有 [memory] 前缀，不新增可被 grep 误配的字符串。

## 4. 验收标准

1. 探针 `.agents/evidence/2026-10-11-batchQ2-acceptance-guard/probe.mjs` 由 `exit 10` 转 **`exit 0`**，
   且两条对照自始至终为 OK；
2. 具名用例钉住每一层，**变异体至少 4 个**且各自只打红该打的那条：① 去掉合并（回到逐字替换）② 去掉
   拒绝 ③ 去掉 L1 报告 ④ 把 L1 改成拦截（压缩被拒）；
3. 门禁 `pnpm typecheck` / `pnpm build` / `pnpm test` 现跑 0 / 0 / 全绿，`lib/` 与新鲜 `tsc` 编译只差
   `client.js`，`lib/` 中 0 个变异标记；
4. 独立只读复核（`dsh-plugin-review-fix-batch` 的做法）**无阻塞缺陷**；
5. **改了 `src/` 行为 ⇒ 判据转负，需要宿主重启才在线**（判据照旧：19387 持有者启动晚于最后一个 `src/` 提交）。

## 4bis. 独立只读复核（2026-10-11）与它促成的修改

复核**发现了 1 条 blocking 缺陷**并另提 3 条，全部按「先复现、再修」处理：

- **blocking（已修）**：refusal 原先在 tier C **之前**判定，而 tier C 的重试会替换 `resolved`——重试答一份不可合并的部分文档时，`partialRefused` 仍是 `false`，那份部分文档被**逐字写入**、status 报 `updated`、整份 store 消失。修法是「不可合并的重试永不替换一份可存储的首次回复」（闸门是唯一所有者），由新用例 + 探针 F 段钉住，变异体 M5 只打红这一条。复核建议的「在 tier C 之后重算」经 M5 证明是**死代码**（同一结果已由闸门保证），未采纳。
- **错误归因 ×3（已修）**：拒绝文案对「完整但段里夹 prose」的回复说假话并给出死解药 ⇒ 按哪一半读不出来分成两种原因/两种解药；`memory regression` 一行从判定处移到**写入处**（`snapshot.written` 之后），否则 tier C 拒绝或 basis-key 竞态会留下假话。
- **L4 未实现（按本 brief 修正）**：合并不写例行日志，理由见上表 L4 行。
- 复核**复现不到**的只有一条：我原先声称「没有剩余的静默整份丢失」——它用 `/tmp` 自己的驱动证伪了（即上面那条 blocking）。它的其余检查（`partialRefused` 不会漏设、两条改写过的既有夹具仍测原意图、三条新用例不是自证）与我一致。

## 5. 边界与已登记残留

- L2 的合并**不保留**回复里位于段落之外的内容（标题下的 prose、段尾注记）——那些本来就不是四段结构，
  合并的语义是「段」而不是「文本」，这一点要在用例里写明，免得被当成 bug「修」成保留任意文本。
- L3 会拒绝 batch Q 明确接受过的 `## Project\nsome prose\n- a`（它现在逐字落地）——这是**有意的行为
  收紧**，与 Q 的 fail-open 登记冲突，同轮必须在 CHANGELOG 与 Q 的条目里改口径，不能两处并存。
- 本批不改配置键、无新依赖、两个 profile 无需改动。
