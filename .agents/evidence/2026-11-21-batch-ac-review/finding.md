# 批次 AC 独立对抗评审（提交 `dcc45f9`）

- 评审对象：`dcc45f90372ad95ac866fdf582a30d159bf6de60`（`feat(memory): restore entries a consolidation pass dropped while their literals vanished`）
- 评审方式：只读。未改 `src/`、`client/`、`lib/`、`test/`、`package.json`、`docs/`、`CHANGELOG.md`；未 `pnpm build`；未 git add/commit。
- 运行环境：`node v24.22.2`，`lib/` 为提交内已构建产物（`git status --short` 只有他人未跟踪文件）。
- 结论：**不可按当前提交合并交付。** 修复闸的核心判据（tier C 之后、只回填 Invariants/Pitfalls、字面量全消失才动手、`no-room` 不写）成立，但「被取代的旧条目」这条拒绝面在真实调用链上不可达，会把已退休事实回填（含与墓碑并存）；`errors.log` 的 `restored …` 行在写盘被拒时已经写出；合法改名/翻译式替换会被回填成重复事实。

## 一、确定的缺陷

### H1（阻塞）`supersedes:` 拒绝面在真实调用链上不可达：被取代的旧条目被回填，且可与墓碑并存

- 位置：
  - `src/project-memory/lost-entry-repair.ts:67-82`（`declaredSuperseded` 只扫 `after`）、`:85-100`（`declared.has(id)` 才跳过）
  - `src/project-memory/consolidate.ts:1132`（`before = plan?.sections ?? sectionsFromMarkdown(existing.text)`）、`:1148`（`repairLostEntries(oldSections, current, …)` 的 `after` 是 `resolveReply` → `applyRetirement` 之后的结果）
  - `src/project-memory/retirement.ts:489-499`（`retireReply` 先 `stripSupersedesMarkers(sections)` 再退休；返回的 sections 里已没有任何 `supersedes:` 文本）、`:132-149`（`supersededIds` 在同一调用里消费声明）
- 触发现场：`after === resolved.sections` 是 `retireReply` 的产物，它把回复里所有 `supersedes:` / `取代` 标记剥掉（`retirement.ts:498-499`），被点名的旧条目若被回复回声又会先被退休掉。于是 `declaredSuperseded(after)` 恒为空集，`lostEntries` 的「替换不是丢失」分支在接线路径上永远不会命中；旧条目只要字面量一起消失就会被原文回填。
- 最小复现（端到端，用已构建 `lib/`；两条都在实跑中执行过）：
  1. 回复**不回声**旧条目、只写新条目并声明替换：回复 Invariants 为 ``- `gamma` replaces it（9ff）supersedes:1ab`` → 落地文档同时含 ``rule `alpha` holds（1ab）`` 与 ``gamma``，回执 `Restored: 1 entry(ies) …`。
  2. 回复**回声**旧条目并声明替换（最坏）：回复 Invariants 为 ``- rule `alpha` holds（1ab）`` + ``- `gamma` replaces it（9ff）supersedes:1ab`` → 退休先按声明把 `1ab` 从回复里删掉并记墓碑，修复再把它从 `before` 回填。实际落地：`MEMORY.md` 仍含 ``rule `alpha` holds``，而 `retired.md` 写着 `- 2026-11-21 · rule `alpha` holds · superseded-by:9ff`——**同一次 pass 里墓碑与条目并存**，直接违反本模块注释「a tombstone and a repair must never describe the same entry」。
  - 复现脚本（`/tmp` 一次性；输出见下）：
    ```js
    // 关键部分：seed 见 test/memory-loss-repair.test.mjs 的 WIRE_SEED；reply.memory_markdown 的 Invariants 换成本条两行
    const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });
    // A: invariants = ['- `gamma` replaces it（9ff）supersedes:1ab']
    // A2: invariants = ['- rule `alpha` holds（1ab）', '- `gamma` replaces it（9ff）supersedes:1ab']
    ```
    输出（A）：`status: updated restored: {"count":1,...} landed has old alpha: true | has gamma: true`
    输出（A2）：`landed still carries retired alpha entry: true` / `tombstone file: - 2026-11-21 · rule `alpha` holds · superseded-by:9ff`
- 建议改法：`supersedes` 的声明必须在**退休前**的回复上取。让 `applyRetirement` 把它本来就算好的 `declaredSupersedes`（`retirement.ts:498` 的 `supersededIds`，已处理 `取代`、全角冒号与四位→三位解析，`retirement.ts:63-65`、`:411`）返回给 `consolidateProjectState`，再作为显式参数传给 `lostEntries` / `repairLostEntries`；不要在 `lost-entry-repair.ts` 里自建第二条正则（现状只认 ASCII `supersedes:`，`supersedes：`/`取代：` 与四位目标都认不出，见纯函数探针输出）。
- 验收：新增**接线**用例（驱动真实 `consolidateProject`，不传纯函数夹具）：回复声明 `supersedes:<before id>` 时，无论是否回声旧条目，落地文档都不得含该旧条目，`report.restoredEntries` 为 `undefined`，`retired.md` 与 `MEMORY.md` 不得互相矛盾。

