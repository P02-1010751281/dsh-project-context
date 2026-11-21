# Batch AA2 规格：内容漂移的两条通道

> 事实快照：2026-11-21T18:20+08:00。计数为当天实测，引用前现跑探针（见 §1）。
> 上游：`docs/batch-aa-state-machines-spec.md`（§2 G1、§3 AA2、§7 裁定 2、§11 裁定 1）。

## 1. 现场测量（先量再设计）

探针：`.agents/evidence/2026-11-21-batch-aa2-staleness/probe.mjs`（输出同目录 `output.txt`），直接 import 构建后的 `lib/`，对真实 `.agents/memory/` 读取。

| 口径 | 实测（2026-11-21T18:18+08:00） |
|---|---|
| `MEMORY.md` | **51,996 字符 / 52,000 上限（99.99%）** |
| 条目总数 | 152 |
| 有文件绑定的条目 | **25**（16%） |
| 内容漂移（`stale`） | **6** |
| 文件消失 / 不可读 | 0 / 0 |

6 条漂移条目与它们引用的文件：

| tid | 引用文件 | 条目要旨 | 判断 |
|---|---|---|---|
| `ef8` | `src/project-memory/retirement.ts` | Z2 退役/标记通道的函数清单 | **需要改写**：AA1a 让它改为向 `entryStateOf` 提问，清单已不完整 |
| `dc5` | `src/shared/model-call.ts` | `auxiliaryReasoningEffort` 的机制 | 仍成立，文件被自身落地改过 |
| `af0` | `src/project-handoff/perform.ts` | 不要拆 `performHandoff` | 仍成立 |
| `b5b` | `docs/README.md` | README/CHANGELOG 的分工 | 仍成立 |
| `bde` | `test/logic.test.mjs` | Z8d 的比较口径 | 仍成立，测试只是被追加 |
| `0ac` | `docs/memory-rewrite-loss-gate-spec.md` | tier C 只数结构性损失 | 仍成立 |

**精度 1/6**：六条里只有 `ef8` 真的因为代码改构而失真。这就是为什么不能自动退役——按「引用的文件变了 ⇒ 事实不成立」去删，会删掉五条仍成立的事实。

## 2. 「自动维护」这一半已经存在，不要重做

| 项 | 位置 | 现状 |
|---|---|---|
| 保留阶梯 | `consolidate.ts:347` `MEMORY_RETENTION_LADDER` | 顺序 = 合并真重复 → 把程序折叠成它**已经点名**的指针 → 只删被取代的条目 |
| 触发 | `consolidate.ts:335` `MEMORY_RETENTION_TRIGGER_SHARE = 0.85` | 文档 ≥85% 才拼进提示词（当前 99.99% ⇒ **每次 pass 都带**） |
| 边界 | 同上注释 | 明令「绝不为了腾地方缩短仍成立条目的措辞」 |

裁定 2 要求的「≥90% 时重述/指针化、绝不删仍成立的事实」**已经被 85% 的阶梯覆盖**，且更保守。AA2 若重写一遍，只会得到第二套措辞。

## 3. 真正的缺口（三条）

1. **阶梯看不见漂移。** 它只知道字符占用，不知道哪条条目引用的文件变了。于是 cap 压力下它可能把一条**新鲜**条目指针化，却留着一条**失真**的条目。
2. **pass 无法「重读文件」。** 整理 pass 不读文件（`consolidate.ts:337` 注释明说），它只有条目正文和会话。所以提示词能要求的只有「若**本次会话的对话**说明了改动，就更新这条；否则原样保留，不得发明路径」——这也解释了为什么漂移常常能被修：改动通常就发生在最近几轮对话里。
3. **漂移计数单调递增，没有出口。** 侧车的基线写一次就永不刷新（`staleness-source.ts:164-180`：正文不变 ⇒ 保留基线）。因此一条被确认「仍然成立」的条目会**永远**以 `stale` 出现；没有 `--accept` 之类的显式再基线，`stale N` 只会涨，回执终将变成噪声。**这是「通道」真正的用户面：让确认过的条目停止报警。**

## 4. 设计（拆成可独立验收的三条）

### AA2a — 纯原语（无行为变化，可先落地）

`src/project-memory/staleness.ts` 新增 `staleEntriesOf(sections, bindings, files): { tid: string; paths: readonly string[] }[]`，
`summariseStaleness` 改为复用它（`staleIds` 仍只取前 3，`MAX_NAMED_IDS` 不变 ⇒ 回执字节不变）。

理由：`StalenessFacts` 只带 3 个 id（`staleness.ts:60`），要「点名一条条目 + 它引用的文件」必须有逐条访问器。
验收：新用例覆盖「一条条目多个文件只算一次」「无绑定条目不出现在结果里」；既有 `summariseStaleness` 用例全绿。

### AA2b — 提示词提示（**动稳定面，需裁定 1**）

`promptFor(input, extra)` 已有 `extra` 槽（`consolidate.ts:812-822`），在 `MEMORY_SURVIVAL_CAPTION` 之前插入一段条件提示，仅当 `stale > 0` 且（文档 ≥ 阶梯触发 **或** 本次是 reconcile pass）时出现：

