# 批次 Q：回复只有带上本扩展的文档形状，才算是一份 memory（第九次 pi triage）

日期：2026-10-11　状态：**已落地（`src/` 行为变了，需宿主重启才在线）**
来源：pi `origin/master` = `d25ecab` 的 route B（`extensions/project-context/memory/sections.ts:428`
`hasMemoryDocumentShape` + `memory/pass.ts:316-342` 的门），triage 记录见
[`docs/upstream-pi-triage.md`](upstream-pi-triage.md) 的「Batch Q」。

## 1. 缺陷（opaque 路径只有一个单边的守卫）

dsh 的 opaque 路径把模型回复**原文**发布成 `MEMORY.md`，唯一的守卫是「文档是不是只剩标题」。
追一遍调用链：

`src/shared/reply-json.ts:116` `if (!looksLikeJsonReply(text)) return { memory: text };`
→ `consolidate.ts` 的 `resolveReply` 走 `fallback-opaque`（`sectionsFromMarkdown` 读不出四段就退回原文）
→ 门 `replyIsSemanticallyEmpty` 在 opaque 分支上只问 `isHeadingOnlyDocument`
→ `index.ts:198` 只要变化 ≥ 40 字符就写。

而 `isHeadingOnlyDocument`（`sections.ts`）**故意是单边的**：任何一行只要去掉装饰后还含字母或数字
就算内容（`CONTENT_RE = /[\p{L}\p{N}]/u`），因为「另一个答案是把模型真的写下的一份 memory 拒之门外」。
于是**一条带着规范标题的寒暄**就能整体替换掉已存的 memory：

```
# Project Memory

I'll review the frozen revision and record the durable lessons now.
```

`isHeadingOnlyDocument` 对它返回 `false`（那行有词），`sectionsFromMarkdown` 对它返回 `undefined`
（没有 `## <section>`），所以它落进 opaque 的一半、**通过**门、被写入。这是 pi v0.4.7 的现场事故形状。
入库探针（驱动构建后的 `lib/`，只写 `$TMPDIR`）修复前 `exit 10`：
`.agents/evidence/2026-10-10-opaque-reply-acceptance/probe.mjs`。

另外逻辑上 tier C 在这里从不介入：opaque 回复没有 sections，`writeCapDroppedChars` 是 0，
所以既没有重试也没有拒绝——整条替换**静默**发生。

## 2. 机制

两侧各加一条半，合起来就是 pi 的 route B：

- **回复侧**（`src/project-memory/sections.ts`，新 `hasMemoryDocumentShape`）：回复只有在**第 0 列的
  已知 `## <section>` 标题下**、**第 0 列有一条 `- ` 条目**时才算一份文档，围栏（fence）之外才算。
  只解析 `## <known section>`：别的标题层级、setext / HTML 标题、`*`、编号、缩进条目、prose、
  有标题没条目都不算——因为这些形状**本扩展自己从不写**。四段的一个子集是合法的部分文档
  （`## Project\n- x` 通过，但仍走 opaque，逐字保存而不是被渲染成四段）。
- **存储侧**（`src/project-memory/consolidate.ts`，新 `storedIsDocument`）：只有当**已存的 memory 本身
  值得保护**时才拒绝——`sectionsFromMarkdown(text) !== undefined`，或去掉开头的 `# Project Memory`
  标题后还剩 ≥ 40 字符。空项目、只剩标题的 store 什么都没得保护，所以一条短回复仍然照旧走
  「太短不算变化」那条既有路径（`index.ts` 的长度下限），而不是被这里拒掉。
- 合成 `isConversationalOpaque(reply, storedText)`：`!hasMemoryDocumentShape(reply)` 且
  `reply.trim().length >= OPAQUE_DOCUMENT_MIN_CHARS` 且 `storedIsDocument(storedText)`。
  门于是变成 `isHeadingOnlyDocument(reply) || isConversationalOpaque(...)`，只在 opaque 分支生效；
  sectioned 分支一字未动。

配套的两处「一个事实一个所有者」：

- `readFenceLine` / `fenceCloses`（`FenceToken`）从 `isHeadingOnlyDocument` 里**抽出来**，
  两个读者共用同一个围栏规则。此前这条规则写在该函数体内；再手写一份给形状门就是「近似副本」，
  正是本仓库登记过的残留类。抽出是行为等价的（`isHeadingOnlyDocument` 的断言未改一字）。
- `SECTION_KEY_BY_HEADING` 提升成模块常量（`sectionsFromMarkdown` 原先每次调用现建一个
  `headingByLower`），两个读者共用「哪些标题是我们的」。行为等价。
