# 读上限写回：离线复现与门禁证据（2026-11-06）

`probe.mjs` 用**宿主真正加载的 `lib/`**（不是 `src/`）复现并验证一条数据丢失路径：
`maxMemoryChars` 是读写同一把尺，文档比 cap 长时 `loadMemory` 只把头部交给整理 pass，
而回复的 memory 是**整篇替换**——于是「照抄所见」的正常回复会把 cap 藏起来的那截删掉。

## 复现

```bash
node .agents/evidence/2026-11-06-read-cap-writeback/probe.mjs .   # 仓库根
```

夹具：四节文档（Project / Invariants / Pitfalls / Index 各 16 条），6482 字符，cap 4000；
模型回复是最老实的那个版本——只把**它被展示到的**内容按四节格式重新渲染一遍。
探针不写仓库，只在 `mkdtemp` 里建项目。

退出码：`0` = 无损（尾部仍在、`MEMORY.md` 逐字节不变）；`1` = 尾部被删；`2` = 夹具没触发 cap。

## 两天的两次读数

| 构建 | 模型调用 | 状态 | `MEMORY.md` | 尾部 `PIT007` / `IDX007` |
|---|---|---|---|---|
| 门禁前（`HEAD` = `634483d` 的 `lib/`） | 1 | `clipped` | 6482 → **3983** 字符 | **消失** |
| 门禁后 | **0** | `read-capped-refused` | 逐字节不变 | 仍在 |

门禁前那次是真正测出来的，不是推的：回复本身就是它看到的视图，状态报 `clipped`
（=`memoryHiddenChars 2510`），落盘 3983 字符，Pitfalls 与 Index 整节消失。
tier C 看不见这一类：它拿回复和**写上限**比，而回复是装得下的。

## 门禁本身

- 位置：`consolidateProjectState` 读完 `loadMemory` 与 `CONTEXT.md` 之后、解析路由与模型调用之前
  （`src/project-memory/consolidate.ts`）。判定量是 `existing.cappedDroppedChars + contextReadHiddenChars`，
  两个都是「这次读自己截掉多少字符」，不是长度差。
- 行为：返回 `readCappedRefused` 的 outcome，状态 `read-capped-refused`，两个产物都不落盘，
  `errors.log` 一条记录写隐藏量与两个 cap 的名字；回执按**被截断的那一侧**给杠杆
  （memory → 抬高 `maxMemoryChars` 或压文档；context → 只能压 `CONTEXT.md`，`MAX_CONTEXT_CHARS` 是常量）。
- 缓存按 cap 记：抬了 `maxMemoryChars` 的强制 pass 会重跑，而不是重播这条拒绝。

## 边界

- 探针只覆盖 memory 一侧的写回；context 一侧在 `test/memory-store.test.mjs` 里用同一套门禁断言
  （`MAX_CONTEXT_CHARS` 是常量，回执的杠杆不同）。
- 探针的夹具是**合成文档**，字符→token 密度与真实 `.agents/memory/MEMORY.md` 不同；
  它要证的是「读上限 + 整篇替换 = 静默丢尾部」这条机制，不是任何特定文档的余量。
