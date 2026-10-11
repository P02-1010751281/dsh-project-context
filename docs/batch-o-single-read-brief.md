# 批次 O：一次读取 + 一版本纪律（第九次 pi triage）

日期：2026-10-11　状态：**已落地（`src/` 行为变了，需宿主重启才在线）**
来源：pi `b7e2a31` / `d950910` / `b37cb55` / `4376bb5` / `3db610c`（pi `origin/master` = `d25ecab`，
参考实现 `extensions/project-context/memory/store.ts`），triage 记录见
[`docs/upstream-pi-triage.md`](upstream-pi-triage.md) 的「Batch O」。

## 1. 缺陷（三条；前两条是本批的靶，第三条是本批**自己第一版**引入并同轮修掉的）

（a）**纯读路径把「旧版本的字节」配上「新版本的 mtime」。** `loadMemory` 原先
`readOptional(target)` 读字节、随后再 `stat(target)` 取时间。两次调用之间落下的替换让读者拿到旧字节
却盖上新文件的 mtime，于是**被替换掉的那一版赢下了这次读取**——`source` 变成 `MEMORY.md`，注入
提示词的就是那份旧内容。同步读者（`loadMemorySync`）是同一形状。

（b）**adopt 的 append 前没有任何复核。** `recordMemoryDocument` 拿「本轮开始时读到的 key」配
「写前新 `stat` 的 mtime」判定；FIFO 注入下 journal 末行是**文件已经丢掉的那一版**，journal 的 mtime
因此被推新，更新的手改被永久压住，下一次发布再从磁盘把它抹掉。这是 pi 报告 I1 / B1 的同一类。

（c）**「空 key 就是文件被清空」是错的。** 第一版删掉了旧的 `renderRaw.trim()` 外层守卫、改用
`if (!renderKey) return false;`。但 `memoryComparisonKeyWithDrop` 对**任何**输入都至少产出规范化的
裸标题：实测 `""` / `" "` / `"\n\t "` 的 key 都是 `"# Project Memory\n"`（17 字符，永不等于 `""`），
所以那个守卫在两个读者上都是**死代码**。后果（两个都实测过）：手工清空（或 `chmod 000`——`readOptional`
把读错误折叠成 `""`）且比 journal 新的 `MEMORY.md` **赢下读取**，模型看到裸标题；并且
`recordMemoryDocument` **拒绝一次真实整理**，把那个裸标题称作「更新的内容」
（`the memory changed while this pass's reply was being built`）——本仓库的中心缺陷类（错误归因）。
发现方式：本会话为核对「新旧判据等价」而写的 864 格对拍网格先报出 60 格不一致；独立只读复核随后
**独立复现**了同一条，并给出写路径那一半。修法：判据测 render 的**正文**（`render.text.trim()`）。

判别器（入库，驱动构建后的 `lib/`）：
`.agents/evidence/2026-10-11-batchO-single-read/{read,write}-race-probe.mjs`（FIFO，确定性竞态；
对修复前的 `lib/` 都 `exit 10`，对修复后都 `exit 0`）与 `cleared-render-probe.mjs`（(c) 的判别器；
去掉 `!render.text.trim()` 就 `exit 10`）。

## 2. 机制

一次读取：`readRenderWithMtime(file) -> {text, mtimeMs?, changed}` 做 `stat → 读 → stat`，
`changed = mtime 或 size 变了`（`renderChangedUnderRead`）。字节与时间因此描述**同一个版本**。

一条判据 + 一个纯决策（`src/project-memory/load.ts`）：

```ts
renderIsNewerThanJournal(renderMtimeMs, journalMtimeMs)   // 只有这一处比时间
externalRenderWins(render: RenderRead, renderKey: NormalizedMemory, foldedKey, journalMtimeMs)
//   正文为空 → 不采纳（清空/不可读的 render 不是外部编辑；**不能**用 key 判空）
//   changed  → 不采纳
//   key 为空 → 不采纳
//   key == fold → 不采纳
//   否则才比时间
```

