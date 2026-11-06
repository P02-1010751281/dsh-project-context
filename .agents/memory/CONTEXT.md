# Project Context

Last updated: 2026-11-06T02:58:25.992Z

## Summary

本会话由 session-17738a1d 交接。上一轮留下的问题「压缩后 2220 字符余量够不够」按仓库技能 `dsh-memory-budget-fit-offline-verify` 做成了离线实测：先证明宿主 pid 41218 启动 09:26:43 早于最后 `src/` 提交 `30e0ba1`（09:59:03），两批代码未上线、活体观察不可行；再用宿主真正加载的 `lib/` 探针测得 budget 半边清空（`sectionDropped 0 / droppedItems 0 / itemTruncated 0`、round-trip 字节相同）、output 半边 `needed` 29941 < 32768 不裁剪，并用真实 CJK 密度 0.4014 tok/char 算出提上限的临界（43000 时 needed 32732 不裁剪，43500 起 `clipped true`）。自检抓到两个假绿（把已渲染文本再喂渲染器必然报 0；`MemorySections` 键是小写标题）。用户随后重启，三条机器判据全过：pid 58434 启动 10:51:25、四个插件 `active` + store == wrapper + `RESULT: PASS`、`tsc --outDir /tmp/libcheck2` 后 `diff -rq lib` 只差 `client.js` 且该包含 `appliesWhen`/`rowVisible`/`parseRatioInput`/`boundedNumberField`，两批代码 `dfe4f34`、`30e0ba1` 现已生效。翻日志发现 10:13:33 还有一次拒绝（丢 3 条整条目 / 2 节），我先判定「跑在压缩后文档上」，随后自我否掉：mtime 只是必要条件，请求体不落盘、成本台账按会话聚合、宿主无 `[memory]` 日志，三处决定性证据都不存在，故改为未决并写清判别锚点（`MEMORY.md` 自 10:10:04 未变，故重启后任何拒绝都无歧义对应 37780）。重启后第一次整理 pass 已于 10:58:25 **落地**（journal `op: replace`，39216 字符），故「压缩够不够」已有答案：够用 —— `MEMORY.md` 37780 → 39216、`CONTEXT.md` 10981 → 5278，余量从 2220 降到 784。三笔提交均 docs-only：`4f6385c`（探针+证据）、`ea5e8cf`（重启验收+拒绝事实）、`713d81f`（订正为未决）；`HEAD == origin/main == 713d81f`，工作区干净，技能目录 29 未动。

## Key points

- 交接自 session-17738a1d；本轮无队友在跑（`list_agents` 只有 lead）
- 加载判据：宿主 pid 41218 启动 09:26:43 早于最后 `src/` 提交 `30e0ba1`（09:59:03），故离线判定是唯一可行路径
- 离线探针跑的是宿主真正加载的 `lib/`，不是 `src/`；`git diff --exit-code -- lib` 为空
- budget 半边实测清空：`sectionDropped 0 / droppedItems 0 / itemTruncated 0`，round-trip 字节相同
- output 半边：`needed` 29611（按当时 CONTEXT 9820）/ 29941（按 10314）均 < 32768，`clipped false`
- 上限定值：真实 CJK 密度 0.4014 tok/char 下，`maxMemoryChars` 40000 → needed 31146，43000 → 32732（不裁剪），43500 起 `clipped true`
- 模型目录 `auto/deepseek-v4.1-flash` 的 `maxTokens: 328000` 决定 `defaultMaxTokens`，不承重；真正决定 `clipped` 的是配置 `maxOutputTokens: 32768`（schema 默认，两个 profile 都没覆盖）
- 整理 prompt 明确告知上限：`memoryBudgetRule` 原文含「must stay at or under 40000 characters… currently about N」，故拒绝不是「没告诉模型」
- journal 量出的成熟期（输入 ≥34000）落地涨幅 n=7：-156 / +532（中位）/ +908 / +669 / +455 / +3475 / -734（本轮），2/7 超过现在只剩的 784 余量 → 下一次仍可能是概率事件
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
- 落地后现状：`MEMORY.md` 39216 字符（余量 784）、`CONTEXT.md` 5278 字符；渲染器复核 `sectionDropped 0 / droppedItems 0 / itemTruncated 0`、round-trip 字节相同；output 半边 `needed` 26467 < 32768 不裁剪
- 条目上限：`MEMORY.md` 超 800 的条目 0、最长 788；`CONTEXT.md` 超 800 的条目 0、最长 423（Key points 节）
- 探针产物：`.agents/evidence/2026-11-06-memory-compression-headroom/README.md` + `probe.mjs`（`--self-test`，退出码 0 清空 / 1 丢数据 / 2 无法判定 / 3 自检未开火），README 已补实测结局与「输入版本未决」段
- 宿主为 `0.2.2-rc.1`，GUI 端口每次重启都变（本轮 35209 → 33647），探针不传 `--url` 会以 `fetch failed` 假失败