- `OPAQUE_DOCUMENT_MIN_CHARS = 40` 导出自 `sections.ts`，`index.ts` 的长度下限改为读它；
  此前那个 40 只以字面量写在 `index.ts`，现在「小得不像 memory」是一个数。

诊断串同轮改名（这是**必须**的，不是文案偏好）：`consolidate.ts` 末尾那句原为
`the consolidation reply carried no entries; the stored memory was kept unchanged`，而 route B 之后
被拒的这一类**包含「prose + 一条 bullet」——它带着条目**，旧措辞当场变成假话。现为
`the consolidation reply was not a writable memory document; the stored memory was kept unchanged`，
并由新用例按字段串钉住。

## 3. 与 pi 的差异（有意）

- **只保留 route B 的最终形状，不端口中间档。** pi 的 v0.4.7/v0.4.8 走过「无标题就拒」→
  「正文里有任何标题/项目符号/围栏就收」，两档都被 route B 取代（pi 自己的 changelog 记第二档
  仍然 fail-open）；rounds 18–21 的手写 markdown 子集则在四轮复核里各开出一个 fail-open。
  本批只落 schema 本身。
- **一处 dsh 独有的等价性**：dsh 的 `HEADING_RE`（`/^##\s+(.+)$/`）与 `SECTION_KEY_BY_HEADING`
  与 pi 同名同形，但 dsh 的 `sectionsFromMarkdown` 用的是**每次现建**的局部 map——本批把它提升为共享常量，
  pi 那边本来就是模块级。这是重构而不是语义差异。
- dsh 不引入 `droppedSamples` 之类的回执细节，也不改配置键、不加依赖。

## 4. 改动面

- `src/project-memory/sections.ts`：`FenceToken` / `readFenceLine` / `fenceCloses`（抽出）、
  `SECTION_KEY_BY_HEADING`（提升）、`OPAQUE_DOCUMENT_MIN_CHARS`、`endsSectionScope`、
  `stripListMarkers`、`hasMemoryDocumentShape`；`HEADER_RE`/`HEADING_RE` 上移到 `ATX_HEADING_RE` 旁；
  `isHeadingOnlyDocument` 与 `sectionsFromMarkdown` 改用共享件；更新了 `isHeadingOnlyDocument`
  文档注释里那句「those boundaries are recorded rather than closed」——注释现在指向形状门。
- `src/project-memory/consolidate.ts`：`storedIsDocument`、`isConversationalOpaque`、
  `replyIsSemanticallyEmpty(resolved, render, storedText)`（三个调用点都传 `existing.text`）、
  诊断串改名。
- `src/project-memory/index.ts`：长度下限读 `OPAQUE_DOCUMENT_MIN_CHARS`（注释同轮更新）。
- `test/sections.test.mjs`：新增形状表用例；在 `isHeadingOnlyDocument` 的边界断言旁补一条
  「同一个 wrapper 通不过形状门」。
- `test/logic.test.mjs`：新增端到端用例「a conversational reply cannot replace a stored memory」
  （两条被拒形状 + 落地对照 + store 低于下限的边界）；改诊断断言；两条读上限夹具的回复改成带形状。
- `test/external-edit.test.mjs`：`REPLY_MEMORY` 夹具带上形状（理由写进注释）。
- `lib/`：随构建产物提交。

## 5. 验证（**数字会过期，跑命令而不是引用它们**）

- `pnpm typecheck` 0；`pnpm build` 0（`built ./lib/client.js (28575 bytes)`）。
- `pnpm test` **430 通过 / 0 失败**（本批前 428，新增 2 条具名用例）。
- `lib/` 与新鲜 `node_modules/.bin/tsc --outDir $TMP` 编译 `diff -rq` 只剩 `client.js`。
- 判别器：`node .agents/evidence/2026-10-10-opaque-reply-acceptance/probe.mjs` → 修复前 **exit 10
  （DEFECT PRESENT）**，现在 **exit 0（DEFECT CLOSED）**，第 3 节两条被拒回复
  `memoryWritten=false` / `stored byte-identical=true`、裸骨架仍被拒。README 里两份预期输出都留档。
- **6 个变异体全部被杀**，每个都 `tsc` 0 错、标记进 `lib/` 已核对、恢复后 `sha256sum -c` 全通过、
  重建后 `lib/` 0 标记：
  ① `has/() || true`（任何 `## 标题` 都算我们的）→ 打红形状表用例；
  ② 去掉 `endsSectionScope` 的 `underKnownHeading = false` 复位 → 打红形状表用例；
  ③ 条目判据 `&&` 改 `||`（第 0 列任何 `- ` 都算）→ 打红形状表用例 + `isHeadingOnlyDocument` 边界那条；
  ④ 围栏状态不记录（`if (fence) continue;`）→ 打红形状表用例（`## Project` 在围栏里也成立）；
  ⑤ `storedIsDocument` 恒真 → 打红新端到端用例的「store 低于下限」断言，另打红 3 条上限用例；
  ⑥ 诊断串改回旧措辞 → 打红新端到端用例 + 骨架用例（后者正是按新字段串钉的）。
