# Project Context

Last updated: 2026-11-06T02:58:25.992Z

## Summary

本会话由 session-4ec44b0b 交接。此前两轮：① 记忆预算离线实测 —— 宿主 pid 41218 启动早于最后 `src/` 提交 `30e0ba1`，故走离线路径；budget 半边清空、output 半边 `needed` 29941 < 32768 不裁剪、上限临界 43000 不裁剪、43500 起 `clipped true`；重启后三条机器判据全过，`dfe4f34` 与 `30e0ba1` 生效。② 用户报「README 怎么有这么长段的文字」，README 446 → 141 行，机制搬进 `docs/{architecture,behavior,settings,development}.md`（`1e3f675`）。本轮按用户选定的「2 + 3」继续整理：18 个 `docs/batch-*.md` 用 `git mv` 进 `docs/archive/`，新增 `docs/README.md` 当唯一索引；`CHANGELOG.md` 1719 行按版本拆成 8 份 `docs/changelog/v*.md`（正文逐行相等，主文件只剩未发布 + `## 版本目录`）；46 行 `docs/batch-*` 引用改成 `docs/archive/batch-*`，`.agents/evidence/` 是冻结证据、旧路径有意不回改。`src/`/`client/`/`lib/` 零改动，不需要重启。本轮另按仓库技能 `repo-guidelines-doc` 交付两份治理文档：`AGENTS.md`（导览）与 `RULES.md`（准则），详见 Key points。

## Key points

