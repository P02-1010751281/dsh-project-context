# Project Context

Last updated: 2026-11-04T14:36:33.350Z

## Summary

本会话接手批次 W（交接自动触发的决策 seam）之后的收尾工作。先核对磁盘真态：批次 W 的代码、测试、规格与审计已于上一会话提交并推送（`e3459c6`），但插件在 21:32 自动整理写出的 `CONTEXT.md` 仍留在工作区未提交。用现成的 `roundtrip.mjs` 验证该文档是安全不动点（17 项、0 超 800 上限、字节相同）后原样提交为 `48be67c`。随后处理两处陈旧记忆：`MEMORY.md` 第 52 行称两个 profile 仍「align `handoffBudgetRecentTokens: 0`」，第 53 行称两个 profile 的注释仍描述那个旧世界 —— 现场核实两个 profile 实际都是 `20000`（batch U 已改），web 卡片注释也已重写，两处都按整行替换改成与现状一致的表述。`CONTEXT.md` 同步改三处：`Summary` 去掉会随 settings 重写漂移的 profile 行号、删掉已被本次整理满足的 pid 陈旧 bullet、把已完成的「修正陈旧记忆」换成持续性的 `maxMemoryChars` headroom 注意项。验证走插件自己的渲染器而不是 grep：`MEMORY.md` 解析→渲染字节相同、`sectionDropped 0 / itemTruncated 0`、114 条目无超限、`loadMemory` 报 `truncated=false / damaged=0 / poisoned=false`（净减 39 字符）；`CONTEXT.md` roundtrip 字节相同（17 项）。旧串全部 0 次、新串各 1 次、无重复残留。修正提交 `3770f06` 推送后 `main` 与 `origin/main` 齐平，工作区干净，技能目录无漂移。宿主侧仍跑批次 W 之前的代码（socket holder 启动早于本批提交），但本批是行为等价重构，没有功能缺口，是否重启留待用户决定。本轮还观察到一次自动交接的跳过：上下文越过阈值但走出 `skip(nothing-to-drop)` 分支，因为 recent 窗口已覆盖整个会话。

## Key points

- 批次 W 已在此前会话提交并推送为 `e3459c6 refactor(handoff): split the automatic trigger's decision into a pure seam (batch W)`（20 个文件），本轮只剩记忆文档收尾
- 插件 21:32 自动整理写出的 `CONTEXT.md` 未提交；经 `roundtrip.mjs` 验证为安全不动点后原样提交为 `48be67c docs(context): land the 21:32 automatic memory pass`
- `MEMORY.md` 有两处陈述陈旧：称两个 profile 仍是 `handoffBudgetRecentTokens: 0`、称两处注释仍描述旧世界；现场核实 web 与 desktop 都是 `20000`，web 注释也已改写
- 两处按整行替换修正（净减字符），未追加，因为文档已在 `maxMemoryChars` 的 98% 上；追加会把它推向 tier C 的整条拒绝
- 渲染器复核：`MEMORY.md` 解析→渲染字节相同、`sectionDropped 0 / itemTruncated 0`、114 条目无超 800 上限、`loadMemory` 报 `truncated=false`
- `CONTEXT.md` 的 roundtrip 报告 17 项、0 超限、字节相同；三处编辑分别去掉漂移行号、删掉已满足条目、换成持久 headroom 注意项
- 旧串（`align handoffBudgetRecentTokens: 0`、`comments still describe that world`、pid/端口、已完成的修正任务）全部 0 次，新串各 1 次，无重复句
- 修正提交 `3770f06 docs(memory): correct the stale profile handoff-budget claim` 已推送，`main` 与 `origin/main` 齐平、工作区干净、技能目录无漂移
- 宿主 socket holder 启动早于批次 W 提交，故新 `lib/` 未在跑；本批行为等价，没有功能缺口
- 自动交接状态：本轮越阈值但走 `skip(nothing-to-drop)`，因为 `handoffBudgetRecentTokens: 20000` 的 recent 窗口覆盖了整个会话
- 两个 profile 的 `handoffPendingQuestion: wait` 与 `handoffBudgetRecentTokens: 20000` 已现场重新核实；desktop 行号已漂到 1947，证明 settings 层会重写该文件

## Open tasks

- 用户决定是否重启宿主（desktop/web）以让批次 W 的模块拆分真正在跑；行为等价，可选，重启脚本是用户操作
- `MEMORY.md` 仍在 `maxMemoryChars` 的 98% 附近：下次写入前先压缩，用等长或更短的整行替换，不要追加
- rc.3 online re-probe：等 profile 与 wrapper 真的切到 0.2.1-rc.3 后再做，读 `modelsTimeoutMs` 与列举条目里 `contextWindow` 的生效值而不是目录值
- 是否清理 desktop profile 那条 `disabled: true` 行上残留的 `backgroundMode: one-shot`（无行为影响，纯清理）
- 是否为批次 U 补一条 `.agents/evidence/` 上线证据记录
- 上一轮那次瞬时 2 条测试失败仍判为并发写入撞上 `context-injection.test.mjs` 读仓库自身 memory 文档，未记成已修；代码此后未变、三连跑复绿

<!-- latest-session-title: 批次 W 收尾：自动整理落盘、陈旧 profile 记忆修正与文档复核 -->
