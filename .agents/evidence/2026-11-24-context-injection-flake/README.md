# `test/context-injection.test.mjs` 的偶发失败：三条候选成因的排除与一条真缺陷

- 日期：2026-11-24。
- 取证对象：仓库自己的 `test/context-injection.test.mjs`（唯一读 `.agents/memory/{MEMORY,CONTEXT}.md` 的用例
  `the real tracked documents keep every heading`）与它读的那两份文档。
- 起点：`CONTEXT.md` 的 Open tasks 长期写着「偶发失败仍无定论」。本轮在没有并发写入的窗口里把它查清。
- 探针：`probe.mjs`（只读，不写任何文件）。`node probe.mjs` 退出码 0 = 三条候选成因都不成立且真缺陷可复现。

## ① 结论

1. **「读到半截文件」不成立。** 插件写文档走 `writeAtomic`（`src/shared/files.ts`）——先写
   `${file}.${pid}.${uuid}.tmp` 再 `rename`，所以 `readFileSync` 拿到的必然是旧版或新版整份。
2. **「文档缺 Project/Index 致渲染器提前返回」不可达。** `renderMemoryDocument`
   （`src/project-memory/sections.ts`）对四个段落逐个 `push` 标题，预算不足时也只推标题不推条目
   （`## ${budget.heading}` 后 `continue`），`# MEMORY_HEADER` 之外恒有四个 `## ` 行。没有任何写入路径能产出
   缺段的 `MEMORY.md`；`sectionsFromMarkdown` 只读不写，它判「不透明」时文档原样保留。
3. **历史上真实的失败全部早于 `1c51298`**，且那次修复是有效的。归档日志里带断言原文的失败签名
   （`is neither inline nor pointed at` / `is both inline and pointed at` / `carries no sections at all`）
   只出现在 `session-dec39c6d`；`session-141152c3` 里两次红都发生在该提交之前
   （一次是并发写入撞上旧断言，一次是变异运行本身）。
4. **真缺陷（已修，`66d941b`）**：该用例用 `/^## (.+)$/gm` 扫标题，而渲染器把代码围栏内的 `## …` 当内容。
   当这段围栏落在**被索引**的段落（`Project` / `Index`）里，整段连同围栏被指针行替换，正则扫出的标题就
   指向一个不存在的段落——正确渲染被读成失败。`documentHeadings`（`src/project-memory/injection.ts`，
   本轮新增）导出渲染器自己的扫描，用例改读它。

## ② 负控制（修复是否真的判别了那个形状）

同一份构造文档，`1c51298^` 的断言与 HEAD 的断言给出相反结果：

```
pre-fix assertions: FAIL keep=[true,true] pointerCounts=[1,2]
HEAD assertions   : PASS
```

形状是「被保留的段落里有一条以 `` - `## Index` `` 开头的记忆条目」——修复前按行首前缀计数会把它算成
第二个指针。这正是 `1c51298` 的提交信息描述的场景，故该提交有效。

## ③ 残余，如实记录

`the real tracked documents keep every heading` 的期望从**同一个扫描**派生，所以它对「扫描少报」
天然盲。变异 M3（`documentHeadings` 丢掉最后一段）只红合成用例
`documentHeadings sees the renderer's sections, not a fence-blind regex`，真实文档用例仍绿。

这不作「已覆盖」：两个用例的分工是——合成用例钉**扫描规则**，真实文档用例钉**渲染不丢段**。
写进两处注释，免得日后把 M3 的红当成真实文档已被保护。

## ④ 三条变异的可复现记录

均先 `npx tsc` 编译进 `lib/` 再跑 `node --test test/context-injection.test.mjs`，各自只红目标用例：

| 变异 | 做法 | 红的用例 |
|---|---|---|
| M1 | `documentHeadings` 退回 `/^## (.+)$/gm` | `documentHeadings sees the renderer's sections…` |
| M2 | 闭合围栏永不识别（`else if (false)`） | 同上 |
| M3 | `documentHeadings` 丢最后一段 | 同上（真实文档用例**不**红，见 ③） |

还原：`cp /tmp/ci-mut/injection.ts.good src/project-memory/injection.ts` 后重建；
`grep -rn "MUTANT\|slice(0, -1)\|matchAll(/\^## )" src/project-memory/injection.ts` 0 命中。

## ④b 探针自己的失败分支

`probe.mjs` 的每条检查都实测过能红（否则它只是一个恒绿的废话）：

- 第 ① 条：把 `rename(temporary, file)` 换成一个不存在的模式 → 红。
- 第 ② 条：断言一个永不渲染的标题 `## Nonexistent` → 红。
- 第 ③ 条：反过来断言「扫描同意围栏内是标题」 → 红。
- 第 ④ 条：给 `documentHeadings` 的结果拼一个 `"Bogus"` → 红。

两次负控制各自只让被篡改的检查红、其余仍绿，`RESULT: FAIL (2)`、rc=1；还原后 `RESULT: PASS`、rc=0，
还原用 sha256 核对（`669394be…`）。

## ⑤ 给后续记忆 pass 的一条

`CONTEXT.md` 的 Open tasks 里「`test/context-injection.test.mjs` 的偶发失败仍无定论」这条可以关掉，
换成「已定论：见 `.agents/evidence/2026-11-24-context-injection-flake/`；残余是真实文档用例对扫描少报
天然盲（合成用例钉扫描规则）」。`CONTEXT.md` 由插件写路径维护，本档案不改它。
