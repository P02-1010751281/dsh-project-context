# Project Context

Last updated: 2026-11-04T13:32:04.387Z

## Summary

本会话续做批次 W（交接自动触发的决策 seam）：把「该不该交接」的判断从宿主读取里切成一个纯函数。落盘内容为新增 `src/project-handoff/decide.ts`（`decideAutoHandoff(inputs, config) → Decision`，只比较不求解）与 `src/project-handoff/measure.ts`（纯类型宿主，让判据核零宿主依赖——`runtime.ts` import `dsh-session`，且 `verbatimModuleSyntax` 下 type-only import 仍发射 `import {}`，是真加载）、`auto.ts` 收口为「取 inputs → decide → 派发」的适配器、`gate.ts` 去掉 `refusal` 字段、新增 `test/handoff-decide.test.mjs`（14 条）与 `test/logic.test.mjs` 的适配器级「未越线 ⇒ 不交接」门禁，外加规格 `docs/batch-w-decision-seam-spec.md` 与只读审计 `.agents/evidence/2026-11-03-handoff-decision-seam/audit.md`。提交前按仓库不变量现跑门禁：`pnpm typecheck` 0、`pnpm test` 476 通过 / 0 失败、`pnpm build` 0（`lib/client.js` 28575 字节不变）、`lib/` 对新鲜 `tsc` 输出 `diff -rq` 只剩 `client.js`、`decide.js` 的 `@deepseek-ai/*` import 实测 0。先按并发写者守护 skill 核对无第二写者（其余会话目录 mtime 停在 20:35），再精确路径暂存 20 个文件（`src/` 5 + `lib/` 10 + 测试 2 + 文档 3）提交为 `e3459c6 refactor(handoff): split the automatic trigger's decision into a pure seam (batch W)` 并推送，`main` 与 `origin/main` 齐平、工作区完全干净。判别力方面：变异 F（删掉 `handoffPendingQuestion === "defer"` 守卫）在补用例前 0 红、补后红 1 条，说明生产唯一被读的配置分支（两个 profile 都写 `wait`）此前零覆盖；A/C/D/E 只红本批新写文件，仅 B 被既有用例抓到——这些按实情写进了 CHANGELOG 条目（本批是行为等价重构，因此不写「修复」项）。宿主侧：socket holder pid 5639 启动于 20:32:30，早于本批提交，故新 `lib/` 未在跑；因本批行为等价，没有功能缺口，是否重启留待用户决定。顺带核实到两处记忆已陈旧：两个 profile 的 `handoffBudgetRecentTokens` 实际都是 20000（web:49 / desktop:1781，非记忆里写的 0），且 `MEMORY.md` 已逼近 `maxMemoryChars`，只能压缩改写不能追加。

## Key points

- 批次 W 已提交并推送：`e3459c6 refactor(handoff): split the automatic trigger's decision into a pure seam (batch W)`，20 个文件，`main` == `origin/main`，工作区干净
- 新结构：`decide.ts` 纯判据（无 `Session`/`Context`/`await`）+ `measure.ts` 纯类型宿主 + `auto.ts` 适配器（`gatherDecisionInputs` 是唯一宿主读取点，`handoffSplit` 留在适配器）
- 零宿主依赖是可实测项：`decide.js` 传递 `@deepseek-ai/*` import 实测 0；`gate.ts` 改为 `threshold: undefined` 无 `refusal` 字段
- 现跑门禁：typecheck 0 / build 0（`lib/client.js` 28575 B）/ test 476 通过 0 失败；`lib/` 对新鲜 `tsc` diff 只剩 `client.js`
- 变异 F：删 `handoffPendingQuestion === "defer"` 守卫在补用例前 0 红、补后红 1 条——两个 profile 都写 `wait`，该分支此前零覆盖
- 本批是行为等价重构，CHANGELOG 不写「修复」项，判别力按 A–F 变异逐条写实：仅 B 被既有用例抓到
- 宿主 pid 5639 启动 20:32:30 早于本批提交 21:27:10，新代码未在跑；行为等价所以无功能缺口
- 记忆陈旧项一：两个 profile 实际 `handoffBudgetRecentTokens: 20000`（web:49 / desktop:1781），与本轮之前的记忆「都是 0」矛盾；种子现在带逐字尾料
- 记忆陈旧项二：`MEMORY.md` 逼近 `maxMemoryChars`（40000），正确做法是压缩改写或 `/memory update`，不是追加
- 两个 profile 的 `handoffPendingQuestion: wait` 已现场核实（desktop:1782 / web:50）
- 规格里两处「未提交」措辞已改成就提交后仍成立的表达，避免文档与提交互相追赶

## Open tasks

- 用户决定是否重启宿主（desktop/web）以让批次 W 的模块拆分真正在跑；行为等价，可选，重启脚本是用户操作
- 修正两处陈旧记忆：profile 的 `handoffBudgetRecentTokens` 已从 0 改为 20000；`MEMORY.md` 需压缩改写而非追加，建议由 `/memory update` 或一次独立的等长改写批处理
- rc.3 online re-probe：等 profile 与 wrapper 真的切到 0.2.1-rc.3 后再做，读 `modelsTimeoutMs` 与列举条目里 `contextWindow` 的生效值而不是目录值
- `CONTEXT.md` 里「宿主 pid 186739 / 端口 42841」那条加载态 bullet 已过期，等下一次 `/memory update` 由插件重写，不要手工追加
- 是否清理 desktop profile 那条 `disabled: true` 行上残留的 `backgroundMode: one-shot`（无行为影响，纯清理）
- 是否为批次 U 补一条 `.agents/evidence/` 上线证据记录
- 上一轮那次瞬时 2 条测试失败仍判为并发写入撞上 `context-injection.test.mjs` 读仓库自身 memory 文档，未记成已修；代码此后未变、三连跑复绿

<!-- latest-session-title: Batch W decision seam landed and pushed; host still runs pre-batch code -->
