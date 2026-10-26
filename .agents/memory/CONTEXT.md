# Project Context

Last updated: 2026-10-26T10:19:14.414Z

## Summary

本会话从 `session-2498fdec` 交接而来，主题是两件事的收尾：dsh 0.2.1-rc.2/rc.3 更新面审计，以及批次 U（交接横幅声明尾料是否带上）是否已上线。上一轮报告曾据「socket holder 启动时间早于批次 U 提交」判断宿主在跑旧代码并要求重启，本会话用交接种子自身推翻了这个判断：本会话收到的种子用的是 `continuationTrimmed` 文案（只存在于 17:24:56 那次构建之后）并带着完整 `<recent-conversation>` 尾料，说明那次 17:29 的交接已经跑的是新代码。用户随后重启了桌面，新宿主 pid 612749 / 端口 42411（旧 42841 已消失），holder 启动 17:59:58 晚于最后一条 `src/` 提交 27c8c27（17:27:11），`check.mjs --port 42411` 跑出 RESULT: PASS；逐批次归因显示 27c8c27（批次 U）、b28f636（T2）、2fc8957（T1）、6109688、0bf0b31、9edd119、ee2e3b9、1b18799 全部在 holder 内；`git diff --exit-code -- lib` 干净，wrapper 与 live store 同为 `416vkniv…dsh-desktop-0.2.1-rc.2`；最新 web-boot 日志里 `skipping profile bundle` 与 `peerDependencies` 均 0 次。四插件逐条 active 已核对（`dsh-project-context`、`…/memory`、`…/autolearn`、`…/handoff`），`enabled 但非 active: 0`——第一次探针用包名 `dsh-project-memory` 做 `--expect` 撞出过一次假 FAIL，真实参数是 moduleName 后缀。插件在 17:01:36 自己重写的 `.agents/memory/{MEMORY,CONTEXT}.md` 已按并发写者规则单路径暂存并提交推送为 909bc6a，工作区现为空且 `HEAD == origin/main`。dsh 更新面：0.2.1-rc.2 的类型面机械 diff 完毕（我们 import 的十个符号全部未变形，新增项均 additive），行为面新知情项有 `refreshContext` 在 request admission 重跑 provider、`engines.dsh` 单独决定 peer 兼容、`./invariant` 子路径整族删除、`Session.header.cwd` 为官方项目身份、`tool-subagent` 删掉 `backgroundMode`；rc.3 的 npm 包已解包 `/tmp/dsh-delta-2026-10-26/pkgs/0.2.1-rc.3` 并落了 `.agents/evidence/2026-10-26-dsh-021rc3-behaviour-diff/REPORT.md`（提交 2ecda9b），结论是无需改动。仍未做：rc.3 的 online re-probe（只有真把 profile 切到 rc.3 才有意义）、`CONTEXT.md` 里那条已过期的「pid 186739 / 端口 42841」加载态 bullet（不手改，等下一次 `/memory update` 重写）、desktop profile 上那条已 disabled 的过期 `backgroundMode` 是否清理、以及是否为批次 U 补一条上线证据记录。

## Key points

- 批次 U 已进程级上线：holder pid 612749 started 17:59:58 > 最后 `src/` 提交 27c8c27 17:27:11，`check.mjs --port 42411` RESULT: PASS，`lib/` diff 干净，store 同为 `416vkniv…rc.2`
- 上一轮「宿主在跑旧代码」的推断已被证伪：17:29 那次交接的种子本身用了 `continuationTrimmed` 文案并带完整尾料，只有 17:24:56 之后的构建才有这条路径
- 四插件在 live host 中逐条 active，enabled 但非 active 为 0；`dsh-live-inventory-probe.mjs --expect` 要传 moduleName 后缀而非包名，否则假 FAIL
- 插件 17:01:36 自写的 `.agents/memory/{MEMORY,CONTEXT}.md` 已单路径提交推送为 909bc6a，工作区干净，`HEAD == origin/main`
- dsh 0.2.1-rc.2 类型面 diff 机械核对完毕：十个被 import 的符号形状未变，新增均为 additive；`LlmModelContext` 仍只有 `{contextWindow}`
- 0.2.1-rc.2 行为面新知情项：`refreshContext` 在 request admission 重跑 context provider（同步纯读，无行为变化）；`engines.dsh` 若存在则单独决定 peer 兼容；`./invariant` 子路径整族删除；`Session.header.cwd` 是官方项目身份；`tool-subagent` 删 `backgroundMode`
- rc.3 逐包审计已落档 `.agents/evidence/2026-10-26-dsh-021rc3-behaviour-diff/REPORT.md`（提交 2ecda9b），结论为无影响
- `handoffBudgetRecentTokens: 0` 下种子的形态现在由批次 U 的 `continuationNothing` 明确告知，不再是静默缺口

## Open tasks

- rc.3 online re-probe：等 profile 与 wrapper 真的切到 0.2.1-rc.3 后再做，要读 `modelsTimeoutMs` 与列举条目里 `contextWindow` 的生效值而不是目录值
- `CONTEXT.md` 里「宿主 pid 186739 / 端口 42841」那条加载态 bullet 已过期，等下一次 `/memory update` 由插件自己重写，不要手工追加
- 是否清理 desktop profile 那条 `disabled: true` 行上残留的 `backgroundMode: one-shot`（无行为影响，纯清理）
- 是否为批次 U 补一条 `.agents/evidence/` 上线证据记录
- 上一轮那次瞬时 2 条测试失败仍判为并发写入撞上 `context-injection.test.mjs` 读仓库自身 memory 文档，未记成已修；代码此后未变、三连跑复绿

<!-- latest-session-title: Batch U live after desktop restart; dsh 0.2.1-rc.2/rc.3 delta audit closed -->