两个读者（`loadMemory` / `loadMemorySync`）都过 `externalRenderWins`，所以「同一条判据写了三遍」这个既有
残留被消掉——而不是又多一份拷贝。**adopt 不走这个纯决策**：它记的是写入方借来的那个 key（而不是自己读到的
字节算出的 key），与读者共用的只是更下层的时间判据 `renderIsNewerThanJournal`，另有自己的两道守卫 +
append 前复核——这是本批保留的重复（复核 F2/F7，无可达后果）。key 参数的类型是 `NormalizedMemory`
（归一化结果），两个读者传的都是由自己那份字节算出的结果；**但类型只是形状、不是来源证明**，模块级调用者
仍可配错（复核 claim 4 实测 `true`，且该函数不在包面上）。

写路径：导出的 `adoptExternalEdit(projectRoot, limit, preRead)`（`src/project-memory/record.ts`）
判定用**本调用自己的**一致读取，并在 `appendMemoryOp` 之前**再取一次一致读取**复核「文件仍是那串
字节」；不满足就拒绝 + 写一条 `the memory render changed before the memory journal could record the
edit; both were left for the next pass`。`recordMemoryDocument` 把本轮开始时读到的 key 当
`preRead.renderKey` 交进去。

**为什么抽纯函数**：这是 pi 修同一条复核发现（I2「该分支零覆盖，整块删除后两个测试仍全绿」）的办法
——决策变纯之后每个时序都能从测试直接驱动，不需要并发写者。同步读者那条「没有夹具能驱动」的分支
也因此有了主。

## 3. 与 pi 的两处差异（有意）

1. **pi 只收敛了 `loadMemory`**（`b7e2a31` 标题即「loadMemory 的纯读站点」），本批把**同步读者**也
   收敛。同一缺陷类，代价是同步路径多两次 `statSync`。
2. **pi 的 `flushActionFor` / `flushMemoryRender` 本批不端口**。它服务于**批次 P**「退出不再调模型
   生成」，用户尚未裁决；dsh 今天**没有** flush 调用点，先落这张纯表就是死代码。P 裁完若要端口，
   `adoptExternalEdit` 已经就位（pi 的 flush 正是调它）。

## 4. 改动面

- `src/project-memory/load.ts`：`RenderRead`、`renderIsNewerThanJournal`、`externalRenderWins`、
  `renderChangedUnderRead`、`readRenderWithMtime`、`readRenderWithMtimeSync`、`statSafe`；两个读者
  改用一致读取 + 共用决策（`memoryComparisonKey` 不再被本模块引用）。
- `src/project-memory/record.ts`：新增 `adoptExternalEdit`（含 append 前复核）；`recordMemoryDocument`
  的内联 adopt 改为调用它。
- `test/memory-store.test.mjs`：9 条新具名用例（三条纯用例：`renderIsNewerThanJournal`、
  `renderChangedUnderRead`、`externalRenderWins`；FIFO 读竞态；借键过期；adopt 的两条守卫 + 正向控制；
  同步读者的稳定外部编辑控制；**清空 render 不赢读取且不使 pass 变陈旧**），以及 `replaceUnderRead`
  这个 FIFO 夹具（30 s `SIGKILL` 看门狗，清理失败不会吞掉信号）。
- `.agents/evidence/2026-10-11-batchO-single-read/`：三个探针 + README。

## 5. 验证（**数字会过期，跑命令而不是引用它们**）

```sh
cd /mnt/Data/Projects/dsh-project-context
pnpm typecheck            # 0
pnpm build                # 0；lib/client.js 仍 28575 字节
pnpm test                 # 428 通过 / 0 失败
node .agents/evidence/2026-10-11-batchO-single-read/read-race-probe.mjs      # exit 0
node .agents/evidence/2026-10-11-batchO-single-read/write-race-probe.mjs     # exit 0
node .agents/evidence/2026-10-11-batchO-single-read/cleared-render-probe.mjs # exit 0
```

等价网格（一次性工具，不入库）：把 `git show cccabf2:` 的旧判据逐字抄下来与新判据在 864 格上对拍
——第一版 **60 格不一致**，修好后 **0 格**。

变异轮（8 个，全部被杀；每个都 `tsc` 0 错 + 标记进/出 `lib/` 已核对 + 恢复后 `sha256sum -c` OK +
重建后 0 标记）：

