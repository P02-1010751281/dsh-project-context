# Batch V — 记忆条目的内容漂移（规格）

状态：**规格，`src/` 未改**。等 §9 的裁定。
上一轮（AOCI 调研）的结论是「可搬的不是索引，是对象身份 + 源绑定 + 漂移状态」；本批只落其中最少的一步。

---

## 0. 一句话

给每条记忆条目绑上它引用的**仓库文件的内容哈希**；文件在条目写入后被改过 → 该条目标 `stale`
（**只标，不删、不改写**），在 `/memory` 状态与整理回执里报数。

补上今天唯一缺的失效原因：**路径还在、行数还够、事实已经变了**。

---

## 1. 为什么是现在

- 现有锚点校验只判两种失败：文件不存在、行号越过文件尾（`src/project-memory/retirement.ts:207`）。
- 命中后**直接删除条目并写 tombstone**（`src/project-memory/retirement.ts:449-452`）——所以「内容变了」
  不能塞进这条通道，否则一次源码改动会静默删掉一条仍然成立的事实。
- 记忆的核心缺陷类是 misattribution：过期不变量比缺失的不变量更危险。今天没有任何东西能发现它。

---

## 2. 事实基线（2026-11-20 现读）

| 项 | 值 | 怎么测的 |
|---|---:|---|
| 条目数 | 145 | `sectionsFromMarkdown(loadMemory(...).text)` |
| 带**可核验**锚点的条目 | 27（实现后实测）；其中带 id 可绑定 **12** | `bindableAnchors`（lib）实跑 |
| 可绑定文件 | **12 个**，合计 **171.3 KB**（最大 `src/project-memory/sections.ts` 32.9 KB） | 实现后 `probe.mjs` 复测 |
| 自引用（`.agents/memory/*`）/ 生成物（`lib/*`） | 4 / 4 | 必须排除：前者每次 pass 改写，后者每次构建改写 |
| 仓外路径（`/etc/nixos/…`、`/mnt/…`） | 2 | 不绑（无绑定即不判），不产生假 stale |
| 当前 `anchor-drift` | 0 | `anchorDriftReasons` 实跑 |
| `entries.json` | 3,370 B / 145 个 id（≈23 B/id） | `stat` |
| sidecar 形状 | `{version:1, entries:{tid:"YYYY-MM-DD"}}` | `retirement.ts:529` |
| 读者只取 `.entries` | 是 | `retirement.ts:534-560`（加键天然兼容） |

**成本**：每轮 34 次读 + 1.06 MB sha256 ≈ 个位数毫秒；`/memory` 状态同样。这就是「不加配置键、默认开」的
依据（§9 问题 4）。

---

## 3. 现有机制的三条边界

1. **漂移 = 删除**：`retireSections` 把命中项放进 `drop` 并写 tombstone（`retirement.ts:449`）。
2. **sidecar 只存日期**：`entries.json` 是「时钟不是事实」，被 gitignore（`src/shared/gitignore.ts:25`）。
3. **写序在落地之后**：`MEMORY.md` 写成功后，tombstone 与日期各自 best-effort 写，失败只记
   `errors.log`（`src/project-memory/index.ts:379-390`）——新绑定必须遵守同一顺序与同一条失败语义。

---

## 4. 设计

### 4.1 数据形状（v2，向后兼容）

```json
{
  "version": 2,
  "entries": { "29f": "2026-10-01" },
  "sources": { "29f": { "src/project-handoff/perform.ts": "a1b2c3d4e5f60718" } }
}
```

- 新增 `sources`，**`entries` 一个字节不动**：旧读者只读 `.entries`（已核实），所以 v1 代码读 v2 文件、
  v2 代码读 v1 文件都安全。
- 值 = sha256 十六进制的前 16 位（8 字节）。用于「检测意外变更」足够；完整哈希不进文件（体积）。
- 只绑**仓库相对路径**，且排除 `.agents/memory/` 下的一切（自引用会永久 stale）。
- 与 `entries` 一样按 `keep` 裁剪：id 不在落地文档里就删。

