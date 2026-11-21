REVIEW: FIX 7

# 记忆满额取用顺序（retention ladder）提示词批 —— 对抗审查

范围：工作树未提交批次（`src/project-memory/consolidate.ts` 的 3 处提示词改动、`test/prompt-bounds.test.mjs`、`test/logic.test.mjs`、`CHANGELOG.md`）。只读：仓库文件未改，证据写在 `.agents/evidence/2026-11-21-retention-prompt-review/`（`probe.mjs` + `probe-output.txt`）。

复现：`node .agents/evidence/2026-11-21-retention-prompt-review/probe.mjs`

## 速查清单

- [F1] `src/project-memory/consolidate.ts:253` ↔ `:332-333`（近额分支）：同一条近额提示词既允许「收紧措辞」又禁止「缩短仍成立条目的措辞」→ 修完要在 52,000/50,000 的装配提示词里不存在任何允许压缩仍成立条目措辞的句子，并用断言钉住。
- [F2] `src/project-memory/consolidate.ts:264-265` ↔ `:332-333`：无条件的 caption 把「指向拥有该 procedure 的技能/文档」放行，却把「条目自己已经点名」这道护栏只放在条件分支 → 修完要每条指针许可都带「条目已经点名」，且用 roomy 文档的提示词断言。
- [F3] `src/project-memory/consolidate.ts:265` ↔ `:253`/`:333`：caption 删掉了「或已被别处覆盖」，与 keep rule 的删除许可、ladder 第 1 步的合并互相打架 → 修完三句用同一套删除/合并豁免。
- [F4] `src/project-memory/consolidate.ts:304-307` + `:757-790`：ladder 的可达区间是 [46,800, 51,225)，而当前活文档 51,637（99.30%）在 reasoning 路由上先被 fit 闸拒绝，ladder 根本到不了模型 → 修完要么把可达区间写清、要么让 fit 拒绝回执指向可达杠杆。
- [F5] `src/project-memory/consolidate.ts:336-337`（`TRUNCATED_REPLY_RULE`）：仍无条件下令「keeping memory_markdown shorter」，是第三处压缩许可 → 修完该重试必须附上取用顺序，不得裸要求更短。
- [F6] `src/project-memory/consolidate.ts:365`（tier C 重试）：「apply the same ladder」在新常量之后有两个指代，且 `itemTruncated` 单独触发时「文档到了 cap」是假的、ladder 也不在该提示词里 → 修完要指名道姓并区分两种触发原因。
- [F7] `CHANGELOG.md:27-28`：「零事实丢失」不被两个脚本断言；`45000` 与 `44,996` 两个非反引号测量值被丢弃且无处可寻 → 修完 CHANGELOG 与工件逐字相符（收窄措辞或补回）。

## 逐条

### F1（阻断）近额分支重新发放了「压缩仍成立条目」的许可

`src/project-memory/consolidate.ts:253`（本批 edit 1 改写的 keep rule）与 `:333`（本批新增的 ladder）同时出现在 ≥90% 的提示词里。`memorySectionRule` 把 keep rule 拼进固定规则，`memoryBudgetRule` 在近额时追加 ladder，`promptFor` 再拼上 caption，所以装配后的提示词逐字包含：

```
Keep every entry that is still true and make each section fit its stated target above: merge
duplicates within a section, deduplicate across sections. A section still over its target is
fixed by tightening prose, never by dropping a fact. …
The document is at or near its cap, so buy room in this order: merge entries that restate one
fact; … Never shorten a still-true entry's wording to buy room, …
```

（`probe-output.txt` §3 两行均 `[PRESENT]`。）

近额时一个 section 之所以「over its target」，唯一原因就是空间不够；因此「fixed by tightening prose」正是 ladder 点名的丢失动作（本批 CHANGELOG 自己说「一次『每条都缩短一点』的 pass，结构计数全是 0、状态 `updated`，字面量却没了」）。旧版把这条许可放在 `then condense the wording`，本批删了它、却在同一函数的另一句里用「tightening prose」把它放回，并且放在 ladder 前面（模型先读到许可，再读到禁止）。

