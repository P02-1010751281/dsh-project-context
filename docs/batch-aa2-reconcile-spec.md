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

### AA2b — 提示词提示（**动稳定面，待裁定**）

`promptFor(input, extra)` 已有 `extra` 槽（`consolidate.ts:812-822`），在 `MEMORY_SURVIVAL_CAPTION` 之前插入一段条件提示，仅当**存在过期依据**且（文档 ≥ 阶梯触发 **或** 本次是 reconcile pass）时出现。

文案按**依据**写，不按「文件改了」写，这样新依据进来时提示词不用改：

```
以下条目有过期依据（<理由>: <tid> → <对象>, …）。
如果下面的对话说明了它们已经变化，就更新该条目；否则原样保留。
不得为它发明路径，也不得删除仍然成立的条目。
```

约束：最多点名 N 条（建议 10），超出只报计数；文案不得要求模型读文件（pass 读不了文件）；理由词表见 §10。

**为什么不只写「文件改了」**：这是本轮被指出的窄化——见 §10 的五种依据，文件指纹只是其中最弱的一种。

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
- **读帽一旦截断文档，`/memory reconcile` 拒绝判定**（`unknown` + `hid N characters`）：一个被切掉尾巴的文档
  不是可解析的四节文档，所以它不假装扫过。杠杆是 `maxMemoryChars`（当前 52,000，文档 51,996，只差 4 个字符）。
  这是 fail-closed，不是缺陷；但 memory 一长，reconcile 会先于其它一切失效。

## 9. 待裁定

1. **AA2b 的提示词提示**：按 §4 的理由化文案与触发（有依据且「≥85% 或 reconcile」）落地？推荐**是**——它是过期事实唯一能被自动修正的路径，文案已避开「读文件」与「发明路径」两个坑。
2. **`--accept` 再基线**：作为本批的一部分（§3 第 3 条：没有它，`stale N` 单调递增、通道不可关闭）？推荐**是**。
3. **拆分与顺序**：AA2a + AA2c 先落地（prompt 无关，可独立验收），AA2b 在裁定 1 之后单独提交？推荐**是**。

## 10. 「过期依据」不止一种（2026-11-21 补，回应「引用的文件被改过 不止吧」）

「文件指纹变了」只是可机械判定的依据里**最弱**的一种，而且它不是「事实失效」的同义词（§1 的精度 1/6）。
把可想到的依据分成三类，比把它们混成一个「漂移」更清楚：

| 依据 | 判定 | 现在 | 2026-11-21 现场 |
|---|---|---|---|
| `superseded` | 新条目显式 `supersedes:<id>` | 已进状态机，**会退役** | — |
| `anchor-drift` | 引用路径不存在 / 行号越过文件尾 | 已进状态机，**会退役** | 0 |
| `age-unconfirmed` | 超 180 天且归档会话未再提及（扫描完整才判） | 已进状态机，**会退役** | 未测 |
| `content-stale` | 引用文件指纹变了 | 已进状态机，**只标**；AA2a/AA2c 给它出口 | 6 / 25 有绑定 |
| `task-closed` | 条目引用的 `tasks/<slug>.md` 派生状态已是 `archived` | **没有**。`.agents/memory/` 被刻意排除在绑定之外（`staleness-source.ts:34`、`:63`），否则每次 todo 写入都会把条目判脏 | 机制盲区（今天没有条目引用具体任务文件） |
| `version-shipped` | 条目说某事「在 `未发布` 里 / 待 vX」，而该内容已进 `docs/changelog/v<版本>.md` | **没有**，但可纯函数判定 | 3 条提到 `未发布`；其中 `391`（「Z8f 只在 未发布 里」）今天核对**仍成立**（`CHANGELOG.md:238`，8 个已发布分节都无 Z8f） |
| `open-state` | 条目断言「尚未 / 待定 / 待拍板」，而任务其实已经完成 | **不可机械判定**，且**不得**做成词表探测器 | — |

**两类的分界**：前三类 + `task-closed` + `version-shipped` 是「磁盘能反驳的事实」，可以做状态、可以进提示词；
`open-state` 是「意图」，只有**会话**（提示词让模型看对话）或**显式声明**（`--accept` / `supersedes`）能翻它。
把「尚未 / 待定」做成词表探测器，正是本仓库已记录的那类失败（启发式措辞分类器不收敛，只会拿一类错误换
另一类），所以它**不做**。

**「任务完成了」通常落在 `open-state`**：条目说的是「待决定 A/B/C」，而决定在三轮前就做了。这类没有可信的
机械判据——任务文件归档只是其中一种情形，且今天 MEMORY 里没有条目引用具体任务文件（`tasks/z8-acceptance.md`
存在，但没有条目点名它）。所以这一类的出口是提示词 + 会话，不是新的探测器。