```
这些条目引用的文件在它们写定之后被改过（<tid> → <path>, …）。
如果下面的对话说明了改了什么，就更新该条目；否则原样保留。
不得为它发明路径，也不得删除仍然成立的条目。
```

约束：最多点名 N 条（建议 10），超出只报计数；文案不得要求模型读文件。

### AA2c — 显式命令（prompt 无关，可先落地）

`/memory` 现有四个动词（`index.ts:786-805`：status / update / prune / prune --apply），新增：

| 用法 | 行为 | 是否调模型 |
|---|---|---|
| `/memory reconcile` | 列出每条漂移条目 + 它引用的已改文件 | 否 |
| `/memory reconcile --apply` | 用 §AA2b 的提示跑一次强制 pass（走既有 tier C、整篇损失闸、写路径） | 是，1 次 |
| `/memory reconcile --accept <tid>` | 把该条目当前指纹写成新基线并记一行日志 | 否 |

`--accept` 的锁边界（已核）：`updateEntrySidecar` **自己**持 `withMemoryLock`（`entry-sidecar.ts:124`），所以命令不需要再包一层。
但存在一个真实的丢更新：`bindAndMeasure` 先读侧车、再把读到的旧基线并回去（`staleness-source.ts:170-176` + `:207-213`），
会覆盖并发写入的新基线。修法是一行收窄——合并时只写**此前没有基线**的 tid（那个分支本来就逐字节复制旧值，单写者下行为完全相同），
于是 `--accept` 不会被在飞的 pass 擦掉。这条必须进验收（并发用例），否则 `--accept` 是「看起来成功」。
`--accept` 还只接受**当前确实漂移**的 tid，否则报错而不是静默成功——一个没漂移的条目不该被「确认」。

## 5. 不做什么

- 不自动退役被漂移的条目（§1 的精度 1/6 就是理由）。
- 不为 reconcile 新建写路径或第二套损失闸：`--apply` 就是一次强制 pass。
- 不在 `/memory status` 里展开逐条漂移（那是 AA1b 的「子集」残留，单独排期）。
- 不改 `MAX_NAMED_IDS`：回执保持短。

## 6. 验收

| 项 | 判据 |
|---|---|
| 纯核心 | `staleEntriesOf` 用例：多文件、无绑定、孤儿绑定 |
| 回执 | `summariseStaleness` 输出在 AA2a 前后**逐字节相同**（现有用例即证） |
| 命令 | `/memory reconcile` 列出 6 条（当前现场）；`--accept ef8` 后该条消失、其余不动；再跑一次仍不出现 |
| 并发 | `--accept` 与 `bindAndMeasure` 同时跑时新基线存活（4 子进程 barrier 用例，照 `test/logic.test.mjs:399` 的形状） |
| 提示词 | `test/prompt-bounds.test.mjs` 的 85% 两侧用例继续绿；新增「stale=0 时提示词不含该段」 |
| 全量 | `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿，`git diff --exit-code -- lib` 为空 |

## 7. 变异（每条一个，打在消费点）

| 变异 | 必须打红的用例 |
|---|---|
| M1 `promptFor` 不接收 stale 段 | 命名用例「stale>0 的 pass 提示词点名该条目」 |
| M2 条件去掉「≥85% 或 reconcile」 | 「低占用且非 reconcile 的 pass 不带该段」 |
| M3 `--accept` 不校验 tid | 「接受不存在 / 未漂移的 tid 必须报错」 |
| M3b `bindAndMeasure` 继续覆盖已有基线 | 并发用例：`--accept` 与 pass 同时跑，基线不得被擦回旧值 |
| M4 `staleEntriesOf` 只返回第一个文件 | 「多文件条目点名全部已改文件」 |
| M5 `summariseStaleness` 改为返回全部 id | 回执用例（`stale 6` 不能变成逐条列出） |

## 8. 残余（写进 CHANGELOG，不假装已解）

- 提示词只能靠**会话**修漂移；改动发生在别的会话时，pass 无从得知，只能等用户 `/memory reconcile --accept` 或下一轮对话提到。
- 基线仍是 16 hex 指纹（变更检测，不是签名）。
- 侧车不可读时是命名缺席（`checked: false`），不能被读成「干净」。
- `/memory status` 仍只显示计数，不显示是哪几条（AA1b 残留）。

## 9. 待裁定

1. **AA2b 的提示词提示**：按 §4 的文案与触发（`stale>0` 且「≥85% 或 reconcile」）落地？推荐**是**——它是漂移唯一能被自动修正的路径，且文案已避开「读文件」与「发明路径」两个坑。
2. **`--accept` 再基线**：作为本批的一部分（§3 第 3 条：没有它，`stale N` 单调递增、通道不可关闭）？推荐**是**。
3. **拆分与顺序**：AA2a + AA2c 先落地（prompt 无关，可独立验收），AA2b 在裁定 1 之后单独提交？推荐**是**。
