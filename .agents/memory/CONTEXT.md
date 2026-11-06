# Project Context

Last updated: 2026-11-06T02:10:31.485Z

## Summary

本会话接续「设置卡三处一致性修复」，两批已提交推送：`dfe4f34` 与 `30e0ba1`（文档 `1df17e4`）。第一批修三处：摘要目标行改名「摘要目标（仅报告）」并给卡片加模式门（固定比例行与摘要目标行按 `handoffThresholdAuto` 互斥渲染）；比例折叠收进 `src/shared/ratio.ts` 由命令与卡片共用；「保存未生效，请重试」改成点名真正能救场的两个动作。独立只读审查回来 15 条、无阻塞，其中一条是我引入的真 bug：门读格式化草稿，而 `Reset` 暂存 `format(undefined)`、写入却是 `unset` 并重新继承默认 `true`，按重置会让卡片显示与实际保存相反的模式，已改为读「待写入后的有效模式」。第二批接审查与用户四项要求：两个预算金额的边界收进 `limits.ts` 并在卡片本机校验，越界不再走一遍「保存未生效」；保存失败按成因分文案（比较首次编辑时的文档 revision）；README 删掉已退役的 `handoffThinking` 两行并改掉两处同类假声称。门禁本轮现跑全绿，8 个变异全杀。记忆侧：用户选择了压缩，`MEMORY.md` 已从 39696 压到 37780 字符（余量 2220），合并 8 组重复条目并删掉 3 条封闭批次细节，每条规则的实质都保留；写回走插件渲染器，复验 `itemTruncated 0`、round-trip 字节相同。宿主仍是 11-06 09:26:43 启动的 pid 41218，早于最后代码提交 `30e0ba1`（09:59:03），重启待用户执行。此前各轮（批次 W、SH-1 拆除、rc.5→0.2.2 相容性审计、`docs/harness/` 接口面登记）的细节见 Key points、`CHANGELOG.md` 与 `docs/harness/`。

## Key points

