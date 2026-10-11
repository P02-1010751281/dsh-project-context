# 批次 N：段配额降为目标值（第九次 pi triage）

日期：2026-10-10　状态：**已落地并推送**（`2462d59`，`4e0aa0f` 之上，`origin/main`）
来源：pi `e2184af` + `59a53a4`（pi `origin/master` = `d25ecab`），triage 记录见
[`docs/upstream-pi-triage.md`](upstream-pi-triage.md#L1210) 的「Batch N」。

## 1. 缺陷

`renderMemoryDocument` 把四条 share（dsh 已重平衡为 `0.17 / 0.45 / 0.29 / 0.09`）当作**每段硬上限**：
`if (spent + cost > budget.chars) { droppedItems += 1; continue; }`。于是

- 闲置段的余量**不能**补超额段的超支（本项目自己的 Pitfall 记的就是这一类损失）；
- `sectionDropped` / `droppedItems` 把这件事误报成「某段超预算」，而真正的原因是文档分配，不是模型；
- 有损写入的 `errors.log` 行与 `/memory update` 回执复述同一个错误归因。

现场量级（pi 侧，记录不在此复测）：1,839 字符闲置在 `Project`，其余三段合计超 1,670，文档 31,753 / 32,000。

## 2. 机制（`src/project-memory/sections.ts`）

`allocationFor(targets, wanted, body)`：

1. 每段先拿 `min(需求, 自己的目标)`；
2. 用不完的进池；
3. 超额段按**超出量比例**从池里借：`extra = min(超额, floor(池 × 超额 / 总超额))`。

池能覆盖全部超额时比例分配**精确等于**各自超额 ⇒ 一条不丢；池不够（即文档真满）才丢条目。
每段的 per-item cap 跟随**借到的额度**（`min(MAX_LIST_ITEM_CHARS, 额度 - 3)`），所以借到额度的段能把长条目整条留下。

`text.length <= cap` 仍由构造保证：`Σ额度 ≤ body = cap − 结构开销`。

### 池的口径（`59a53a4` 的复核级发现，已一并落地）

**池的分母是文档的真实 body，不是 Σtargets。** 两个开销函数必须分开：

| 函数 | 口径 | cap 4000 时 | 谁用 |
|---|---|---|---|
| `memorySchemaOverheadChars()` | 保守：每段后都预留空行 | 76 | `memorySectionBudgets` 的 share 分母 |
| `memoryStructureOverheadChars()` | 精确：header + 每段 `## H\n` + 段间空行 | 67 | 渲染器池的分母 |

用 Σtargets（cap 4000 时 **3922**）当分母会在文档还有 **11** 字符余量时丢条目——正是本条要修的那类浪费。

### dsh-only：tier C 的 overage 必须同源

`memorySectionOverage`（喂 `memoryLossRetryRule`）改为与渲染器**共用** `allocationForSections`，其 `budget`
字段从「share」变成「借用后的额度」。否则重试提示会按错的数额让模型压缩——本项目的既有不变量：
第二个估算比不重试更糟。由 `test/sections.test.mjs` 的「memorySectionOverage mirrors the renderer」用例钉住。

## 3. 与 pi 的差异（两条，必须保留）

1. **dsh 保数字、改语义；pi 是反过来。** pi 在**旧**数字（`0.2/0.4/0.25/0.15`）上改语义，dsh 的 `f38a0ba`
   在**旧**语义上只改数字（→ 现数字 + `MEMORY_SECTION_PROMPT_SHARE = 0.9`）。端口**没有**照抄 pi 的数字，
   两个数字（prompt 目标、share）都留在提示词里，只是把 share 重新标成目标。
2. **pi 的 `droppedSamples` 未端口**（属 pi-only）。pi 在回执里列 `Dropped, e.g. …` 的理由是「`errors.log`
   行可能没写」；dsh 每次有损写入都写日志（`index.ts` 的 lossy 分支），所以那半条没有对应问题。
   它记在 triage 的「Fold in, partial」，但本批按最小面**不做**；若以后要做，它是独立的一小块。

## 4. 改动面

- `src/project-memory/memory-schema.ts`：新增 `memoryStructureOverheadChars()`；`share` / `MEMORY_SECTION_PROMPT_SHARE`
  的文档改为「目标值」。
- `src/project-memory/sections.ts`：`allocationFor` + `allocationForSections`；`renderMemoryDocument` 用额度打包；
  `memorySectionOverage` 同源。
- `src/project-memory/index.ts`：四处「段超预算」文案改为「文档到达上限」（落地损失行、refused 损失行、
  `memoryLossDetail`、`refusedLossCause`）。
- `src/project-memory/consolidate.ts`：`memorySectionRule` 的段行与引导句、`memoryBudgetRule` 补目标说明、
  `memoryLossRetryRule` 末句。
- `test/sections.test.mjs`：新增「借用」与「池是真实 body」两条具名用例；改写两条既有夹具。
- `test/logic.test.mjs`：四处回执文案、section rule 断言、`never past` 负例、tier C 夹具。
- `CHANGELOG.md`：`未发布` 下的 project-memory 条目。

## 5. 验证（**数字会过期，跑命令而不是引用它们**）

```sh
cd /mnt/Data/Projects/dsh-project-context
pnpm typecheck            # 0
pnpm build                # 0；lib/client.js 仍 28575 字节
pnpm test                 # 418 通过 / 0 失败
```

变异轮（脚本一次跑完 4 个，每个都 `tsc` 0 错 + 标记进 `lib/` + 恢复后 `sha256sum -c` OK + 重建后 0 标记）：

| 变异体 | 被杀的用例 | 触发断言 |
|---|---|---|
| 池按 Σtargets 封顶 | 「the pool is the document's real body…」 | `droppedItems 1 !== 0` |
| 完全忽略池（硬 share） | 5 条（含借用用例） | 借用/夹具系列 |
| per-item cap 取自 share | 「a section over its share borrows…」 | `350 !== 800` |
| overage 报 share 而非额度 | 「memorySectionOverage mirrors the renderer…」 | `353 !== 806` |

**一个变异体被判无效而不是存活**：把池的表达式直接换成 Σtargets 会让 `memoryStructureOverheadChars`
变成未使用，`tsc` 报 `TS6133`（退出 2）。按纪律重塑为「池被目标和封顶」后才是有效变异体
——这正是 `dsh-plugin-mutation-round` 的「有效性三连」要拦的那类假红。

本批**未做**独立复核前的自我声明：独立只读复核在提交后进行，结论见本文件的「6. 复核」一节。

## 6. 复核（独立只读子代理）

（待回填：见本轮会话的复核报告。）

## 7. 边界与残留（**不要读成已修**）

- `MEMORY.md` / `CONTEXT.md` 里写下的「占用份额」散文不随本批改变；仍按现跑
  `.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs` 判读。
- 本批**改了 `src/` 行为**，需要宿主重启才在线；判据照旧「19387 持有者启动晚于最后一个 `src/` 提交」。
- 不改配置键、无新依赖、两个 profile 无需改动。
- tier C 的**拒绝语义**没变（`refuses` 仍由「会丢整条」驱动），变的是「什么情况下会丢」——现在只有文档满才会。

## 8. 下一批的入口（同一 triage 记录）

| 批次 | pi 提交 | dsh 锚点 | 先做什么 |
|---|---|---|---|
| **O** | `b7e2a31` / `d950910` / `b37cb55` / `4376bb5` / `3db610c` | `src/project-memory/load.ts:87`→`:93`（同步 `:179`/`:182`）；`record.ts:55/64/66` | 先复现 pi 的 FIFO 竞态夹具（`7285eb2`/`d87261a`/`1830b1d`，含 30s 看门狗自检），再落 `readRenderWithMtime` 一类单次读取 |

### 批次 O 的规格（已侦察，读自 pi `origin/master`）

pi 的最终形状（`extensions/project-context/memory/store.ts`）三个原语：

1. `readRenderWithMtime(file) -> {text, mtimeMs, changed}`：`stat` → 读 → `stat`，
   `changed = Boolean(after) && (before?.mtimeMs !== after.mtimeMs || before?.size !== after.size)`。
   已接受的残留：同尺寸且落在文件系统时间戳粒度内的替换**看不见**。
2. `renderIsNewerThanJournal(renderMtimeMs, journalMtimeMs)`：**mtime 判据只有一个所有者**，
   `flushActionFor` 的纯表与 adopt 路径都读它（dsh 现在这份比较是重复的——memory 里记的既有残留）。
3. `flushActionFor(renderNow, renderMtimeMs, journalMtimeMs, foldKey, changed)` 多一个 **`"recheck"`** 态：
   `changed` 时既不算 keep 也不算 publish，而是留下一次 pass。

三条调用侧的纪律：① `loadMemory` 的纯读路径用单次读取，且 `changed` 时**不 adopt**（journal 的 fold 说了算）；
② `adoptExternalEdit` 自己那次读也走单次读取，`changed` → 直接 `return false`；**借入 key 的调用方自己负责那次读**；
③ 写路径在 append 前 **recheck**（`b37cb55`），因为它的 key 是在模型调用之前读的，到 append 时可能已过期。

夹具（pi `tests/consolidation-test.mjs`，用 `execFileSync("mkfifo", …)`）：MEMORY.md 做成 FIFO，
写入者先把旧字节交给读者、**然后**替换路径——两个版本因此被确定性地排序，不需要外部并发写者。
三个断言：不报告写入 / journal 保住替换 / 磁盘保住替换；移除一致性守卫时三个一起翻红。
带 30s 看门狗，超时 `SIGKILL` 并打印「FIFO fixture never got a reader」。
dsh 侧入口是 `src/project-memory/load.ts`（对应 pi 的 `store.ts`）与 `record.ts`。
**判据现在写了三遍**（这正是 memory 里记的既有残留「one shared function is the fix, not another copy」）：
`load.ts:96`（异步读，`readOptional` 后再 `stat`）、`load.ts:182`（同步读，`readMemorySync` 后再 `mtimeMs`）、
`record.ts:66`（adopt 路径，`readOptional` 后再 `stat`）。三处都必须在同一轮改齐，否则就又多了一份拷贝。
| **Q** | route B（`origin/master`） | `src/shared/reply-json.ts:116`；`consolidate.ts:360/374/583`；`index.ts:198/246`；`sections.ts:294` 与 `:284-292` 的边界注释；既有 pin `test/sections.test.mjs:344-350` | 端到端缺陷已由入库探针证明：`node .agents/evidence/2026-10-10-opaque-reply-acceptance/probe.mjs` → 退出码 **10**。新谓词放 `sections.ts` 的 `isHeadingOnlyDocument` 旁，**复用**它已有的 fence 读取；把 `consolidate.ts` 的 `:588-590` 诊断串同轮改名并新增用例。**用户已点头**做 Q |
| **R** | `099ebf3`（重试）+ `068b7e8`/`5783610`（等待提示） | `consolidate.ts:506` 的 `RETRY_OUTPUT_HEADROOM_TOKENS`；`output-budget.ts:42-44`（输入侧已计） | 重试半边可直接做；**等待提示半边先探** dsh 命令面能否在 await 前插一句话（`index.ts:439-440`、`src/project-autolearn/index.ts:101`），探不到就只记残留 |
| **P** | `033fa75` + `eff6a56` | `index.ts:422-427` | **用户裁决为「先补证据」**：证据任务是「dsh 的 `agent/disposed` 处理器里抛出的模型调用异常能否逃逸进宿主 runner」，属只读源码+宿主面调查，见本轮会话的 P 证据报告；拿到 REACHABLE / NOT REACHABLE / UNKNOWN 后再请用户裁 |