- **一处自查陷阱（值得记下来）**：第一轮 4 个变异体的标记核对全部报 0，看起来像「变异体没进 `lib/`」。
  实际是 `tsc` 用**空格**缩进而我的 `grep -F` 传的是**制表符**，且多行标记根本不能喂给按行匹配的
  `grep`。逐条核对时改用不带前导空白的片段后全部命中——**标记核对失败不等于变异体无效**。

## 6. 边界与残留（**不要读成已修**）

- **有意多拒的一类（这就是代价）**：一份**自由格式**（标题 + 第 0 列 bullet，没有任何 `## <section>`）
  的旧 memory，被模型用**同样的自由格式**改写时会被拒——`storedIsDocument` 为真（正文 ≥ 40 字符），
  而回复没有本扩展的形状。结果是这份 memory 保持逐字节不变、每个 pass 记一条诊断，
  但**在模型交出一份规范四段文档之前不会更新**。pi 的裁决是接受它（「宁可拒绝一份模型确实写了但
  本扩展读不懂的 memory，也不接受一次静默的整份替换」）；本批跟随。dsh 的提示词（`memorySectionRule`
  + `MEMORY_SURVIVAL_CAPTION`）本来就要求四段，所以这是「模型没照 schema 写」的可见后果而不是常态。
  已把这条写进 `isConversationalOpaque` 附近的注释，并由新用例的对照钉住「带形状的回复照常落地」。
  这一步是**响的**，实测（入库探针 `.agents/evidence/2026-10-10-opaque-reply-acceptance/receipt-probe.mjs`，
  只写 `$TMPDIR`）：自由格式 store + 自由格式改写 ⇒ `status=updated` / `memoryWritten=false` /
  `contextWritten=true`，回执为 `Memory: updated CONTEXT.md.`——它**只**点已经落地的文件，没有冒领
  memory 写入（与既有的「低于下限」「只剩标题」两条同一条既有约定，`test/logic.test.mjs` 的 floor
  用例正是这么钉的），同时 `errors.log` 多出一条新措辞的诊断；磁盘逐字节不变。
- **保留的 fail-open（有意，已被用例钉住）**：section 的作用域只被 ATX 标题、setext 下划线、
  HTML 块起始结束；**prose 不结束它**。所以 `## Project\nsome prose\n- a` 仍然通过形状门
  （条目真的挂在第 0 列、标题真的是我们的）。测试里以「prose between the heading and a later entry」
  的名称钉住，免得被当成 bug 顺手「修」成一个新的 fail-open。
- **继承 pi 的第二处 fail-open（本批未关）**：`endsSectionScope` 只对**以 `<` 开头的那一行**复位
  `underKnownHeading`，并**不**进入「HTML 块会吞掉后续行」的状态，所以
  `hasMemoryDocumentShape("<div>\n## Project\n- a\n</div>")` 为真，端到端一条 81 字符的 `<div>` 包裹回复
  也会落地并整体替换 store。与 pi `origin/master` **逐字节同实现**（只差注释），是 route B 自带、
  不是本批引入；真要关它需要与 pi 同轮补一个多行 HTML 块状态机，不属本批。
- **本批**真正的承载性残留：**门是「至少一个 section」，不是完整性检查**。回复
  `## Project\n- <够长的一条>` 通过形状门（`sectionsFromMarkdown` 读不出四段 ⇒ 走 opaque 逐字落地），
  于是**已存的 Invariants / Pitfalls / Index 三段会连带消失**，而且这条路径**没有任何守卫、也没有诊断**
  ——dsh 根本没有 pi 的 `RemovedEntries` 回归守卫（`git grep -n 'removedSectionEntries\|RemovedEntries' -- src/` 为 0），
  而 pi 的守卫在「本轮没有产出 sections」时明确**跳过并只记一行**
  （`memory regression guard skipped: this pass did not produce sections`），所以 pi 也一样。
  也就是说：Q 关掉了「一段 section 都不带」的门，**「只带一段」的门仍然开着**。这与本批要修的缺陷
  （静默整份替换）是同一个损失类，属**下一个该做的批次**（补一个「回复不得丢掉 store 里已有的段」的守卫），
  本批不顺手做——它需要先定义「合法的部分文档」到底还算不算合法，而 route B 明确把它算合法。