最小修法：让「收紧措辞」不再等于压缩仍成立条目的措辞，例如 `…is fixed by removing repeated phrasing between entries, never by compressing a fact's wording and never by dropping a fact`；或在近额分支显式声明 ladder 覆盖前文。验收：`memoryBudgetRule(52_000, 50_000)` 装配出的提示词里，任何「允许缩短仍成立条目」的句子都不存在（用 `doesNotMatch` 钉住，而不是只钉 ladder 的正向句子）。

### F2（阻断）caption 的指针许可没有护栏，而护栏只存在于条件分支

`src/project-memory/consolidate.ts:264-265`（无条件、紧贴 `<existing-memory>` 的最后一条指令）：

> …a document that does not fit its cap is fixed by merging duplicates and pointing at the skill or document that owns a procedure…

这句没有任何「条目自己已经点名」的限制；限制只在 `:333` 的 `MEMORY_RETENTION_LADDER` 里（`an entry that already names the skill, tracked document, CHANGELOG entry or test holding its procedure`），而它只在 ≥90% 时出现。后果：**roomy 文档（<90%）拿到的是无护栏版本，且完全没有护栏**——只要模型想「指向拥有该 procedure 的技能」，它可以编一个自己没见过的技能名；这个 pass 不读文件，也没有任何别的句子禁止编造归宿（`CONSOLIDATION_PROMPT_RULES` 里只有「不要发明 entry id」）。近额时两句并存，等于同一动作给了两个宽严不同的版本，模型可以挑宽的那个。

`probe-output.txt` §3：`[PRESENT] pointing at the skill or document that owns a procedure` 与 `[PRESENT] already names the skill, tracked document` 同时成立——护栏没有覆盖 caption 那句。

最小修法：把护栏写进 caption 本身（`… pointing at a skill or document the entry itself already names …`），让无条件文本也不弱于条件文本。验收：任意占用率下装配的提示词里，指针许可与「already names」同句出现；在 roomy 用例里断言这一点（现在 roomy 只断言 ladder 不在）。

残余（可接受，不必本批修）：即使名字已经在条目里，模型也无法证明那个归宿真的持有该 procedure；这是「pass 不读文件」的固有限制。

### F3（应修）caption 的删除豁免与 keep rule / ladder 第 1 步互相矛盾

- `:265`（本批 edit 2 改后）：`every entry that is still true must reappear unless it is superseded`
- `:253`（未改）：`Delete an entry only when it is superseded or already covered elsewhere`
- `:333`（本批新增）：`merge entries that restate one fact`

edit 2 只从 caption 里删掉了「or already covered elsewhere」，keep rule 仍保留。合并两条互相复述的条目必然删掉其中一条，而这条并没有被「supersede」，所以 caption 字面上禁止了 ladder 第 1 步要求做的事。三句对「合并」给出三种结论；模型若按 caption 行事，只能给重复条目补一个 `supersedes:<old id>`——那会在 `entries.json` 记一条本不该有的退休记录，而正确的动作是合并。

最小修法：caption 恢复豁免并点明合并（`unless it is superseded or merged into an entry that still carries the fact`），三句共用一套口径。验收：caption、keep rule、ladder 的删除/合并豁免逐字一致，并用一条断言把三处放在一起比。

### F4（应修）ladder 在动机状态（99%）到不了模型

触发点本身没问题：`memoryBudgetRule` 在 `currentChars >= Math.floor(maxMemoryChars * 0.9)` 时追加（`probe-output.txt` §2：40,000→36,000、52,000→46,800，35,999/46,799 为假，边界含等号）。

