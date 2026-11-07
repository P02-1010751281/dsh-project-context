# 输出预算的裁剪视图被写回（2026-11-07）

## 缺陷

`fitMemoryInput` 在**输出预算装不下两份文档**时会头尾各剪一刀，然后把剪过的视图发给模型。回复是
**整篇替换**，所以模型没看到的那段就这么被删除；状态只会是 `clipped`，而 tier C 放行——它拿回复和
**写**上限比，回复装得下。读上限那半边已在 `5efaef8` 堵住（`read-capped-refused`），这半边没有门。

`probe.mjs` 在宿主加载的 `lib/` 上跑网格，读 `.agents/memory/MEMORY.md` 造文档，**默认
`maxOutputTokens` 32768 下就能命中**：

| memory + context | 第一次 fit | 截断重试的 fit |
|---|---|---|
| 42199 + 16048 | 干净 | **隐藏 4232** |
| 45247 + 8164 | 干净 | **隐藏 3218** |

两者都在 45000 的 `maxMemoryChars` 与 32000 的 `MAX_CONTEXT_CHARS` 之内，所以读上限门禁不会先拦。
原因在 `fitMemoryInput` 自身：重试头寸（`max(RETRY_OUTPUT_HEADROOM_TOKENS, 真实思考量)`）是**从同一个
输出 cap 里留走**的，「多要头寸」必然「少发内容」——这条路径此前还被一条用例正面钉着（原名
`clipped follows the input that was actually sent last`，断言重试确实发得更少）。

## 修法

1. **首次 fit 裁剪 → 模型调用前拒绝**（`fit-capped-refused`），回执杠杆是 `maxOutputTokens` 或压小文档，
   并且**不出** `maxMemoryChars`：抬记忆上限买不到输出预算一个 token。
2. **截断重试的 fit 会隐藏内容 → 不发送这次重试**，失败文案改写成真实成因与正确杠杆。

## 复跑

```bash
node .agents/evidence/2026-11-07-fit-clip-writeback/probe.mjs
# 0 = 两种形态都复现（测试有真实依据）；1 = 网格里找不到
```

探针会打印条目的均长与命中的点数；它自己会挑一个「第一次干净、重试裁剪」的最大 memory 点，
所以文档内容变了之后读数会跟着变，这正是要的——**上表是 2026-11-07 的读数，不是常量**。

## 这个探针不证明什么

- 它不证明生产上真的发生过这次写回：`errors.log` 没有对应行，因为该路径**只报告不记录**成拒绝
  （只有一句 `consolidation was given a shortened version …`）。命中条件是按今天的文档尺寸算出来的。
- 它不覆盖读上限那一半（`5efaef8` 的 `read-capped-refused`）与骨架回复的半写（同批另一处，见
  `src/project-memory/index.ts` 的 `contextRefused`）。