### H2（阻塞，小改）`errors.log` 的 `restored …` 行在最终没落盘时已经写出

- 位置：`src/project-memory/consolidate.ts:1161`（`await logError(… "restored N …" …)` 在模型调用后、写盘前）；写盘拒绝点 `src/project-memory/index.ts:381-383` + `src/project-memory/record.ts:117-118`（basis-key 变更拒绝）。
- 触发现场：basis-key 竞态（或锁/日志写失败）让 `recordMemoryDocument` 返回 `written:false` 时，回执（正确地）报 `Memory: was not rewritten …`，但 `errors.log` 里已经留下「restored 1 …」——一次什么都没落地的 pass 在日志里声称做了修复。同一文件紧邻的 `removedEntries` 日志特意放在写盘点并 `snapshot.written` 门控（`src/project-memory/index.ts:424`、`consolidate.ts:1168-1170` 的注释），本行违背同一原则。
- 最小复现（端到端，实跑）：在模型 `stream()` 里于回复落地前用 `recordMemoryDocument` 改写 `MEMORY.md`，然后 `consolidateProject(..., {force:true})`：
  - 回执：`Memory: was not rewritten — it changed while this pass's reply was being built …`
  - `report.status: "stale"`、`report.restoredEntries: undefined`（回执这一半是对的）
  - `errors.log` 同时含：`… [memory] restored 1 Invariants/Pitfalls entry(ies) …` 与 `… [memory] the memory changed while this pass's reply was being built; the reply was not published …`
- 建议改法：把 `restored …` 行移到写盘点，和 `removedEntries` 一样放在 `if (snapshot.written && outcome.restoredEntries !== undefined)` 里；`no-room` 的 `Not restored …` 行要么同样门控，要么把措辞改成对回复的判断（“would restore”），不声称落盘。回执字段本身已由 `wroteMemory` 门控（`src/project-memory/index.ts:488-489`），无需改。
- 验收：一个写盘被拒的接线用例断言 `errors.log` 不含 `restored ` 行；正常落地用例仍各一行。

### H3（阻塞，需裁定）合法改名/翻译式替换（旧字面量全部消失、未写 `supersedes:`）被回填成重复事实

- 位置：`src/project-memory/lost-entry-repair.ts:99-100`（唯一判据是「每个反引号字面量都消失」）；被否定的前提在 `src/project-memory/lost-entry-repair.ts:11-14` 与 `docs/memory-rewrite-loss-gate-spec.md` §11.2（「合并/改写至少保留一个字面量」），而同一份规格 §9.2 明说「合法改名会被记成丢失」——两处自相矛盾。
- 触发现场：把符号改名（`Alpha`→`Beta`）、把符号名换掉的中文翻译、或把两条并成一条且新措辞不再含旧字面量时，旧条目会连同旧措辞被原文回填，落地文档同时陈述新旧两个名字。
- 最小复现（端到端，实跑）：seed Invariants 为 ``- the client uses `Alpha`（1ab）``，回复 Invariants 为 ``- the client now uses `Beta`（9ff）``：
  - `report.status: updated`，`report.restoredEntries.count: 1`
  - 落地：`- the client now uses `Beta`（9ff）` + `- the client uses `Alpha`（1ab）`
  - 回执：`Restored: 1 entry(ies) …`
  - 纯函数探针另确认同规则命中「翻译成中文、旧字面量未保留」「两条并一条且措辞重写」；而「拆成两条」「合并保留字面量」「整条移入别的段落/别的条目正文」都正确地不回填。
- 建议改法（方向，需 lead 拍板）：机械上可加一道「替换感」判别——旧条目在回复里有**同段落的新条目**且与新条目正文共享足够多非字面量词（如 Jaccard/最长公共词）时视为替换，不回填；或明确接受该残余风险，同时删掉规格与模块注释里「改写至少保留一个字面量」的断言。无论哪种，都要在 `test/memory-loss-repair.test.mjs` 里加改名接线用例。

### H4（次要，文档）`restoredEntries` 的「always smaller than removedEntries」断言在修复后不成立

- 位置：`src/project-memory/consolidate.ts:153-158`（`ConsolidationOutcome.restoredEntries` 注释）。
- 触发现场：`removedEntries` 现在读**修复后**的 `current`（`consolidate.ts:1170`），与 `restoredEntries` 是互斥集合；`restored > removed`（如 5 / 0）完全可能，注释里的「差值是修复没能带回的部分」不再可推。
- 建议改法：改成「restored 是回填的条目，removed 是回填后仍缺失的条目；两者不相交」；`index.ts:231-235` 同句一并核对。