- **`storedIsDocument` 的口径**：读的是 `existing.text`（**经过 `loadMemory` 上限裁剪后的**文本）而不是
  磁盘原文。这对「有没有东西可保护」够用：被裁剪只可能让 store **更短**，而判据是「能不能解析成四段
  或正文够长」。标题剥离用 `/^\s*#\s*Project Memory[ \t]*(?:\r?\n|$)/i`（与 `reply-json`/
  `sectionsFromMarkdown` 的 `HEADER_RE` 同源，但按**整篇文本**剥一次而不是按行）。
  另外：能解析成四段的文档字节下限约 63（光四个标题就 > 40），所以「四段文档却 < 40」不可达；
  `maxMemoryChars` 的下界是 `MIN_MEMORY_CHARS = 4000`，所以「cap 太小把 store 判成非文档」也不可达。
- **与 tier C 的分界由 store 决定，两端都被用例钉住**：`an over-cap opaque reply is refused instead of
  landing a capped document` 是绿的，因为它的夹具 store 是 `# Project Memory\n\n## Project\n- original\n`
  ——`storedIsDocument` 的**两项同时为假**（解析不出四段；剥标题后 **21** 字符 < 40），回复于是落在
  tier C 的写上限路径上（`calls=2`、`status=lossy-refused`、`refusedLoss.writeCapDroppedChars>0`）。
  同一回复、同一 cap，把 store 换成成熟四段文档就改成由**形状门**先拦下（`calls=1`、`status=updated`、
  `refusedLoss=undefined`、store 逐字节不变）——新端到端用例把这一对作为对照钉住，免得将来只按
  「store 低于下限」一半去理解这条既有用例（那只是 `storedIsDocument` 两项同时为假的唯一组合，
  不是 over-cap opaque 回复的通用情形）。两条路径各自命名自己的原因，不会互相冒名：
  `if (semanticEmpty) memoryLossyRefused = false;` 保证形状门命中时绝不出 cap 文案。
- **没有现场频率**：缺陷由代码追踪 + 探针证明可达，但**没有 dsh 的现场事故记录**，实际频率未测。
- **批次 O 残留④（只由标题组成的 render 仍赢读取）本批不动，且判定它不需要动**：那是读侧的
  「最新者赢」契约（`externalRenderWins`），一份被手动清成只剩标题的 `MEMORY.md` 是**外部编辑**，
  赢下读取是 O 的既定语义；而 Q 的存储侧下限让这种 store 在**接受方向**上也无足轻重
  （`storedIsDocument("# Project Memory\n")` 为假，没有东西可被冒名替换）。要改它是改 O 的判据，
  会与 `cleared-render-probe.mjs` 的判定冲突，必须单独一轮，不能顺手并进来。
- **改了 `src/` 行为，需要宿主重启才在线**（判据照旧：19387 持有者启动晚于最后一个 `src/` 提交）。
  不改配置键、无新依赖、两个 profile 无需改动。

## 7. 下一批的入口

- **Q2（本批复核新开的、优先级最高）：「回复不得丢掉 store 里已有的段」的守卫。** 见 §6 那条承载性
  残留：`## Project\n- x` 这类**单段**回复通过形状门后逐字替换掉四段 store，三段静默消失且无诊断
  （dsh 根本没有 pi 的 `RemovedEntries` 回归守卫；pi 的守卫在「本轮没产出 sections」时也只记一行而跳过，
  所以 pi 同样开着这扇门）。动手前必须先给「合法的部分文档」定案——route B 明确把部分文档算合法，
  而这条守卫要拒的正是「部分文档丢掉既有段」，两者需要一起裁决；建议形状：当 `sectionsFromMarkdown(existing.text)`
  能解析时，把回复也解析成 sections（或至少要求回复的段名集合 ⊇ store 的段名集合）再决定要不要写。
- **R**：`099ebf3`（重试头寸：至少 +4096 **且**不少于上一轮真实花掉的隐藏思考，dsh 仍传平面
  `RETRY_OUTPUT_HEADROOM_TOKENS = 4096`，`consolidate.ts` 只在错误文案里用了
  `attempt.reasoningTokens`）可直接做；等待提示半边（`068b7e8` + `5783610`）**先探** dsh 的命令面能否在
  await 之前插一句话（`src/project-memory/index.ts:439-440`、`src/project-autolearn/index.ts:101`），
  探不到就只记残留。两半的出处与 pi-only 清单见 triage 的「Batch R」。
- **P**：证据已回，判定 **NOT REACHABLE**（dsh 在 `agent/disposed` 上两层独立抑制异常），
  代价确定；等用户裁决，见 `.agents/evidence/2026-10-10-batchP-dispose-escape/`。