## 11. 落地状态（2026-11-21）

- **AA2a + AA2c 已落地**：`29e8f90`。`staleness.ts` 的 `judgeEntries` 单一判定 +
  `staleEntriesOf`（逐条 + 已改路径）；`staleness-source.ts` 的 `measureStalenessDetail` +
  `acceptStaleness`（三种具名拒绝 + 比较并交换）；`/memory reconcile` 与 `--accept <id>`；并修掉
  `bindAndMeasure` 的合并丢更新（只写此前没有基线的 tid）。11 条测试、5 个变异全部具名打红，
  `pnpm test` **745/745**。
- **AA2b 未做**：提示词属稳定面，等「依据词表要不要现在扩到 `task-closed` / `version-shipped`」这条裁定
  ——它们决定提示词要能说出几种理由。
- **AA2d / AA2e（未排序）**：`task-closed` 与 `version-shipped` 两个新依据，各自是纯函数 + 一条测试；
  它们进 hint 的理由词表，不新增删除权。

## 12. 状态机（最终形状，2026-11-21 第三轮）

用户的裁定把这一批从「过期理由清单」纠正成「状态判定 + 转移」。§4 的 `ExpiryFinding` 清单是错形状——
它在 `entryStateOf` 之外又开了一套词汇，正是 §2 G2 原样复发。并回去之后的形状：

### 12.1 七个状态，一个裁定者

```
superseded → anchor-drift → task-closed → version-shipped → age-unconfirmed → content-stale → healthy
```

优先级 = 「越确定越先」。`entryStateOf(tid, facts)` 是唯一裁定者；`facts` 有五类来源，各由自己的
模块产出，裁定者不探测任何东西：

| 事实 | 产出者 | 来源 |
|---|---|---|
| `superseded` | `supersededIds`（`retirement.ts`） | 文档内的 `supersedes:<id>` 声明 |
| `drifted` | `anchorDriftReasons`（`retirement.ts`） | 文件系统：路径/行锚是否存在 |
| `taskClosed` | `expiry.ts` 纯规则 + `expiry-source.ts` 读盘 | `.agents/memory/tasks/<slug>.md` 的派生状态 = `archived` |
| `shipped` | 同上 | 条目含「未发布」+ 批号标记，且该标记出现在 `docs/changelog/v*.md` |
| `unconfirmed` | `scanMentions`（`retirement.ts`） | 归档会话的提及扫描（只在扫描完整时成立） |
| `stale` | `measureStalenessDetail`（`staleness-source.ts`） | 源绑定指纹 |

### 12.2 谁能点转移

| 转移 | 谁点 | 守卫 | 回执 |
|---|---|---|---|
| → `superseded` | 模型写声明 | 目标 id 可解析 | tombstone |
| → `anchor-drift` | 退役 pass | 路径/行锚不存在 | tombstone |
| → `age-unconfirmed` | 退役 pass | 过期 + 扫描完整 + 未提及 | tombstone |
| → `task-closed` / `version-shipped` / `content-stale` | **无事件**：三种状态由外部事实被动成立 | 见 12.1 | `/memory reconcile` |
| `task-closed` / `version-shipped` → `healthy` | 人：`--accept <id>` | 裁定结果必须是该状态 | 记 `confirmed`（按理由分键） |
| `content-stale` → `healthy` | 人：`--accept <id>` | 同上 | 刷新指纹基线 |
| `*` → 改写正文 | **系统**：整理 pass（AA2b） | 文档 ≥85% 且对话说明了改动 | 明令不得发明路径/不得删仍成立的事实 |
| `*` → 移出文档 | 退役引擎 | `retiresEntry(state)` | tombstone |

### 12.3 两条约束

1. **一个判定只能有一个所有者**：回执、`--accept`、整理 pass 都读 `memoryEntryStates`，不得各自重算。
2. **每个状态必须有可达出口**：`task-closed` / `version-shipped` / `content-stale` 都有出口；
   `open-state`（说「待定」而事情已定）**没有可信的机械判定**，所以不做探测器，出口只有会话与显式确认。

### 12.4 落地状态

- **AA2a + AA2c**（`29e8f90`）：逐条视图、`--accept` 再基线、合并丢更新修复。
- **AA2d + AA2e + AA2b**：七态裁定者、两个新事实源、侧车 v3 的 `confirmed`、整理 pass 的过期提示。
  14 条测试、6 个变异全部具名打红，`pnpm test` **749/749**。
- **残余**：`confirmed` 是本地侧车；`version-shipped` 依赖条目自己写批号；`open-state` 不做探测器。