### H5（次要，边界）partial-stamp 时回填条目的 id 进不了 `keepIds`，侧车年龄会被剪掉

- 位置：`src/project-memory/consolidate.ts:1156-1160`（`entryTid(entry)` 取的是 `before` 行的 id）；`before` 来自 `plan.sections`，而 `retireWithinBudget` 在 id 税放不下时会用 `stampFirst` / `stripEntryIds` 把部分条目的 id 去掉（`retirement.ts:700+`）。
- 触发现场：计划 partial-stamp 时，`before` 里该条目没有 id，`entryTid` 返回 `undefined`，回填行也不带 id；`retirement.ids = applied.keepIds`（`consolidate.ts:1240` 附近）不含它，`recordEntryDates(..., keep)` 会把它的日期剪掉。下一 pass 会用同一内容重新派生同一 id 并记成「今天」，重置年龄时钟——正是规格 §11.5 想避免的。
- 已证明的前置条件（实跑）：80 条、cap 5270 时 `retireWithinBudget` 进入 partial-stamp（2/80 带 id），未盖章条目的 `entryTid === undefined`，而该计划的 `keepIds` 仍保留 80 个 id。
- 说明：未端到端复现「计划 partial-stamp + 修复成功」的组合（该场景通常被 `no-room` 挡住，只有回复大幅缩短腾出空间时才可能），判据来自代码与前置条件实跑。
- 建议改法：回填条目 id 时回退到 `plan.keepIds`（按 `comparable` 文本匹配 `plan.sections` 的盖章视图），或让 `repairLostEntries` 支持传入「旧文档 id 映射」。

### H6（次要，文档）`declaredSuperseded` 与 `retirement.ts` 的 `supersededIds` 规则漂移

- 位置：`src/project-memory/lost-entry-repair.ts:67-82` 自建正则 `/supersedes:\s*([0-9a-f]{3,4})/g`，只认 ASCII 冒号；`retirement.ts:56` 的 `SUPERSEDES_MARKER` 还认 `取代` 与全角 `：`，并在 `:411` 把四位目标解析成三位。
- 实跑（纯函数）：`supersedes：1ab`（全角）、`取代：1ab` 两种声明都被判成丢失并回填；四位旧 id 目标同理。
- 建议改法：并入 H1 的修法——复用 `supersededIds`，不要再造第二条规则（本仓库记忆里已有「一个判定只有一个所有者」的约束）。

## 二、规格未定的取舍

1. **改名/翻译式替换是否回填**（H3 的另一面）：若 lead 认为「宁可回填旧事实也不要静默丢失」，则需要把规格 §11.2 与模块注释里「改写至少保留一个字面量」改成承认该残余，并接受落地文档出现新旧两名并存；若不接受，就要加判别器。二者都需要拍板，不是单方面改代码。
2. **`no-room` 的判定把「回复自身已有的 per-item 截断」也算进来**（`lost-entry-repair.ts:127-130`）：一个与丢失无关的截断（tier C 不拒绝、只报告的那种）会让所有回填整体放弃并报 `Not restored`，即使被丢的条目本可放下。规格 §11.4 明确这么写，故按取舍记录，不算缺陷。
3. **回填条目在段落内追加到末尾**：会改变条目顺序（`repairLostEntries` 的 `sections[section] = [...sections[section], ...restored]`），从而影响 `stampFirst` 的优先级与打包。是否应保持原位置（`before` 的索引）未定；当前行为是确定的、可复现的。
4. **`plan.sections` 里带 `supersedes:` 标记的旧行会被原样回填**：`retireWithinBudget` 不剥标记（只有 `retireReply` 剥）。实跑：计划 sections 里仍保留 ``new `gamma` replaces old（9ff）supersedes:1ab``；若该行被判丢失并回填，标记会第一次落到 `MEMORY.md` 上（正常写路径不会）。触发需要仓库外手改过的文档，属边界；修 H1 时顺手决定是否在回填时剥标记。

## 三、已验证无问题（实际跑过的命令与结果）