- 交接自 session-17738a1d；本轮无队友在跑（`list_agents` 只有 lead）
- 加载判据：宿主 pid 41218 启动 09:26:43 早于最后 `src/` 提交 `30e0ba1`（09:59:03），故离线判定是唯一可行路径
- 离线探针跑的是宿主真正加载的 `lib/`，不是 `src/`；`git diff --exit-code -- lib` 为空
- budget 半边实测清空：`sectionDropped 0 / droppedItems 0 / itemTruncated 0`，round-trip 字节相同
- output 半边：`needed` 29611（按当时 CONTEXT 9820）/ 29941（按 10314）均 < 32768，`clipped false`
- 上限定值：真实 CJK 密度 0.4014 tok/char 下，`maxMemoryChars` 40000 → needed 31146，43000 → 32732（不裁剪），43500 起 `clipped true`
- 模型目录 `auto/deepseek-v4.1-flash` 的 `maxTokens: 328000` 决定 `defaultMaxTokens`，不承重；真正决定 `clipped` 的是配置 `maxOutputTokens: 32768`（schema 默认，两个 profile 都没覆盖）
- 整理 prompt 明确告知上限：`memoryBudgetRule` 原文含「must stay at or under 40000 characters… currently about N」，故拒绝不是「没告诉模型」
- journal 量出的成熟期（输入 ≥34000）落地涨幅 n=7：-156 / +532（中位）/ +908 / +669 / +455 / +3475 / -734（本轮），2/7 超过现在只剩的 413 余量 → 下一次仍可能是概率事件
- 自检假绿一：把已渲染过的文本再喂渲染器，必然报 `sectionDropped 0`（损失在第一次渲染就被吃掉）；须构造真正超限的文档字符串，此时 budget 分支翻红 `sectionDropped 1 / droppedItems 36`
- 自检假绿二：`MemorySections` 的键是小写标题（`project` 而非 `Project`），照 `share-fit.mjs` 写法才对齐，否则分节条目数全 0
- 重启验收判据一：新 pid 58434、启动 2026-11-06 10:51:25，晚于最后 `src/` 提交 09:59:03
- 重启验收判据二：`node /etc/nixos/scripts/dsh-live-inventory-probe.mjs --url http://127.0.0.1:33647 --expect …` 四行全 `active`、enabled 但非 active 0、store == wrapper（p9lpls1…-dsh-desktop-0.2.2-rc.1）、`RESULT: PASS`、exit 0；条目总数 241
- 重启验收判据三：`tsc --outDir /tmp/libcheck2` 后 `diff -rq lib` 只差 `client.js`（esbuild 产物）；该 bundle 含 `appliesWhen` 4 / `rowVisible` 2 / `parseRatioInput` 2 / `boundedNumberField` 2
- 结论：`dfe4f34`（模式门 / 比例三种写法 / 保存失败文案）与 `30e0ba1`（预算金额本机边界 / 失败按成因分文案）两批代码现已生效
- 10:13:33 的那次拒绝：`3 whole entry(ies) … from 2 section(s)`，重试自身死于 `cannot get required service "llm" in inactive context`，故首稿损失生效、`MEMORY.md` 保持字节不变
- 该次拒绝读到哪一版文档**未决**：mtime 10:10:04 早于拒绝只是必要条件（一次 pass 含至多两次模型调用，可跨数分钟）；请求体不落盘、台账按会话聚合、宿主只写 crash log，三处决定性证据都不存在
- 判别锚点：`MEMORY.md` 自 10:10:04 未再变动，故 10:51 重启后的任何一次拒绝都无歧义对应 37780
- 10:58:25 那一次 pass 已落地（journal `op: replace`、39216 字符、`MEMORY.md` 与 `CONTEXT.md` 同时重写），是重启（10:51:25）后的第一次，故按判别锚点它无歧义读的是 37780 那版 —— 先前的拒绝是「模型没能压住」，不是文档太大
- 本轮三笔提交均 docs-only：`4f6385c`（`2026-11-06-memory-compression-headroom/` 的 README + probe.mjs，含 CONTEXT 更新）、`ea5e8cf`（重启验收 + 拒绝事实）、`713d81f`（把「跑在压缩后文档上」改回未决 + 锚点）
- `HEAD == origin/main == 713d81f`，工作区干净，技能目录 29 未动，重启判据未被移动（仍是 09:26:43 那代的代码提交时间对照）
- 当前文档（2026-11-06 20:58 实测）：`MEMORY.md` **39587** 字符（10:58 pass 后 39216，本轮两处不变量改写后 39587，余量 413 / 40000）、`CONTEXT.md` **8169** 字符；渲染器复核 `sectionDropped 0 / droppedItems 0 / itemTruncated 0`、round-trip 字节相同；output 半边 maxTokens **28922** < 32768 `clipped false`
- 条目上限：`MEMORY.md` 超 800 的条目 0、最长 788；`CONTEXT.md` 超 800 的条目 0、最长 423（Key points 节）
- 探针产物：`.agents/evidence/2026-11-06-memory-compression-headroom/README.md` + `probe.mjs`（`--self-test`，退出码 0 清空 / 1 丢数据 / 2 无法判定 / 3 自检未开火），README 已补实测结局与「输入版本未决」段
- 宿主为 `0.2.2-rc.1`，GUI 端口每次重启都变（本轮 35209 → 33647），探针不传 `--url` 会以 `fetch failed` 假失败
- 本批主提交 `31f19b5`（docs-only：18 个批次档案归档、CHANGELOG 拆成 8 个版本文件、46 行引用改写、两项技能同步），推送时 `ssh.github.com` 前三次报「无法读取远程仓库」、第四次成功（瞬时故障，非权限）
- 21:15 起交付治理文档：`AGENTS.md` 115 行 8 节（概览 / 架构与数据流 / 关键目录 / 开发命令 / 代码约定 / 重要文件 / 运行时 / 测试与 QA，62 个 `path:line` 锚点全部可 resolve）、`RULES.md` 74 行 8 章（元规则→禁令，判据命令逐条实跑）；README 文档分工加了两份的指针。口径由用户确认：团队=**单人 + AI agent**（无人工 review、无 CI）；仓库**没有 CLAUDE.md**，RULES 的协作基线反推自 README/docs/MEMORY/skills。
- AGENTS.md 由 4 个只读 scout 并行调查 + 我亲核 5 个承重文件后合成，已修正 scout 三处：会话归档目录 174→**172**、`void…catch` 的「42 处」未采用（实测 21 个 `void`、8 个带 catch）、`test/` 口径「33 个 node:test」→ 29 个 `*.test.mjs` + 1 helper + 3 fixture。RULES 的 `src`/`client` 单文件 ≤900 行是**新定天花板**（现存最大 809），不是历史规则；4.2 的 `shared → project-handoff/language` 是现存唯一反向依赖例外。
- `maxMemoryChars` 是**读写同一把尺**（注入 `projectMemoryInjection` → `loadMemorySync`、整理读入 `loadMemory` 都用它），不是「写入前生效」：实测 39587 字符的 MEMORY.md 在 cap 18000 下注入侧只剩 17625 字符，**Pitfalls 35 条 + Index 13 条整节消失**、隐藏 22019 字符（裁剪保头部，文档顺序 Project→Invariants→Pitfalls→Index），下一轮 pass 会把截断视图写回且 tier C 不拒（`sectionsFromMarkdown` 缺节返回 `undefined`，回归报告只写 `skipped: the stored memory is not a plain four-section bullet document`，把成因误归为文档形状）。顺序只能先写小文档再降 cap
- 64K / 128K 结论（2026-11-06 实测，已落 `docs/settings.md` 新增「小窗口」节 + `.agents/evidence/2026-11-06-small-window-presets/`）：128K 阈值恒 `107616`（84%）、与 keep 和文档大小无关，现有配置不用改；64K 容量项恒 43616，今天 overhead 27842 → `keep` 必须 ≤ 7774，默认 20000 **直接不可用**（window-headroom）、8000 差 226（drop-floor）、4000 可用但只留 15774 tokens 给对话；且整理 pass 自己也撞窗（cap 40000 + 25000 字符对话块 ≈ 66854 > 64000），压 `maxOutputTokens` 会让 `fitMemoryInput` 头尾各剪一刀（实测剪 25035 + 6112 字符），小窗口唯一的零损杠杆是把文档压小

