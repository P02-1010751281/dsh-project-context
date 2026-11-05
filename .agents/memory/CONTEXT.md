# Project Context

Last updated: 2026-11-04T14:36:33.350Z

## Summary

本会话接手批次 W（交接自动触发的决策 seam）之后的收尾工作。先核对磁盘真态：批次 W 的代码、测试、规格与审计已于上一会话提交并推送（`e3459c6`），但插件在 21:32 自动整理写出的 `CONTEXT.md` 仍留在工作区未提交。用现成的 `roundtrip.mjs` 验证该文档是安全不动点（17 项、0 超 800 上限、字节相同）后原样提交为 `48be67c`。随后处理两处陈旧记忆：`MEMORY.md` 第 52 行称两个 profile 仍「align `handoffBudgetRecentTokens: 0`」，第 53 行称两个 profile 的注释仍描述那个旧世界 —— 现场核实两个 profile 实际都是 `20000`（batch U 已改），web 卡片注释也已重写，两处都按整行替换改成与现状一致的表述。`CONTEXT.md` 同步改三处：`Summary` 去掉会随 settings 重写漂移的 profile 行号、删掉已被本次整理满足的 pid 陈旧 bullet、把已完成的「修正陈旧记忆」换成持续性的 `maxMemoryChars` headroom 注意项。验证走插件自己的渲染器而不是 grep：`MEMORY.md` 解析→渲染字节相同、`sectionDropped 0 / itemTruncated 0`、114 条目无超限、`loadMemory` 报 `truncated=false / damaged=0 / poisoned=false`（净减 39 字符）；`CONTEXT.md` roundtrip 字节相同（17 项）。旧串全部 0 次、新串各 1 次、无重复残留。修正提交 `3770f06` 推送后 `main` 与 `origin/main` 齐平，工作区干净，技能目录无漂移。宿主侧仍跑批次 W 之前的代码（socket holder 启动早于本批提交），但本批是行为等价重构，没有功能缺口，是否重启留待用户决定。本轮还观察到一次自动交接的跳过：上下文越过阈值但走出 `skip(nothing-to-drop)` 分支，因为 recent 窗口已覆盖整个会话。接着回答「三个库」：本地只有 `dsh-project-context` 与 `pi-project-context` 两个 checkout，第三个 `codex-project-context` 此前只被克隆到 `/tmp` 做只读勘查、从未归位，记忆与 `docs/` 里也都没有它。已从 Forgejo 正式克隆到 `/mnt/Data/Projects/codex-project-context`，新克隆的树对象与 `/tmp` 两份既有克隆三者完全相同，并新建 `docs/sibling-repos.md` 记录三库的归属、形态与复核命令；`MEMORY.md` 的 Index 里那条只讲 pi 的记录改成并列两个同族仓库并指向该文档（+30 字符）。另外发现 22:36 那次整理其实也重写了 `MEMORY.md`（+571 字符、114 → 121 条目），整行替换式核对为安全不动点后单独落盘。夜间宿主被用户换版重启（`0.2.1-rc.5` → `0.2.2-rc.1`，启动 09:53:41、pid 250828、端口 32891），批次 W 因此真正生效：按 skill 的三段判据逐条验收——宿主启动晚于最后 `src/` 提交、`tsc` 重编译到临时目录后 `diff -rq` 只剩 `client.js`、线上探针四个插件行全 `active` 且 `RESULT: PASS`。随后以运行中 store 的 shipped 源码核对换版对我们六个 API 面的影响，结论落成 `.agents/evidence/2026-11-05-rc5-to-022rc1-compat-audit/README.md`；顺带关掉两条 open task（重启已由用户完成、`backgroundMode` 残留已被 settings 层重写掉）。本轮接着补上那份审计明确留下的唯一空缺——类型级对照：用 `run-probe.sh` 把六个 dsh 包映射到运行中 store 树的 `lib/types` 再跑 `tsc`，两半全绿且 `missing: (none)`；`--traceResolution` 证明 host 21/21、client 94/94 个模块确实解析自 store 树（0 个落 `node_modules`），再以「把 `dsh-session` 错指到 `dsh-llm` 类型上」的负控制打出 38 个 error，证明绿不是构造性的。同一探测打在上一版 `0.2.1-rc.5` 也全绿；peer 门禁改用宿主自己的 `evaluatePluginCompatibility` 真调用（另含伪造 runtime `0.1.0` 的负控制）。证据与复核命令落 `.agents/evidence/2026-11-05-dsh-022rc1-api-compat/`。另外 autolearn 在 10:00 自动产出了 `dsh-runtime-line-delta-audit` 技能，随本轮一起提交。

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
- `codex-project-context` 是 Python 实现（`hooks/context_hook.py` 入口 + `scripts/contextctl.py` 单文件约 93 KB，七个 hook 事件），与 TypeScript 的本仓库形态完全不同，但产出同构的 `.agents/memory/{MEMORY,CONTEXT,HANDOFF}.md` 与 `session-logs/`
- 它此前只存在于 `/tmp/codex-pc-probe` 与 `/tmp/codex-pc-verify`（重启即丢），且 `MEMORY.md`、`CONTEXT.md`、`docs/`、`CHANGELOG.md` 都没有它的记录，只有 10-31 的会话归档提到过；这是真实的记忆缺口
- 归位后新克隆与 `/tmp` 两份克隆的 `HEAD^{tree}` 三者相同（`e0014d8`，HEAD `374c593`、16 个跟踪文件、无 tag），远端 `master` 也仍是 `374c593`，`/tmp` 副本可直接丢弃
- `docs/sibling-repos.md` 是这类跨仓事实的新归宿：三库路径/远端/分支/语言/驱动方式/首次提交，外加「所有会漂的值现读、别引用快照」的复核命令
- `MEMORY.md` 的 Index 记录已从只讲 pi 改成并列 `pi-project-context` 与 `codex-project-context` 并指向该文档；改后 39980 字符，仍是安全不动点，距 `maxMemoryChars` 只剩 20
- 宿主 2026-11-05 09:53:41 换版重启：`0.2.1-rc.5`（pid 249231 / 端口 35837）→ `0.2.2-rc.1`（pid 250828 / 端口 32891）；桌面端口每次重启都变，探针不传 `--url` 会以 `fetch failed` 假失败
- 批次 W 的三段验收全绿：宿主启动晚于最后 `src/` 提交 `e3459c6`；`tsc --outDir /tmp/libcheck` 后 `diff -rq` 只剩 `client.js`；线上探针四个插件行 `active`、store == wrapper、`RESULT: PASS`
- 换版相容性（以 shipped 源码为准，本轮无 rc.5/0.2.2-rc.1 专页）：`snapshot(session, keys)` 只算选中单元与我们的显式 keys 一致；`SessionSummary.origin/cwd`、`LlmResolvedModelInfo.context` 形状未变；我们不给辅助调用传 `purpose`，故声明化变更不适用
- desktop profile 的 `disabled: true` 行现在只剩 `- id: subagent-codex-tool` + `disabled: true`（`cordis.patch.yml:1114`），旧的 `backgroundMode: one-shot` 残留已被 settings 层重写掉
- 证据文档 `.agents/evidence/2026-11-05-rc5-to-022rc1-compat-audit/README.md` 记了判据、逐面核对表、可闭任务与范围（不是全量 delta）
- 类型面缺口已补：`run-probe.sh` 把六个 dsh 包映射到 store 树后 `tsc` 两半全绿（host `exit=0 errors=0`、client 同），且 `missing: (none)`
- 绿不是构造性的：`--traceResolution` 显示 host 21/21、client 94/94 个模块全部解析自 store 树、0 个落 `node_modules`；把 `@deepseek-ai/dsh-session` 错指到 `dsh-llm` 的类型上立刻 38 个 error 变红，映射是承重的
- 同一探测打在上一版 `0.2.1-rc.5` 也全绿，故 rc.5 → 0.2.2-rc.1 没有我们调用面能看到的类型断裂，不是「侥幸没撞上」
- peer 门禁用宿主自己的 `evaluatePluginCompatibility` 真调用（`dsh-app-boot/lib/index.js`）：`engines.dsh` 缺失故走 peer 路径，六个 `>=0.1.7-rc.2` 在 `0.2.2-rc.1` 下全满足（返回 `undefined`）；伪造 runtime `0.1.0` 的负控制报六个未满足。`@deepseek-ai/cordis` 与 `schemastery` 虽是 peer 但不参与该判定（只查 `@deepseek-ai/dsh` / `dsh-*`）
- 本轮证据落 `.agents/evidence/2026-11-05-dsh-022rc1-api-compat/`：探针日志、两半解析溯源、两个负控制、peer 门禁、dump-config 与在线清单，复核命令在 README 第 9 节
- `.agents/skills/dsh-runtime-line-delta-audit/` 是 autolearn 于 10:00 自动生成的技能（带 `autolearn-generated` 标记），会话开始时工作区还是干净的，故随本轮一起提交

## Open tasks

- `MEMORY.md` 已在 `maxMemoryChars` 的 99.95% 上（39980 / 40000，余量 20）：下次任何增长型写入都会触发 tier C 的整条拒绝，必须先用等长或更短的整行替换腾出空间，不要追加
- 记忆里「dispose 插件要手工清 `dsh.profile.bundles`」是 loader 1.0 之前的整树回写行为：`0.2.2-rc.1` 的 Include 只把运行时改动写回父 patches，下次真正 dispose 插件时要先重新核实这条再照做
- 是否为批次 U 补一条 `.agents/evidence/` 上线证据记录
- 上一轮那次瞬时 2 条测试失败仍判为并发写入撞上 `context-injection.test.mjs` 读仓库自身 memory 文档，未记成已修；代码此后未变、三连跑复绿

<!-- latest-session-title: 0.2.2-rc.1 换版重启：批次 W 上线验收与相容性核对 -->