### 4.2 绑定算法（写侧）

1. 在 `MEMORY.md` 落地之后调用（与 `recordEntryDates` 同一处，`index.ts:382`）。
2. 用**落地的那份文本**解析（不是模型回复、不是内存里的 plan）——与「数字来自产物本身」的既有纪律一致。
3. 锚点提取必须与 `anchorDriftReasons` **共用同一套规则**：把 ANCHOR 正则、扩展名白名单、父目录存在、
   本地产物排除四条抽成 `entryAnchors(entry, projectRoot)`，`anchorDriftReasons` 改为消费它。
   理由：两套正则必然漂移，本仓库已经被「同一个判据写两遍」坑过（见 `MEMORY.md` 的 `mtime-wins` 条目）。
4. 同一 id、同一路径、哈希未变 → 保留旧值，不重算写入。
5. 失败 → `logError(projectRoot, "memory", …)`，**不阻塞主写**。

### 4.3 判定算法（读侧）

四态，必须**具名**，不能折叠成 0：

| 态 | 条件 | 处置 |
|---|---|---|
| `fresh` | 绑定存在，哈希一致 | 计数 |
| `stale` | 绑定存在，哈希不同 | 计数 + 报 id |
| `missing` | 路径不存在 | **交给既有退休**，不重复算 stale |
| `unverifiable` | 读不了 / 仓外 / 自引用 | 报「无法核验」，绝不等于 fresh |

- 一个条目只要有一处 `stale` 就是 stale。
- **stale 不删、不改写、不写 tombstone、不进 `retired.md`**。

### 4.4 呈现

- `/memory` 状态：在字符/条目行之后渲染 `stalenessClause`——`N bound entries · stale K: <ids>`；`K = 0`
  打印 `0`（零是事实），算不出打印 `stale unknown`。
- 整理回执：**只在本次真的落地了文档、且至少有一条绑定**时追加一句
  （`Source bindings: …`）。`deduped` / `unchanged` / 各种 refusal 不测量也不报告——它们没有可报的量。
  `README.md` 与 `docs/behavior.md` 已同步。
- 只报数字 + 前 3 个 id，不列文件路径（太长，且 `/context find` 已经能查）。

### 4.5 并发与失败

- 写侧与 `entries.json` 共用 `withMemoryLock(entryDatesFile(projectRoot))`（同一个文件，同一个锁）。
- 读侧不加锁：只读哈希，不改盘；单文件读失败 → 该文件 `unverifiable`，不影响其他。
- 文档不可解析（opaque）→ 整次跳过，报 `unknown`，不写任何绑定。

---

## 5. 非目标

- 不自动改写 / 删除 stale 条目，不写 tombstone。
- 不把内容漂移并入退休判据（退休仍只看：路径存在、年龄、是否被取代）。
- 不做行级指纹（v1 文件级；行号锚点按文件算）。
- 不新增配置键（默认开，成本见 §2）。
- 不改 tier C、去重、段预算、注入。

---

## 6. 分期

| 期 | 内容 | 成本 |
|---|---|---|
| **V-1（本规格）** | 绑定 + 判定 + 两处回执 | 零模型调用、零新键、34 次哈希/轮 |
| V-2（不在本批） | 把 stale 列表放进整理提示词的「待复核」区块，让 pass 重读源码后决定改写/保留 | 每轮提示词 +N token；改写率未知，需先量 |

---

## 7. 测试与变异

新增 `test/memory-staleness.test.mjs`：

1. 真实 `recordMemoryDocument` 落地后写入 `sources`，哈希与文件内容一致（真接线，不是纯函数）。
2. 改动被引用的文件 → `stale`；未改 → `fresh`。
3. 删除被引用的文件 → 仍走既有 `anchor-drift` 退休，stale 计数不变（两条通道不重叠）。
4. 自引用与仓外路径 → `unverifiable`，不算 stale、不算 fresh。
5. 文档不可解析 → `unknown`，一个绑定都不写。
6. id 从文档消失 → 绑定被裁掉，文件不残留旧 id。
7. 判定是只读：调用前后逐文件字节比对。
8. 回执零值：`N = 0` 打印 `0` 而不是省略。