但 `promptFor` 拿到的是 `fitMemoryInput` 的结果，而 fit 在 `fitted.clipped` 时于 `:757-790` 直接返回 `fitCappedRefused`，**在 `promptFor` 之前**。本机 profile 的预算（`maxTokens: 8192`、`maxOutputTokens: 32_768`）下：

```
live MEMORY.md 51637 chars (99.30% of 52,000), CONTEXT.md 3707
reasoning=false: no clip up to 51637; ladder band [46,800, 52,000)
reasoning=true:  fit clips from 51225 chars (98.51%); ladder band [46,800, 51225)
```

`reasoning` 取的是 `info?.reasoning !== undefined`（`consolidate.ts` 的 `auxModel`），即路由只要声明了任何 reasoning 能力就是 true——本机正是 reasoning 路由。于是在 52,000 的 cap 下，ladder 的可达区间是 [46,800, 51,225)，而**当前活文档 51,637（99.30%）恰好落在不可达的那一段**：pass 在模型调用前被 fit 闸拒绝，ladder 一次都到不了模型；而「买回空间」这件事又只能靠 pass 跑起来。CHANGELOG 说动机是「库内文档 96–99%」（`:22` 的「仅当 ≥ 90%」在字面上成立），但 99% 这一端实际不可达。

最小修法（择一，且不要硬编码 51,225 这个内容相关的边界）：在 CHANGELOG 写清可达区间是「cap 的 90% 到 fit 闸边界」，并把 `fitCappedRefused` 的回执改成点名可达杠杆（现在只点名 `maxOutputTokens`／「shorten MEMORY.md」）；或让触发按 fit 余量而不是 cap 份额计算，使 ladder 在 fit 夹断之前出现。验收：一个探针同时打印触发点与 fit 边界；CHANGELOG 不再把 ladder 说成 99% 文档的解药。

### F5（应修）截断重试仍无条件要求「更短」

`src/project-memory/consolidate.ts:336-337`：

> Your previous reply was cut off by the model output limit. Retry this same consolidation now without the tool: … keeping memory_markdown shorter.

这是第三处「整篇压缩」许可，且没有「不得丢事实/不得压缩仍成立条目」的限定。它恰恰在输出预算紧（也就是占用高）时开火，因此和 ladder 面对同一个失效模式；本批的动机陈述（「提示词里有两处把整篇压缩措辞写成标准解法」）因此不完整。

最小修法：把顺序附上去——`shorten by merging duplicates and pointing at the skill or document the entry already names; never by compressing a still-true entry's wording and never by dropping a fact`。验收：提示词里不存在任何一处「要求文档更短」却不带取用顺序的句子；用一条断言把该重试的整句钉住。

### F6（应修）tier C 重试的「the same ladder」有两个指代，且触发原因不成立

`src/project-memory/consolidate.ts:365`：

> …The per-section shares are targets, so the entries above were lost because the document itself reached its cap; when the reply carried no sections, apply the same ladder without them.

两个问题：①「the same ladder」在本批之前只指 keep rule 的 merge/tighten 阶梯（`test/logic.test.mjs` 也把 `MEMORY_KEEP_RULE` 称为 "the compression ladder"），本批新增 `MEMORY_RETENTION_LADDER` 后出现第二个指代；②`memoryLoss` 的 `retryWorthy = wholeEntriesLost || itemTruncated > 0`（`:405`），所以**只有 `itemTruncated`**（某条超过 800 字单条上限）时也会重试，而那时「文档到了 cap」是假的，retention ladder 也不在该提示词里（占用率可能远低于 90%）。

最小修法：指名（`apply the same merge-then-tighten order from the rules above`）并区分原因（到了 cap 才提 cap；单条超长就写「把那条拆成两条」）。验收：roomy 文档 + 一条超长条目的重试行既不说 cap、也不指向缺席的 ladder。

### F7（应修）CHANGELOG 的「零事实丢失」不被工件支持