## Open tasks

- 下一次 pass 的余量只剩 413 字符（39587 / 40000），而成熟期实测 2/7 的涨幅超过它；若再被拒，日志措辞分流不变：`N section(s) exceeded their budget` / `whole entry(ies)` → budget 半边（须再压）；`cut off by the model output limit` → output 半边（此时降 `maxMemoryChars` 无用）
- 若再被拒，三条出路按代价排序：①再压（现在要压到约 36000 才留够余量，要删事实，须用户点头）②`maxMemoryChars` 提到 ≤43000（实测 43000 时 `needed` 32732 < 32768 不裁剪，43500 起 `clipped true`；代价是每轮注入多约 2000 tokens）③接受持续拒绝、记忆不再增长
- 界面验收：用户 18:01 实测报「关掉自适应后『摘要目标（仅报告）』消失」。我判定**比例行该隐藏、这行不该**（它是一项预算：命令任一模态都收、`config.ts` 任一模态都校验、唯一读点在自适应分支只做回执），已改回并在 `f90bbd5` 之后这一批里交付（CHANGELOG「模式门只留在固定比例行上」）：门只剩 `handoffThresholdRatio` 一行，摘要目标在两种模式下都显示。**已构建、且 bundle 已确认在派发**：2026-11-06 18:24 实测宿主派发的字节与磁盘 `lib/client.js` 逐字节相同（combo `rev=805a30a0ec8f`，前 35750 字节相同、只多 76 字节 sourceMappingURL 尾），机制是 host 挂着 `include:client-hmr` 统计轮询调 `rebuilt()`，故无需重启；请看固定模式下这一行是否出现（最多刷新一次）。其余三项仍待验：在「自适应阈值」上按重置不应触发互换；固定阈值填 `40` / `40%` 均存成 `0.4`；预算金额填 `7999` 时保存按钮直接灰掉
- 比例行在触屏上打不出 `%`：平台只提供 `numeric` 布尔 → `inputMode="numeric"`，hint 里的 `40%` 在触屏不可达；要改只能动平台
- 保存失败的两种成因只在文档 revision 可观测时才能分开；不可观测时仍退回合并文案（平台只给一个 `failed` 布尔）
- `MEMORY.md` 的余量靠整行替换维护，不靠追加：增长型写入前先跑 `share-fit.mjs` 看分节占用（`Index` 最容易顶到硬预算），任何写入后用 `loadMemory` + `isMemoryTruncated` 复验，不要 grep 标记
- 记忆里「dispose 插件要手工清 `dsh.profile.bundles`」是 loader 1.0 之前的整树回写行为：`0.2.2-rc.1` 的 Include 只把运行时改动写回父 patches，下次真正 dispose 插件时要先重新核实这条再照做
- 全仓完整性审计已于 2026-11-05 做完（`.agents/evidence/2026-11-05-pnpm-store-integrity-audit/`）：73 个包逐文件哈希，修好 1 个代码文件（`dsh-package-manifest` 缺 `lib/index.js`）与 25 个 LICENSE；恢复只落在 `node_modules` 不入 git，下次 `install` 后若出现莫名 module-not-found，先重跑该目录的 `compare.mjs`，别先怀疑代码
- 这次 pass 之后的 `memory regression: 8 … entry(ies) are no longer present` 是**文本精确比对**的假阳性：8 条里 8 条都在新文档里以改写形式存在（逐条集合比对过），该行只是写后报告、不拒绝；历史上它报过 30 / 55 / 7 / 4 / 8 条，别据此判断记忆丢了
- 本批（20:27）实现 `handoffRetireReplaced`：门加在 `performHandoff` 收尾的 `if (config.handoffRetireReplaced) scheduleRetirement(…)`，六个面（config / settings / card-fields / locales / README / 测试）全动；`pnpm typecheck` 0、`pnpm test` **492**、`pnpm build` 0（`lib/client.js` **37270**，键在 bundle 里 5 处）
- 本批两个变异体均被杀并已从 `/tmp/retire-mut/` 哈希快照还原复验：M1 去掉门 → 红在「nothing is scheduled for this session's turn end」；M2 让 `resolvePluginConfig` 忽略输入 → 红在「the option reaches the resolved config」
- README 两处会过期的数字已改掉（不写行数与控件数、点名 `settings-form.test.mjs` 的逐键相等断言）：实测今天 21 行 / 6 布尔 / 2 枚举，其中「5 布尔 / 3 枚举」在加本键之前就已经不对
- 20:32:25 重启后本批已生效，四条机器判据（2026-11-06 20:42 实测）：①host pid 82102 启动晚于最后 `src/` 提交 `8dc97c5`（20:28:48）②`dsh-live-inventory-probe.mjs --url http://127.0.0.1:38961` 四行 active、enabled 非 active 0、store==wrapper、`RESULT: PASS`（条目 241）③派发的 `plugins/??dsh-project-context/client.js&rev=5e876189861f` 与磁盘 `lib/client.js` 前 37270 字节逐字节相同（只多 76 字节 sourceMappingURL 尾）④`cordis_inspect_query` host `Config` 对 `include:project-context` 的投影 schema 已含 `handoffRetireReplaced`（`default: true`、`volatile: true`）
- 本轮 GUI 端口 33647 → **38961**（探针必须传 `--url`，否则 `fetch failed` 假失败）；`~/.dsh/.credentials.yaml` 的 `client-connection/browser-session` 离线签名 cookie 可直接读取派发页与 bundle（临时脚本 `/tmp/served-bundle-check.mjs`）
- 20:52 把 README 从 446 行瘦到 141 行：手册留 README（四个插件 / 安装 / 命令 / 写哪些文件 / 配置速查 / 行为边界 / FAQ / 开发 / 许可），机制搬进 `docs/{architecture,behavior,settings,development}.md`；搬移按节整块移动，`git diff -- README.md` 的 **393** 行删除行逐行在并集里查回，只有 `## 命令（web/交互 profile）` 标题改名这一行不在原位
- 20:55 归档 18 个批次档案：`git mv docs/batch-*.md → docs/archive/`；`docs/batch-w-decision-seam-spec.md` 留在 `docs/`，因为 `src/project-handoff/{auto,decide}.ts` 与 `test/handoff-decide.test.mjs` 直接引用它
- 新增 `docs/README.md`：上半是生效文档表（12 行）、下半是归档表（18 行）、末尾是写作与引用约定（含「`.agents/evidence/` 冻结、旧路径不回改」）
- CHANGELOG 拆分：8 个已发布版本 → `docs/changelog/v{0.1.0,0.2.0,0.2.1,0.3.0,0.4.0,0.4.1,0.4.2,0.4.3}.md`（标题升为 `#`、正文逐行相等、各带一行索引回链），主文件 1719 → 269 行只留未发布 + `## 版本目录`
- 发布流程随之变：发版 = 把未发布整段搬进 `docs/changelog/v<new>.md` + 目录加行 + 重开空 `### 未发布`；`dsh-project-context-release` 技能的 step 2/4 与 MEMORY 的发布不变量已同步
- 引用改写：46 行 `docs/batch-*` → `docs/archive/batch-*`（README、CHANGELOG、`docs/upstream-pi-triage.md`、`docs/vocabulary-conventions.md`、归档文件互引、`pi-upstream-triage-pass` 技能、MEMORY+CONTEXT）；`docs/repo-metadata.md` 等未被牵动
- 文档分工：**README 只留结论 + 指针，长段说明进 `docs/`**，唯一索引是 `docs/README.md`；收口批次档案在 `docs/archive/`。README 配置表原本漏掉的 `maxMemoryChars` 已补（21 键对照 `PluginSettingsSchema` 实测无缺）
- 已知噪声：`context-injection.test.mjs` 偶发 2 条失败，是并发写入撞上它读仓库自身 memory 文档，代码此后未变、三连跑复绿，未记成已修
- `handoffRetireReplaced` 已生效（默认 `true`，卡片交接区末行「交接后归档旧会话」）。要验证关掉后的效果：关掉→保存→`/handoff now`，旧会话应仍在列表里、且不在「全部对话（显示已归档）」里；开关只管以后的交接，`c35a7f0f` 与 `3a51f066` 仍在归档集里，要找回得手动「取消归档」
- 记忆已冻结（实测）：`13:27:00Z` 与 `13:30:57Z` 两次 pass 均被拒，日志是「4 whole entry(ies) … from 3 section(s) … reached its character cap」，`MEMORY.md` 自 20:57:32 未变，两个产物都没写
- 余量核算：39587 / 40000 只剩 413 字符；成熟期（输入 ≥34000）7 次落地涨幅 −734…+3475、p50 **+532**，5/7 超过余量，故拒绝是常态而非意外
- 订正旧记：此前「43000 → needed 32732、43500 起 clipped」按插件真实 `auxModel`（`reasoning: true`、`maxTokens` 328000；`config.maxTokens` 8192、ceiling 32768）重扫不复现——CONTEXT 9077 时 43007→31534、45242→32711 均 `clipped false`，首个裁剪在 45242–48251 之间
- 但两份文档共用同一个输出预算：本轮 CONTEXT 从 9077 涨到 9793（+716 字符）后同样尺寸整体上移约 590 tokens，45242 已 `clipped true`、43007→32127 仍安全 —— 定上限必须同时看 CONTEXT
- 该重扫的边界：只有 39587 那行是真文档（与 `probe.mjs` 完全一致），其余是重复真实 bullet 合成的等长文档，字符→token 密度可能略有偏差
- 再压的最低代价落点：116 条里 18 条是批次/CHANGELOG 叙事、共 7135 字符，搬到 `docs/` 不丢事实，只是退出注入集
- 待你定（按代价排序）：①再压文档（同时省每轮注入，也正是任何小窗口方案的前置条件；116 条里 18 条批次叙事 7135 字符是零事实损失落点）②卡片把 `maxMemoryChars` 改 43000（解冻记忆；输出半边余量按 `cap-sweep.mjs` 现跑，CONTEXT 每涨约 800 字符吃掉约 700 tokens）③不动作则记忆继续冻结。**顺序不可反**：`maxMemoryChars` 是读写同一把尺，降到存储文档以下会整节砍掉（见 Key points）
- 复算脚本：`.agents/evidence/2026-11-06-memory-compression-headroom/cap-sweep.mjs` 读当前两份文档直接扫 `fitMemoryInput`，任何上限判断以它现跑为准

<!-- latest-session-title: 离线实测记忆两半写路径、重启验收通过、订正 10:13 拒绝的因果断言 -->