- `node --test test/memory-loss-repair.test.mjs` → `tests 13 / pass 13 / fail 0`，exit 0（任务描述写「11 个用例」，实际 13 个；changelog 的 785 与全量一致，见下）。
- `node --test 'test/**/*.test.mjs'` → `tests 785 / pass 785 / fail 0`，exit 0（等价于 `pnpm test` 的 runner 段，未跑 `tsc` 前缀；未触发 `pnpm build`）。
- `pnpm typecheck` → exit 0（host + client 两半 `--noEmit`）。
- **修复被 tier C / partial / 空回复挡住**：`consolidate.ts:1147` 的 `if (!memoryLossyRefused)` 与上方 `semanticEmpty`/`partialRefused` 分支保证拒绝时根本不调用修复；状态 `lossy-refused` / `partial-refused` / `semantically empty` 不会被回填改写。
- **修复后不会新增拒绝**：`repairLostEntries` 只在 `sectionDropped/droppedItems/itemTruncated` 全 0 且解析往返通过时返回 `restored`（`lost-entry-repair.ts:126-136`），`memoryLoss` 重算后 `writeCapDroppedChars` 必为 0，`memoryLossyRefused` 不可能在修复后翻 true；`semanticEmpty` 无需重算（修复只增条目，且为 true 时不会进修复分支）。
- **`unmergeable-partial` 状态不被弄脏**：`partialRefused` 时修复被跳过（同上）。
- **回执门控正确**：`Restored`/`Not restored` 只在 `wroteMemory` 时进入报告（`index.ts:488-489`）；basis-key 被拒的实跑回执是 `Memory: was not rewritten …`，未出现 `Restored`。
- **`lastOutcome` 重放安全**：被节流/去重时 `consolidateProjectState` 返回缓存 outcome，`consolidateProject` 走 `cleanReport("deduped")`（`index.ts:639`），缓存里的 `restoredEntries` 不会进入任何声称落盘的回执。
- **plan 退休的旧条目不会被复活**：`before = plan?.sections` 是退休后视图；实跑（纯函数 + 计划）：存储文档自带 `supersedes:1ab` 时计划退休 `old alpha`，`lostEntries(plan.sections, empty)` 的结果里没有 `old alpha`。
- **正常盖章路径的年龄保留**：预置 `entries.json` 为 `{"1ab":"2020-01-01"}` 跑一次回填 pass，落地后 `1ab` 仍是 `2020-01-01`（`keepIds` 补充生效），`2cd` 也未被误剪。
- **各合法改写形态的判别（纯函数实跑）**：拆成两条（保留字面量）→ 不回填；两条并一条（保留字面量）→ 不回填；整条移入别的段落、移入 Project/Index、搬进另一条目正文 → 都不回填；无字面量条目 → 从不回填；`Project`/`Index` → 从不回填。
- **确定性与量级**：同一输入两次 `lostEntries` 结果字节相同；真实 `MEMORY.md`（37,162 字符 / 96 Invariants + 68 Pitfalls）全丢的最坏情形 `lostEntries` 45.5 ms、`repairLostEntries` 40.7 ms（cap 52,000），按 200,000 上限线性外推约 0.25 s——对一次模型 pass 可忽略，**不需要缓存**；`literalSurvives` 每次重抽整篇字面量集合是 O(条目×字面量×文档)，若将来要优化，把 `backtickedLiterals(text)`/`outsideBackticks(text)` 提到 `lostEntries` 里算一次即可（只判断，未改）。
- **测试覆盖缺口（H1-H5 的测试面）**：
  - 纯函数用例 `an entry the reply declares superseded is a replacement, not a loss` 钉的是 `after` 里带 `supersedes:` 标记的形态，而 `retireReply` 永远先剥掉标记（`retirement.ts:498-499`）——**该分支在真实链路上不可达**；「supersedes 失效」这个变异只被这条不可达形态打红，变异证据因此给了假信心。
  - `no-room` 只覆盖「渲染丢条目」这一条返回；`landed === undefined`（`lost-entry-repair.ts:132`）与 `missing.length > 0`（`:136`）无覆盖。
  - `keepIds` 补充只有「回填行保留 id」的纯函数断言，没有任何侧车日期断言（H5 因此漏网）。
  - `unrestoredEntries` 只测了回执字符串，没有「no-room → `errors.log` 一行」的接线用例；`restored` 行的写盘门控也没有用例（H2 因此漏网）。
  - 四位旧 id 的 `supersedes` 解析、全角/`取代` 声明无覆盖（H6）。
  - `removedEntries` 现在读修复后文档，没有断言 `restored + removed` 的关系。
  - 少数用例是控制组（`an untouched document loses nothing`、`Project and Index are never restored`），不算同义反复，但「合并」用例实际只验字面量存活，命名略宽。

## 四、证据文件路径

- `.agents/evidence/2026-11-21-batch-ac-review/finding.md`（本文件；含全部 file:line、复现步骤与实跑输出摘录）
- 一次性探针脚本位于 `/tmp/ac-probe/`（`pure.mjs`、`wired.mjs`、`supersede-echo.mjs`、`rename.mjs`、`plan-and-partial.mjs`、`perf.mjs`、`full-test.log`），评审结束即删；关键片段已内联在上文。