- 批次 W 已在此前会话提交并推送为 `e3459c6 refactor(handoff): split the automatic trigger's decision into a pure seam (batch W)`（20 个文件），本轮只剩记忆文档收尾
- 插件 21:32 自动整理写出的 `CONTEXT.md` 未提交；经 `roundtrip.mjs` 验证为安全不动点后原样提交为 `48be67c docs(context): land the 21:32 automatic memory pass`
- `MEMORY.md` 有两处陈述陈旧：称两个 profile 仍是 `handoffBudgetRecentTokens: 0`、称两处注释仍描述旧世界；现场核实 web 与 desktop 都是 `20000`，web 注释也已改写
- 两处按整行替换修正（净减字符），未追加，因为文档已在 `maxMemoryChars` 的 98% 上；追加会把它推向 tier C 的整条拒绝
- 渲染器复核：`MEMORY.md` 解析→渲染字节相同、`sectionDropped 0 / itemTruncated 0`、114 条目无超 800 上限、`loadMemory` 报 `truncated=false`
- `CONTEXT.md` 的 roundtrip 报告 17 项、0 超限、字节相同；三处编辑分别去掉漂移行号、删掉已满足条目、换成持久 headroom 注意项
- 旧串（`align handoffBudgetRecentTokens: 0`、`comments still describe that world`、pid/端口、已完成的修正任务）全部 0 次，新串各 1 次，无重复句
- 修正提交 `3770f06 docs(memory): correct the stale profile handoff-budget claim` 已推送，`main` 与 `origin/main` 齐平、工作区干净、技能目录无漂移
- 自动交接状态：本轮越阈值但走 `skip(nothing-to-drop)`，因为 `handoffBudgetRecentTokens: 20000` 的 recent 窗口覆盖了整个会话
- 两个 profile 的 `handoffPendingQuestion: wait` 与 `handoffBudgetRecentTokens: 20000` 已现场重新核实；desktop 行号已漂到 1947，证明 settings 层会重写该文件
- `codex-project-context` 是 Python 实现（`hooks/context_hook.py` 入口 + `scripts/contextctl.py` 单文件约 93 KB，七个 hook 事件），与 TypeScript 的本仓库形态完全不同，但产出同构的 `.agents/memory/{MEMORY,CONTEXT,HANDOFF}.md` 与 `session-logs/`
- 它此前只存在于 `/tmp/codex-pc-probe` 与 `/tmp/codex-pc-verify`（重启即丢），且 `MEMORY.md`、`CONTEXT.md`、`docs/`、`CHANGELOG.md` 都没有它的记录，只有 10-31 的会话归档提到过；这是真实的记忆缺口
- 归位后新克隆与 `/tmp` 两份克隆的 `HEAD^{tree}` 三者相同（`e0014d8`，HEAD `374c593`、16 个跟踪文件、无 tag），远端 `master` 也仍是 `374c593`，`/tmp` 副本可直接丢弃
- `docs/sibling-repos.md` 是这类跨仓事实的新归宿：三库路径/远端/分支/语言/驱动方式/首次提交，外加「所有会漂的值现读、别引用快照」的复核命令
- `MEMORY.md` 的 Index 记录已从只讲 pi 改成并列 `pi-project-context` 与 `codex-project-context` 并指向该文档；改后 Index 回到硬预算内；2026-11-06 按用户决定压缩一轮，39696 → 37780 字符，四节全回硬预算内
- 宿主 2026-11-06 09:26:43 重启后为 pid 41218 / 端口 35209（`0.2.2-rc.1`）；桌面端口每次重启都变，探针不传 `--url` 会以 `fetch failed` 假失败
- 批次 W 的三段验收全绿：宿主启动晚于最后 `src/` 提交 `e3459c6`；`tsc --outDir /tmp/libcheck` 后 `diff -rq` 只剩 `client.js`；线上探针四个插件行 `active`、store == wrapper、`RESULT: PASS`
- 换版相容性（以 shipped 源码为准，本轮无 rc.5/0.2.2-rc.1 专页）：`snapshot(session, keys)` 只算选中单元与我们的显式 keys 一致；`SessionSummary.origin/cwd`、`LlmResolvedModelInfo.context` 形状未变；我们不给辅助调用传 `purpose`，故声明化变更不适用
- desktop profile 的 `disabled: true` 行只剩 `- id: subagent-codex-tool` + `disabled: true`，旧的 `backgroundMode: one-shot` 残留已被 settings 层重写掉（该文件行号会随 settings 重写漂移，grep 键别记行号）
- 证据文档 `.agents/evidence/2026-11-05-rc5-to-022rc1-compat-audit/README.md` 记了判据、逐面核对表、可闭任务与范围（不是全量 delta）
- 类型面缺口已补：`run-probe.sh` 把六个 dsh 包映射到 store 树后 `tsc` 两半全绿（host `exit=0 errors=0`、client 同），且 `missing: (none)`
- 绿不是构造性的：`--traceResolution` 显示 host 21/21、client 94/94 个模块全部解析自 store 树、0 个落 `node_modules`；把 `@deepseek-ai/dsh-session` 错指到 `dsh-llm` 的类型上立刻 38 个 error 变红，映射是承重的
- 同一探测打在上一版 `0.2.1-rc.5` 也全绿，故 rc.5 → 0.2.2-rc.1 没有我们调用面能看到的类型断裂，不是「侥幸没撞上」
- peer 门禁用宿主自己的 `evaluatePluginCompatibility` 真调用（`dsh-app-boot/lib/index.js`）：`engines.dsh` 缺失故走 peer 路径，六个 `>=0.1.7-rc.2` 在 `0.2.2-rc.1` 下全满足（返回 `undefined`）；伪造 runtime `0.1.0` 的负控制报六个未满足。`@deepseek-ai/cordis` 与 `schemastery` 虽是 peer 但不参与该判定（只查 `@deepseek-ai/dsh` / `dsh-*`）
- 本轮证据落 `.agents/evidence/2026-11-05-dsh-022rc1-api-compat/`：探针日志、两半解析溯源、两个负控制、peer 门禁、dump-config 与在线清单，复核命令在 README 第 9 节
- `.agents/skills/dsh-runtime-line-delta-audit/` 是 autolearn 于 10:00 自动生成的技能（带 `autolearn-generated` 标记），会话开始时工作区还是干净的，故随本轮一起提交
- `docs/harness/` 按宿主分文件登记状态机与接口面（`dsh.md` / `pi.md` / `codex.md`），`integration.md` 单独承载「接哪些接口、哪些是真 shim」的决定——事实与决定不混在一份文档里
- `docs/harness/` 的每条事实都回源核对过，其中纠掉一条想当然：pi 的 `session_before_compact` 返回 `{cancel:true}` **取消**压缩（`manual` 与 `overflow+willRetry` 例外），并不写 `HANDOFF.md`
- codex 侧零模型/网络调用（`grep -c` 为 0），靠 `Stop` 返回 `decision: block` 把整理交回宿主 agent 执行——所以「整理失败」的归因在三边根本不同（模型失败 / 扩展异常 / 宿主没执行命令）
- `integration.md` 也登记了我们**没有**接入的面：dsh 的 `tools/pre-execute` 在 `src/` 为 0 命中，登记它正是为了避免下次被当成「已接」；dsh 更没有「压缩前」钩子，只有 `compaction/summary-error`
- 真 shim 只剩 2 条且全在 dsh 侧（`SH-2` `ctx.get` 读未声明服务 / `SH-3` `isTopLevel`）；`SH-1` 结构化投影视图已于 2026-11-05 拆除，`SH-4`/`SH-5` 撤销 shim 身份（`interpolate` 是文档化选项、默认 `true`），pi / codex 自己的适配层已移出本仓
- `SH-1` 已落地拆除（2026-11-05）：`src/project-handoff/runtime.ts` 的 `SessionProjectionsLike` 删除，改由 `dsh-session-projection` 声明服务类型、`dsh-token-meter` 提供 `contextBreakdown` 键的 augmentation——两者缺一不可，去掉后者键类型直接塌成 `never`；两个包只进 `devDependencies`（`0.1.7-rc.2`，不进 peer，因为服务可选、必须能优雅降级）；判别器 `test/projection-typing.test.mjs` 两侧对照都开火（去掉 import → 正控制挂；读取降级成 `any` → 判别器挂），3 个 mutator 全杀，门禁 477/477；证据在 `.agents/evidence/2026-11-05-sh1-removal/`
- 预检说「`peers check` 输出 `No peer dependency issues found`」在真实仓库里不成立：那条跑在干净 `/tmp`，pnpm 自解析到 cordis 4.0.5；真实锁文件钉 `cordis 4.0.2` 而 `dsh-agent@0.1.7-rc.2` 要 `~4.0.4`，HEAD 状态同样报 2 条（`cordis`、`schemastery`）。正确说法是「新增 0 条未满足的 peer 名」，判据要拿 HEAD 三件套在 `/tmp` 跑一遍再 diff，别直接引用预检数字
- 环境陷阱：`/mnt/Data` 是 NTFS（`stat -f` 报 `0x7366746e`），装依赖时文件会丢在 **store → `node_modules` 的链接环节**，store 本身完好（`pnpm store status` 报 untouched，按 sha512 能查到 blob）—— 2026-11-05 一次 `install` 后 `zod@4.6.2` 缺 6 个 `.js`/`.d.ts`，9 个测试文件 import 即崩；判据是拿锁文件 `integrity` 校验过的上游 tarball 逐文件哈希比对，不是 `diff -rq`（嵌套差异会假绿）
- 三边接口面完整数字（现读命令在 `docs/harness/README.md` §4）：dsh 63 个事件（我们注册 6）、pi 41 个事件 + 33 个方法（扩展注册 6）、codex 7 个 hook（全用）
- 批次 U 的上线证据已补：`.agents/evidence/2026-11-05-batch-u-live-carry/`，扫 141 个交接种子 —— 130 个批次 U 前的种子**完全没有 carry 行**（阴性对照），11 个批次 U 后的种子全是 `trimmed` 且每条正文有 11–23 处 `[...truncated...]` 见证，其中 3 个由当前宿主产出（`09:59` / `10:30` / `10:58`，含本会话）；`carried` 与 `nothing` 无生产样本，`nothing` 在 `handoffBudgetRecentTokens: 20000` 下不可达
- 判据陷阱：**展示层横幅不等于 store 原文** —— 交给模型的那份文本把 trimmed carry 行重排成「已原文带入…；过长的…裁剪」的合并句，而同一会话 store 里是干净的 `continuationTrimmed`；判断种子一律读 `session.v4.jsonl.zstd`，不读对话窗口文本
- 本轮两批：`dfe4f34`（模式门 / 比例三种写法 / 保存失败文案）与 `30e0ba1`（预算金额本机边界 / 失败按成因分文案），文档 `1df17e4`；另 `a33f186` 落 autolearn 的 `dsh-declared-type-shim-removal` 技能、`19ff745` 订正 CHANGELOG 的变异描述。`HEAD == origin/main == 1df17e4`，工作区干净，技能目录 29/29 与索引一致
- `client/card-fields.ts` 的 `FieldRow.appliesWhen` + `rowVisible()`：固定比例行只在 `handoffThresholdAuto` 关闭时渲染、摘要目标行只在开启时渲染；三道例外（存储层有覆盖值 / 有暂存草稿 / 非法草稿）保留该行——否则被隐藏的值无法重置，非法草稿还会挡住保存而没有控件可修
- 门读「待写入后的有效模式」而非格式化草稿：有暂存 `set` 用草稿，否则用 Host 给的已解析值；`Reset` 暂存 `format(undefined)` → `"false"` 而写入是 `unset` 并重新继承默认 `true`，按草稿判定会让预览与保存相反（独立审查发现的真 bug，已修 + 回归用例）
- 门不是永久的：某行保存过一次就带用户层覆盖值，此后两种模式下都显示（否则无法重置）；README / CHANGELOG / 注释的措辞已从「互斥」收紧为「除非该行带覆盖值或非法草稿」
- `parseRatioInput`（`src/shared/ratio.ts`）是比例的唯一边界折叠实现，命令 `parseRatio` 与卡片 `ratio` 行共用；`0.4` / `40` / `40%` 等价，边界只来自 `limits.ts` 的 `MIN/MAX_THRESHOLD_RATIO`
- 两个预算金额的边界收进 `limits.ts`（summary 8000–200000、recent 0–200000），`settings.ts` schema、`config.ts` 的 `bounded()`、`/handoff budget` 解析、卡片 `boundedNumberField` 四处共用；`0` 仍合法（只带摘要）
- 保存失败按成因分文案：平台只给一个 `failed` 布尔，故用文档 revision 作可观测信号——记首次编辑时的 revision，失败后比较，没动 = 值被 Host 拒绝、动了 = 并发写入；两者都不可重试，文案分别给「改值重存」与「刷新页面重建草稿」，revision 不可观测时退回合并文案
- 门禁本轮 10:02 现跑：`pnpm typecheck` 0、`pnpm test` 491 通过 / 0 失败、`pnpm build` 0（`lib/client.js` 35579 字节）、变异标记 0；`pnpm test` 现在也跑客户端 `tsc`
- 变异轮共 8 个全杀（每次从哈希快照还原并逐字节复验）：M1 反向门→2 条模式用例红；M2 `Number(text)` 直通→3 条比例用例红；M3 删 `>1` 折算→卡片用例加 `logic.test.mjs` 的 `parseRatio`/`settingPatch` 一并红；M4 旧文案→只有文案门红；M5 hint 写法→只有 hint 门红；N1 去本机边界→2 条边界用例红；N2 成因塌回单布尔→只有成因用例红；N3 门改回读草稿→只有 `Reset` 预览用例红
- 独立只读审查 15 条、无阻塞：两条 should-fix（措辞不持久、Reset 预览相反）已修；其余是声称不准与门禁缺口（`numeric` 行此前无测试、README 两处退役行、README 把「触发计算不读」写成「校验不读」）已一并改
- 宿主判据（本轮 10:00 现读）：pid 41218 / 端口 35209，启动 2026-11-06 09:26:43，晚于 `4affcbe`（SH-1 拆除，11-05 23:30）但早于最后 `src`/`client` 提交 `30e0ba1`（11-06 09:59:03）→ 本批两批**未上线**；重启是用户动作，脚本在 dsh 会话内会 exit 3

