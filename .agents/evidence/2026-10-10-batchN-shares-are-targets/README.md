# Batch N acceptance evidence — 段配额降为目标值

对应提交：`2462d59`（`fix(memory): make the section shares targets…`），简报见
[`docs/batch-n-shares-are-targets-brief.md`](../../../docs/batch-n-shares-are-targets-brief.md)。

## 复跑

```sh
node .agents/evidence/2026-10-10-batchN-shares-are-targets/fuzz.mjs   # 退出码 0 = PASS
```

只读：驱动仓库已构建的 `lib/`，不写任何文件。

## 它证明什么

| 性质 | 内容 | 结果（现跑） |
|---|---|---|
| P1 | `renderMemoryDocument(...).text.length <= cap`，覆盖所有能装下文档骨架的 cap | 0 违反 |
| P2 | `结构开销 + Σ条目成本 <= cap` ⇒ `droppedItems === 0`（池的承诺） | 0 违反（140,603 组入判） |
| P3 | `Σ rows.droppedEntries === render.droppedItems` 且 `Σ rows.truncatedEntries === render.itemTruncated`（tier C 的 overage 与渲染器无漂移） | 0 违反 |

20 万组随机输入，条目长度从 1 到 ~4,900 字符、每段 0–39 条、cap 覆盖 400 到 200,000。

P2/P3 是**独立于仓库内 2,000 组性质测试**的加强证据；P3 尤其重要——`memorySectionOverage` 是 dsh-only 的
函数（pi 没有对应物），它喂 tier C 的重试提示，一旦与渲染器漂移就会让模型按错的数额压缩。

## 为什么 P1 要把小 cap 排除，而不是断言它

`cap < memoryStructureOverheadChars()`（= 67）时，文档骨架本身就超过 cap，渲染器只能返回 67 字符的
「只有四个标题」的文档。**这不是本批引入的**，复跑：

```sh
bash .agents/evidence/2026-10-10-batchN-shares-are-targets/tiny-cap-boundary.sh   # 退出码 0 = PASS
```

它把 `lib/` 在 `2462d59^` 取出、对 602 组 cap/内容对比，现跑 `diffLen 5, overBoth 134,
overNewOnly 0`——旧渲染器同样超出 134 组，两者长度只在 5 组不同，正是端口让借用生效的那几组。
生产上也不可达——`maxMemoryChars` 的下限是 `MIN_MEMORY_CHARS`（4000）。

探针因此排除 `cap < 67` 并**打印被排除的组数**（现跑 5,052），而不是把它算成通过。