变异目标（每个依次只打红其具名用例）：不写绑定 / 恒 `stale` / 恒 `fresh` / 把 `missing` 当 `stale` /
把 `unverifiable` 当 `fresh` / `stale` 改为触发删除。

---

## 8. 验收

- `pnpm typecheck`、`pnpm build`、`pnpm test` 三条；新增用例数写进提交说明。
- 真实 145 条上只读 preflight：34 个绑定、0 stale、2 unverifiable、0 missing。
- 变异轮：6 个变异各自只红对应用例；恢复后 `lib/` 0 标记、`lib/` 与 `src/` 一致。
- 回执与绑定是宿主代码：**重启后**才在真实 `/memory` 出现。

---

## 9. 裁定问题

1. **落点**：`entries.json` 加 `sources` 键（推荐，向后兼容、同一把锁）还是新文件 `sources.json`？
2. **哈希长度**：16 hex（推荐，检测意外变更足够、文件只涨 ~2 KB）还是完整 64 hex？
3. **粒度**：文件级（推荐 v1，便宜且诚实）还是行内容级（贵、且行会漂移）？
4. **开关**：默认开（推荐，成本已实测）还是新增配置键（要走 batch H 六面）？
5. **stale 是否影响退休**：不影响（推荐——退休删除，stale 标记，两者语义相反）？
6. **V-2（进提示词）现在做吗**：不做（推荐——先把「能看见」跑一轮，拿到真实 stale 数量再决定）。

---

## 10. 复现

```bash
# 预检（只读）：条目数、可绑定文件数、当前 drift
node .agents/evidence/2026-11-20-batch-v-preflight/probe.mjs
node .agents/evidence/2026-11-20-batch-v-preflight/classify.mjs
# 现读 sidecar 形状
python3 -c "import json;d=json.load(open('.agents/memory/entries.json'));print(d['version'], len(d['entries']))"
```

证据：本轮实测输出见提交说明与 `docs/research/2026-11-19-repo-cognition-index.md` §7（可搬三条的第 1 条）。

---

## 11. 实现记录（2026-11-20）

已按 §9 的六条推荐落地，`src/` 与 `lib/` 同批提交。三处与规格的偏差，都是评审逼出来的：

1. **`lib/` 必须排除**（评审发现）。本仓库有 4 条条目引用 `lib/client.js`；`lib/` 是构建产物，
   每次客户端构建都会重写，绑定它会让每次 `pnpm build` 产生 4 条假 stale。已加
   `GENERATED_PREFIXES = ["lib/"]`，与 `.agents/memory/` 同一处判断。
2. **绑定的可绑定集合比预检小**。145 条里 82 条在读到的文档上带 id（部分盖章），
   其中 12 条有可绑定锚点、12 个文件、171.3 KB。规格 §2 的 34 是「不看 id」的旧数，已改。
3. **回执只在落地时报告**（见 §4.4 修订）：`deduped`/`unchanged`/refusal 没有测量，不打印 `stale 0`。

第一次评审还指出「绑定若每轮刷新，特性不可证伪」——规格 §4.2 第 4 条原本就写了保留旧值，
实现按 first-wins 落地，并补了一条具名用例（第二轮 pass 不清除 stale）。

**变异轮**（6/6 被杀，每个只红其具名用例）：刷新基线 → 「第二轮不清除」；绑生成物 → 自引用/生成物；
`missing` 当 `stale` → 三态；写盘丢弃未知键 → v1 升级；不透明文档清空绑定 → opaque；未测量打印 0 → 措辞。

**验收**：`pnpm typecheck` 0、`pnpm build` ok（`lib/client.js` 37,349 B 不变）、`pnpm test`
**695/695**（基线 682，+13）。`src/` 从哈希快照恢复后与快照逐字节一致，`lib/` 0 个变异标记。