| 变异体 | 打红的用例 |
|---|---|
| `externalRenderWins` 忽略 `changed` | 纯决策用例 + FIFO 读竞态用例（探针同时回 `DEFECT`） |
| 去掉「等于 fold 就不是外部编辑」 | `recordMemoryDocument seeds the journal…` + 纯决策用例 |
| **去掉 `render.text.trim()` 空正文守卫（缺陷 (c) 本身）** | **纯决策用例 + 清空 render 用例（`cleared-render-probe.mjs` 同时回 `DEFECT`）** |
| 时间判据 `>` → `>=` | 3–5 条（随同毫秒时序变动；两条纯用例 + adopt 守卫用例 + 同步读者用例之一） |
| `renderChangedUnderRead` 去掉 size 那一半 | 它的纯用例 |
| adopt 去掉 append 前复核 | 借键过期 + FIFO adopt 竞态（探针同时回 `DEFECT`） |
| adopt 去掉「等于 fold」守卫 | adopt 守卫用例 |
| adopt 去掉「必须比 journal 新」守卫 | adopt 守卫用例 |

后两个的「朴素写法」（直接删守卫）会因 `noUnusedLocals` 报 `TS6133`，按纪律重塑成保留符号引用的
形式之后才是有效变异体（与独立复核的 M6/M7 观察一致）。

## 6. 边界与残留（**不要读成已修**）

- `readRenderWithMtime` 的 `changed` 是 **mtime + size 启发式**：同尺寸且落在文件系统时间戳粒度内的
  替换仍看不见。**登记残留**——发布决策本身走内容键（`memoryComparisonKey` / `basisKey` / `nowKey`），
  mtime 只决定「要不要把读到的那一版当基准」这一次级判断。
- 从「最后一次读取」到 `appendMemoryOp` 之间的窗口仍在，与本模块其余写路径同宽。
- **同步读者的 `changed` 分支没有夹具能驱动**（同步读取无法在进程内被替换打断）：由
  `renderChangedUnderRead` 的具名用例 + 「同步读者与异步读者对稳定文件读法一致」的正向控制覆盖，
  「同步读者在真实跨进程替换下会拒绝」本批**无法证明**。
- **只由标题组成的 render**（`"# Project Memory\n"`）**在修复前就赢读取**：既有的洞，本批没有改变它
  （864 格网格与复核的独立网格都确认两版一致）。复核把它标为 **MEDIUM / 既有**，并指出它就是 F1 的同一个
  用户意图、也是「最便宜的下一步修法」；但它属**批次 Q** 的判据面（「回复须是本扩展文档形状」），本批不动。
  本批修掉的是「空/空白/不可读也走同一条路」，并把判据从 key 挪到**正文**——两者不要混读。
- adopt 的 append 前复核在「文件被同内容重写」时会**保守拒绝**并记一条（措辞已改成对两种分支都成立
  的说法，不再声称「更新的编辑到了」）。
- `journalInfo` 在 render 读之后取，仍有同样的固有窗口；`readOptional` 把所有读错误折叠成 `""`，所以
  「不可读」与「被清空」在读取层不可区分——这现在是无害的（两者都让 journal 当家），但它意味着
  状态视图不会为此报警。
- 测试文件的 `/tmp` 残留：`project()` 没有清理，本文件跑一次留下 44 个 `dsh-memory-*` 根目录（**全套件既有行为**，本批未改；三个探针自己 `finally` 清理）。
- 本批不改配置键、无新依赖、两个 profile 无需改动；**改了 `src/` 行为，需要宿主重启才在线**。

## 7. 下一批的入口

- **Q**（回复须是本扩展文档形状）与 **R**（输出预算诚实 + 两个等待提示）的入口照旧在
  [`docs/batch-n-shares-are-targets-brief.md`](batch-n-shares-are-targets-brief.md) §8；Q 的端到端
  缺陷已由 `.agents/evidence/2026-10-10-opaque-reply-acceptance/probe.mjs` 证明（`exit 10`），
  本批的「只由标题组成的 render」是它的读侧同类。
- **P**（退出不再调模型生成）证据已回：**NOT REACHABLE**，代价确定——见
  `.agents/evidence/2026-10-10-batchP-dispose-escape/`，**球在用户手上裁决**。