## Open tasks

- 下一次 pass 的余量只剩 784 字符，而成熟期实测 2/7 的涨幅超过它；若再被拒，日志措辞分流不变：`N section(s) exceeded their budget` / `whole entry(ies)` → budget 半边（须再压）；`cut off by the model output limit` → output 半边（此时降 `maxMemoryChars` 无用）
- 若再被拒，三条出路按代价排序：①再压（现在要压到约 36000 才留够余量，要删事实，须用户点头）②`maxMemoryChars` 提到 ≤43000（实测 43000 时 `needed` 32732 < 32768 不裁剪，43500 起 `clipped true`；代价是每轮注入多约 2000 tokens）③接受持续拒绝、记忆不再增长
- 界面验收：用户 18:01 实测报「关掉自适应后『摘要目标（仅报告）』消失」。我判定**比例行该隐藏、这行不该**（它是一项预算：命令任一模态都收、`config.ts` 任一模态都校验、唯一读点在自适应分支只做回执），已改回并在 `f90bbd5` 之后这一批里交付（CHANGELOG「模式门只留在固定比例行上」）：门只剩 `handoffThresholdRatio` 一行，摘要目标在两种模式下都显示。**已构建、且 bundle 已确认在派发**：2026-11-06 18:24 实测宿主派发的字节与磁盘 `lib/client.js` 逐字节相同（combo `rev=805a30a0ec8f`，前 35750 字节相同、只多 76 字节 sourceMappingURL 尾），机制是 host 挂着 `include:client-hmr` 统计轮询调 `rebuilt()`，故无需重启；请看固定模式下这一行是否出现（最多刷新一次）。其余三项仍待验：在「自适应阈值」上按重置不应触发互换；固定阈值填 `40` / `40%` 均存成 `0.4`；预算金额填 `7999` 时保存按钮直接灰掉
- 比例行在触屏上打不出 `%`：平台只提供 `numeric` 布尔 → `inputMode="numeric"`，hint 里的 `40%` 在触屏不可达；要改只能动平台
- 保存失败的两种成因只在文档 revision 可观测时才能分开；不可观测时仍退回合并文案（平台只给一个 `failed` 布尔）
- `MEMORY.md` 的余量靠整行替换维护，不靠追加：增长型写入前先跑 `share-fit.mjs` 看分节占用（`Index` 最容易顶到硬预算），任何写入后用 `loadMemory` + `isMemoryTruncated` 复验，不要 grep 标记
- 记忆里「dispose 插件要手工清 `dsh.profile.bundles`」是 loader 1.0 之前的整树回写行为：`0.2.2-rc.1` 的 Include 只把运行时改动写回父 patches，下次真正 dispose 插件时要先重新核实这条再照做
- 全仓完整性审计已于 2026-11-05 做完（`.agents/evidence/2026-11-05-pnpm-store-integrity-audit/`）：73 个包逐文件哈希，修好 1 个代码文件（`dsh-package-manifest` 缺 `lib/index.js`）与 25 个 LICENSE；恢复只落在 `node_modules` 不入 git，下次 `install` 后若出现莫名 module-not-found，先重跑该目录的 `compare.mjs`，别先怀疑代码
- 这次 pass 之后的 `memory regression: 8 … entry(ies) are no longer present` 是**文本精确比对**的假阳性：8 条里 8 条都在新文档里以改写形式存在（逐条集合比对过），该行只是写后报告、不拒绝；历史上它报过 30 / 55 / 7 / 4 / 8 条，别据此判断记忆丢了
- 已知噪声：`context-injection.test.mjs` 偶发 2 条失败，是并发写入撞上它读仓库自身 memory 文档，代码此后未变、三连跑复绿，未记成已修

<!-- latest-session-title: 离线实测记忆两半写路径、重启验收通过、订正 10:13 拒绝的因果断言 -->
