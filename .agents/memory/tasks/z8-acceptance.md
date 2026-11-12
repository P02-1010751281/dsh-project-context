# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title z8-acceptance：失效记忆审计已修 4 条并新增 2 条，MEMORY.md 44,943/45,000（余 57），空间路线待用户定

## Summary

本会话从 session-115731af 交接，接着 z8-acceptance 任务收尾。上一会话已完成方案 D（Z8f，条目 id 四位→三位）在运行宿主的热换生效验证、五处安装点全部换到当前构建、406-12 19:57 重启、tasks/z8-acceptance.md 与 AGENTS.md 计数刷新入库，以及用「合并重复条目」把 MEMORY.md 从 44,973 救到 44,482（143 条，余 518）。本会话开工核对：HEAD=7afb4f4、MEMORY.md 44,482 字符、tasks 文档已过时（仍写 44,973/只剩 27 字符）。第一步我用仓库自带的 renderTaskDocument 重刷任务文档（3,972 字符、round-trip 逐字节相同、dropped 0、meta 与尾注一致）并入库 bbab203；随后 20:16 的整理 pass 又自刷了一版（补了起点 13d37c7、44,170、防丢判据、交接压力 401,548/1,048,576），我校验后按惯例入库 b47ce68。顺带拿到一个正面证据：这次 pass 在只有 518 余量下正常完成，errors.log 只多一行 adopted an externally edited MEMORY.md（与 09:07 同类，属正常），MEMORY.md 仍 44,482 字符、字节与 7afb4f4 一致，没有再出现 lossy-refused。随后用户问「看卡有没有旧记忆或者废弃的条目」，我做了一轮只读审计：用 entries.json 与 MEMORY.md 逐条比对、13 个疑似路径逐个 stat、反引号 token 与数字抽样核对、3 hex 尾标与重算比对、batch docs 与 evidence 目录核对。结论：没有成堆的失效条目，143 条里只有 3 条确实过时、1 条残留失效 id（另 1 条 7b6 是「已处置」的墓碑式反向事实，非错误）：82a 仍写 Batch Z 到 Z8e（Z8f 只在 CHANGELOG 未发布、spec 冻结在 Z8e）；ea5 说 per-batch brief 在 docs/（实际在 docs/archive/，docs/ 只有两份 spec）；3cf 的「重跑前提是加载 pre-isTopLevel 代码」今天不可达（五处安装点全含 isTopLevel）；5d3 正文尾部残留失效 id（d4x）（entries.json 无此键）。同时确认「旧」不能按年龄找：entries.json 143 键只有 11-11/11-12 两天，id 由正文 sha256 派生、改写即换标并重置日期，实测 77/143 条现存尾标与按当前正文重算不一致，所以 id 与日期都不是年龄信号，只能按内容判新旧；全篇也没有引用短提交哈希。审计还发现 MEMORY 里「Batch Z 到 Z8e」与 spec 描述在 82a/ea5 两处重复。本会话已把这 4 条修正与 82a/ea5 去重写入 MEMORY.md：改写后旧 id 82a/ea5/3cf 换标为 f36/8cd/8a0，5d3 保留；并新增 ffa（id 与日期都不是年龄信号）与 e16（合并重复事实是省余量的常规手段）两条。整轮净变化 +461 字符（44,482→44,943），余量从 518 降到 57——修完 4 条反而更贴近 cap。复核：round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、loadMemory 内容==磁盘、cappedDroppedChars 0、145 条（16/67/47/15）、无截断标记。现状 HEAD 见记忆库，工作树干净；本会话上下文约 400k/1,048,576，已越 400,000 阈值，仅在轮次结束时评估。

## Key points

- 开工核对：HEAD=7afb4f4、MEMORY.md 44,482 字符/143 条；tasks/z8-acceptance.md 仍写着旧的 44,973/只剩 27 字符。
- 任务文档用 renderTaskDocument 重刷并入库 bbab203（3,972 字符、round-trip 逐字节相同、dropped 0、meta 与尾注一致）；20:16 的 pass 又自刷一版，校验后入库 b47ce68。
- 正面证据：518 字符余量下 20:16 的 pass 正常完成，errors.log 仅多一行 adopted an externally edited MEMORY.md（正常采纳），MEMORY.md 字节与 7afb4f4 一致，未再 lossy-refused。
- 失效条目审计结论：143 条里只有 4 条确有问题——82a（Batch Z 只写到 Z8e）、ea5（brief 实际在 docs/archive/）、3cf（pre-isTopLevel 重跑前提已不可达）、5d3（残留失效 id d4x；这四条改写后 id 为 f36/8cd/8a0/5d3）；7b6 是「已处置」墓碑，留退由用户定。
- 「旧」不能按年龄找：entries.json 143 键只有 11-11/11-12，id 由正文 sha256 派生，改写即换标并重置日期，77/143 条现存尾标与重算不一致；MEMORY 全篇无短提交哈希，引用过期提交这条路不存在。
- 13 个疑似失效路径中 7 个是占位符模板（tasks/<slug>.md、docs/changelog/<version>.md 等），6 个真实路径全在；三个 probe（share-fit/roundtrip/measure）都在 .agents/evidence/ 下。
- 确认无误的抽样：46e（devDeps 仍钉 0.1.7-rc.2，peer 下限一致）、86a（两份 profile 仍 wait + 20000；desktop 另设 handoffThreshold:400000 属未提及而非说错）、b68（406-12 跑当前构建、19:57 重启）。
- 已把 4 条修正写入 MEMORY.md（旧 id 改写后换标）：Batch Z 条补 Z8f 并注明 spec 冻结在 Z8e、docs 条改为 docs/archive/（同时消除与 Batch Z 条的 spec 描述重复）、purge 条去掉不可达前提、id 条清掉失效 d4x；并新增 ffa 与 e16 两条。整轮 44,482→44,943（+461 字符），余 57。
- entries.json 现状：145 条，分节 Project16/Invariants67/Pitfalls47/Index15，0 条无尾标；原先唯一的双尾标（d4x）（5d3）已修正为单尾标。
- 自动交接：本会话上下文约 401k/1,048,576（38%），已越 400,000 阈值；只在 turn/end 评估，轮内越线不立即触发。

## Open tasks

- 空间路线待用户定（现状余 57：修 4 条 + 新增 2 条把 518 用掉了 461）：A 到此为止；B 列约 10 条删除候选（按内容与是否在 CHANGELOG/docs 有归宿，不能按 entries.json 年龄）供过目；C 调高 maxMemoryChars（记忆裁定它只缓解「整篇到 cap」那一半，反加剧模型输出上限，不推荐当唯一手段）。
- 本机 desktop 重启一次（可选但建议）：现在插件是热换进来的，重启让整进程确定 2dc80cc，之后只读复核 --verify-only PASS。
- Windows P02-1 下次启动 DSH 自动加载新包（已换好，无需再动）。
- 7b6（dsh-rewind-plugin 已处置墓碑）留与退由用户定，不是待修缺陷。
- 旧项：被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 旧项：只读复核 subagent 69845585 已随父会话结束而销毁，实际可勾掉；若仍有报告到达则逐条复现其发现。

<!-- latest-session-title: z8-acceptance：失效记忆审计已修 4 条并新增 2 条，MEMORY.md 44,943/45,000（余 57），空间路线待用户定 -->
