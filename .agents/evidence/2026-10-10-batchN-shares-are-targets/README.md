# Batch N acceptance evidence — 段配额降为目标值

对应提交：`2462d59`（端口本体）与其后的 F1 修复提交（见简报 §6）。简报见
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
| P2 | `结构开销 + Σ(条目裁剪到 item cap 后的成本) <= cap` ⇒ `droppedItems === 0`（池的承诺） | 0 违反（149,263 组入判） |
| P3 | `Σ rows.droppedEntries === render.droppedItems` 且 `Σ rows.truncatedEntries === render.itemTruncated`（tier C 的 overage 与渲染器无漂移） | 0 违反 |

20 万组随机输入，条目长度从 1 到 ~4,900 字符、每段 0–39 条、cap 覆盖 400 到 200,000。

P2/P3 是**独立于仓库内 2,000 组性质测试**的加强证据；P3 尤其重要——`memorySectionOverage` 是 dsh-only 的
函数（pi 没有对应物），它喂 tier C 的重试提示，一旦与渲染器漂移就会让模型按错的数额压缩。

## P2 是 F1 的判别器（不只是证据）

P2 的前提曾经量的是**未裁剪**的条目长度，于是它自己跳过了「长条目把邻段的需求放大、导致拟合法的回复丢条目」
这一区间——独立复核正是这样找到 F1 的。前提改成按 item cap 裁剪的**规范文档**后，同一份探针：

| 目标 lib | P2 结果 |
|---|---|
| 修复前（`git archive ee62e3e lib`） | **FAIL：违反 4,598 / 148,978 组（≈3.1%）** |
| 修复后（当前 `lib/`） | PASS：0 违反 |

复跑旧 lib：

```sh
R=$PWD; T=/tmp/oldLibCheck
rm -rf $T && mkdir -p $T/.agents/evidence/probe
git archive ee62e3e lib | tar -x -C $T
ln -sfn $R/node_modules $T/node_modules
cp .agents/evidence/2026-10-10-batchN-shares-are-targets/fuzz.mjs $T/.agents/evidence/probe/
node $T/.agents/evidence/probe/fuzz.mjs   # 退出码 1 = 判别成功
```

（旧 lib 提取到 `/tmp` 时必须 symlink `node_modules`，否则 `@deepseek-ai/cordis` 解析不到。）

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