## Open tasks

- 宿主重启（用户执行）：`/etc/nixos/scripts/dsh-desktop-restart.sh`；验收 = 新 pid 启动时间晚于 `30e0ba1` 的 11-06 09:59:03、且 `git -C /mnt/Data/Projects/dsh-project-context diff --exit-code -- lib` 为空；界面验收：自动交接段默认只有「自适应阈值 + 摘要目标（仅报告）」，关掉自适应后两者互换（在「自适应阈值」上按重置不应触发互换），固定阈值填 `40` / `40%` 存成 `0.4`，预算金额填 `7999` 时保存按钮直接灰掉
- `MEMORY.md` 已压到 37780/40000（余量 2220），四节都在硬预算内、round-trip 是不动点；下一次自动整理应能落地——若仍被 tier C 拒绝，说明模型的重写比输入增长超出这 2220 字符，届时再压一轮或接受它持续拒绝
- 比例行在触屏上打不出 `%`：平台只提供 `numeric` 布尔 → `inputMode="numeric"`，hint 里的 `40%` 在触屏不可达；要改只能动平台
- 保存失败的两种成因只在 revision 可观测时才能分开；不可观测时仍退回合并文案（平台只给一个 `failed` 布尔）
- `MEMORY.md` 的余量靠整行替换维护，不靠追加：增长型写入前先跑 `share-fit.mjs` 看分节占用（`Index` 最容易顶到硬预算），任何写入后用 `loadMemory` + `isMemoryTruncated` 复验，不要 grep 标记
- 记忆里「dispose 插件要手工清 `dsh.profile.bundles`」是 loader 1.0 之前的整树回写行为：`0.2.2-rc.1` 的 Include 只把运行时改动写回父 patches，下次真正 dispose 插件时要先重新核实这条再照做
- 上一轮那次瞬时 2 条测试失败仍判为并发写入撞上 `context-injection.test.mjs` 读仓库自身 memory 文档，未记成已修；代码此后未变、三连跑复绿
- 全仓完整性审计已于 2026-11-05 做完（`.agents/evidence/2026-11-05-pnpm-store-integrity-audit/`）：73 个包逐文件哈希，修好 1 个代码文件（`dsh-package-manifest` 缺 `lib/index.js`，11 字节 `export {};`）与 25 个 LICENSE，复验 73/73 与上游一致；恢复只落在 `node_modules` 不入 git，下次 `install` 后若出现莫名 module-not-found，先重跑该目录的 `compare.mjs`，别先怀疑代码

<!-- latest-session-title: 设置卡按模式分行、预算本机校验、保存失败归因；MEMORY.md 顶到上限 -->
