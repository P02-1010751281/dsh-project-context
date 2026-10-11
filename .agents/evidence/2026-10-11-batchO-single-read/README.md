# 批次 O 证据：一次读取 + 一版本纪律（memory 存储）

日期：2026-10-11　对应改动：`src/project-memory/load.ts`、`src/project-memory/record.ts`
（批次 O，第九次 pi triage；pi `origin/master` = `d25ecab2f848208f693c9fa0b1663043a881bffd`，
参考实现 `extensions/project-context/memory/store.ts`）。

三个探针都**不依赖运气**：两个竞态探针把 render 路径做成 FIFO，写入端用**阻塞的
`open(file, "w")`** 当调度屏障——写端只在读者已打开 FIFO 时返回，所以读者**必然**先拿到旧字节，
路径**随后**才被替换掉。这也解释了为什么这个竞态普通夹具做不出来：需要一次「落在读内部的替换」。
第三个探针不需要竞态：它只要求 render 被清空且比 journal 新。

```sh
cd /mnt/Data/Projects/dsh-project-context
node .agents/evidence/2026-10-11-batchO-single-read/read-race-probe.mjs      # 读侧竞态
node .agents/evidence/2026-10-11-batchO-single-read/write-race-probe.mjs     # 写侧竞态
node .agents/evidence/2026-10-11-batchO-single-read/cleared-render-probe.mjs # 清空的 render
```

三个都只读本仓（import 构建后的 `lib/`，仓库根由探针自身位置解析），写入只发生在 `$TMPDIR`
下的一次性根目录里。

## 现跑输出（修复后，三个都 `exit 0`）

```
source        : memory.jsonl
adopted older : false
file replaced : true
stable source : MEMORY.md
RESULT: FIXED - the journal's fold stands through the replacement, and a stable edit still wins

journal holds dropped version : false
reply published               : true
refusal logged                : true
on disk                       : the reply
RESULT: FIXED - the dropped version never reached the journal and the pass still published

source               : memory.jsonl
read is the fold     : true
sync agrees          : true
pass published       : true
wrong-cause refusal  : false
RESULT: FIXED - a cleared render leaves the journal in charge and the pass still publishes
```

- 读侧的四行是一组**判别器**，不是四个观察：如果读者是在替换**之后**才开始的，它会采纳替换并
  返回 `source: MEMORY.md`——正是断言的反面；所以「`source` 是 journal」只能在**读真的跨过替换**
  时成立。最后两行是同一探针的**正向对照**：稳定文件上的较新外部编辑仍被采纳，说明守卫不是
  「一律拒绝外部编辑」。
- 写侧 `refusal logged: true` 是 `errors.log` 里那条
  `the memory render changed before the memory journal could record the edit; both were left for the next pass`；
  探针把「原因确实被记下」也算进判据（`exit 4` 单列），`reply published: true` 说明拒绝复核
  **没有**连带拒绝这一轮的回复。
- 清空探针是**本批第一版那条回归**的判别器（见下）：它同时检查两个读者返回 journal 的 fold、
  以及带 `basisKey` 的一轮仍写入，并把 `the memory changed while this pass's reply was being built`
  这条**错误归因**单独判红（`exit 11`）。

## 修复前的读数（记录值）

- 两个竞态探针对**修复前的 `lib/`（`cccabf2`）** 都打印 `RESULT: DEFECT …` 并 `exit 10`：
  读侧 `source: MEMORY.md` / `adopted older: true`（**旧字节戴上新文件的 mtime，赢下这次读取**）；
  写侧 `journal holds dropped version: true`（journal 记下了文件**已经丢掉**的那一版，于是它的 mtime
  被推新，更新的手改被永久压住，下一次发布再从磁盘把它抹掉——pi 报告 I1/B1 的同一类）。
- 清空探针对**本批第一版**（已删掉 `renderRaw.trim()` 守卫、只有 `!renderKey`）`exit 10`：
  `source: MEMORY.md` / `pass published: false` / `wrong-cause refusal: true`。原因是
  `memoryComparisonKeyWithDrop` 对任何输入都至少产出规范化的裸标题——实测 `""` / `" "` / `"\n\t "`
  的 key 都是 `"# Project Memory\n"`（17 字符），所以 `!renderKey` 在两个读者上都是死代码。

三条都**不需要保留旧构建**也能复现（复现命令就是把对应守卫改回反义后重建）：

| 探针 | 复原它需要的变异 |
|---|---|
| `read-race-probe.mjs` | `if (render.changed) return false;` → `… && false`（M1） |
| `write-race-probe.mjs` | `if (verify.changed \|\| renderKeyOf(verify.text, limit) !== renderKey)` → `if (verify.changed)`（M6） |
| `cleared-render-probe.mjs` | `if (!render.text.trim()) return false;` → `… && false`（M3） |

本批的完整变异记录（8 个全杀）见 `CHANGELOG.md` 的同名条目与
[`docs/batch-o-single-read-brief.md`](../../../docs/batch-o-single-read-brief.md) §5。

## 这条证据**不能**说明的（不要读成已证）

- 宿主在线行为：这是对构建产物 `lib/` 的离线探针，不是对运行中宿主的注入。
- `readRenderWithMtime` 的 `changed` 是 **mtime + size 启发式**，同尺寸且落在文件系统时间戳粒度内的
  替换仍然看不见——**登记残留**，不是本批关闭项。发布决策本身走内容键
  （`memoryComparisonKey` / `basisKey` / `nowKey`），mtime 只决定「要不要把读到的那一版当基准」。
- **只由标题组成的 render**（`"# Project Memory\n"` 这种，既不是空也不是空白）在修复前就赢读取：
  既有的洞，本批**没有**改变它，它属批次 Q 的判据。本批关掉的是「空/空白/不可读也走同一条路」。
- 同步读者（`loadMemorySync`，提示词装配）的 `changed` 分支**没有夹具能驱动**：同步读取无法在
  进程内被替换打断。它由纯函数 `renderChangedUnderRead` 的具名用例 + 「同步读者与异步读者对稳定文件
  读法一致」的正向控制覆盖；「同步读者在真实跨进程替换下会拒绝」这一句**本批无法证明**。