`CHANGELOG.md:27-28`：「…指针化腾出 2,083 字符且零事实丢失（只把 11 个 codex 字面量搬进技能）」。

成立的部分（已复现，`probe-output.txt` §6）：`previous.md 51998 -> next.md 49915 = 2083`；`missing literals 11`，11 条全是 codex 字面量，且 11/11 逐字在 `.agents/skills/dsh-subagent-codex-model-pin/SKILL.md` 里（`absent from the codex skill: 0`）。

不成立的部分：两个非反引号测量值被丢弃且在任何跟踪记忆里都找不到——`45000` 与 `44,996`（curate 前 7d0 条目是「raised from 45000 on 2026-11-20 so the 44,996-character document has headroom」，curate 后只剩「carries `maxMemoryChars: 52000`」）。另外 `/tmp/memory-curation/curate.mjs` 与 `repair.mjs` **都不断言**零丢失：前者只 `console.log("missing literals vs the old document: N")`，N=11 也照样退出 0，零丢失是人工判读。因此「只把 11 个 codex 字面量」这个括号是不完整的，且「零事实丢失」把人工结论写成了机械结论。

最小修法：收窄为「零反引号字面量丢失」并点名被删掉的两个测量值（或把它们补回条目）；若这个数字要当门禁，就让 `curate.mjs` 在 `count > 0` 时失败。验收：CHANGELOG 那句话与两个工件逐字相符。

## 确认无误（不必再议）

1. **`lib/` 与 `src/` 一致**：`lib/project-memory/consolidate.js` 含三处新文本，`consolidate.d.ts` 导出 `MEMORY_RETENTION_LADDER`，`git diff --stat -- lib/` 为 2 文件 +52/−5——「改 `src/` 必带重建 `lib/`」的门禁成立。
2. **全量门禁绿**：`pnpm test` → `ℹ tests 718 / ℹ pass 718 / ℹ fail 0`，exit 0（本机实跑）。
3. **边界是 inclusive 的 90%**：40,000→36,000、52,000→46,800 为真，35,999/46,799 为假；不是 91% 触发。
4. **提示词增长已量清**：keep rule 284→345（+61）、caption 266→345（+79）、budget base 415→378（−37），无条件 +103 字符/pass；ladder 376 字符，近额再 +480。
5. **近额测试夹具真的过线**：raw 3,312（82.8% of 4,000），id 盖章后 3,702（92.5%）；且用例断言的是**提示词报告的占用率**（`currently about 3[6-9]\d\d`），所以夹具依赖盖章这件事是显式的——盖章失效会红，不会静默跳过分支。roomy 侧只有「不在」的断言，但装配层不会空过（近额用例证明 join 非空）。
6. **其余提示词没有第二处删除许可**：`CONSOLIDATION_PROMPT_RULES` 的「Remove stale or duplicated information」与「仍成立才保留」自洽（stale 条目不属「still true」）；autolearn 提示词不含任何改写记忆的指令（只把 memory 当输入）；`MEMORY_ENTRY_ID_RULE` 的「the old entry is retired automatically」是 supersede 通道，自洽。
7. **变异 4/4 的说法与断言一致**：无条件追加会打红 `prompt-bounds` 的 roomy `!includes` 与 `logic` 的 roomy `doesNotMatch`；99% 阈值会打红 36,000 的 `includes`；caption 回退会打红 `doesNotMatch(/condensing its wording/)`；keep-rule 回退会打红 `doesNotMatch(/then condense the wording/)` 与 `match(/fixed by tightening prose/)`。仓库对我只读，我没有重跑变异轮，但四个变异各自改变的都是新测试正向/负向钉住的字符串，红是必然的。
8. **不要磨掉的**：ladder 的「already names」护栏与 `Never shorten a still-true entry's wording to buy room` 是这个方向最有辨识度的两手；修 F1/F2 时把它们保留在原位（F2 只是把护栏复制到 caption，不是删掉 ladder 那句）。
