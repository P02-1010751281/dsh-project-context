# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title z8-acceptance：B 路线已执行——退 6 条并合并 1 对，MEMORY.md 43,440/45,000（余 1,560、138 条）

## Summary

本会话承接 session-115731af 的 z8-acceptance 收尾，主题是「记忆失效审计 → 修正入库 → 余量告急」。开工核对 HEAD=7afb4f4、MEMORY.md 44,482 字符、tasks/z8-acceptance.md 已过时（仍写 44,973/只剩 27）。先用 renderTaskDocument 重刷任务文档并入库 bbab203；20:16 的整理 pass 自刷一版，校验后入库 b47ce68。顺带得到正面证据：518 字符余量下该 pass 正常完成，errors.log 只多一行 adopted an externally edited MEMORY.md，MEMORY.md 字节与 7afb4f4 一致，未再 lossy-refused。随后用户问「卡里有没有旧记忆或废弃条目」，我做只读审计：entries.json 与 MEMORY.md 逐条比对、13 个疑似路径逐个 stat、反引号 token 与数字抽样、3 hex 尾标与重算比对、batch docs 与 evidence 目录核对。结论是 143 条里只有 4 条确有问题：82a（Batch Z 只写到 Z8e）、ea5（brief 实际在 docs/archive/）、3cf（pre-isTopLevel 重跑前提已不可达）、5d3（残留失效 id d4x）；7b6 是「已处置」墓碑式反向事实，非错误。同时确认「旧」不能按年龄找：id 由正文 sha256 派生、改写即换标并重置日期，77/143 条现存尾标与重算不一致，全篇也无短提交哈希。我建议修这 4 条并去重 82a/ea5 的 spec 描述重复。用户回 ok 后核对发现：整理 pass 已自行把这些修正写入 MEMORY.md（82a→f36、ea5→8cd、3cf→8a0，5d3 保留，并新增 ffa「id 与日期都不是年龄信号」与 e16「合并重复事实是省余量常规手段」）。我没有直接采信，而是机械验伪：拿 b47ce68 的 143 条对现有 145 条逐行比对，仅 2 个 token 消失（`2.6` 旧碰撞概率、`batch-*-brief.md` 旧错误位置），均为故意；完整性校验 44,943 字符、145 条（Project16/Invariants67/Pitfalls47/Index15）、round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、loadMemory 内容==磁盘、cappedDroppedChars 0、poisoned false、无截断标记。随后入库 0cf685e（MEMORY.md）与 5ce1236（任务文档）；任务文档原写「44,482 / 143 条 / 余 518」并称「净变化很小」，实测是 +461 字符，已改为当前事实（3,773 字符、round-trip 相同、dropped 0）。现状 HEAD=origin/main=5ce1236，工作树干净。真正的问题是修完反而更贴近上限：44,943/45,000，仅余 57。用户回「要。没用就退」后我执行 B 路线：先按「内容是否在 CHANGELOG/docs 有归宿、是否还有前向决策价值、是否已被技能/文档覆盖」逐条判，再解析→按尾标过滤→用 renderMemoryDocument（cap 45000）重渲染落盘：退 6 条（7b6 dsh-rewind 墓碑按用户裁定退、f9a 一次性 grilling 轶事、bf8 锚点判据过宽、32c skills 目录泛述、b16 pi batch I 注入细节（docs/upstream-pi-triage.md 已载）、5fe session-index entryLines 琐节），并把 7c1（wording-only 压缩收益有限）并入 e16（合并重复事实），净省 1,466 字符：43,440/45,000（余 1,560）、145→138 条（16/67/41/14）、最长条目 605 字符；复核 round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、loadMemory 内容==磁盘、cappedDroppedChars 0。被删条目仍在 git 历史里可追溯。本会话上下文约 400k+/1,048,576，已越 400,000 阈值，仅在 turn/end 评估自动交接。

## Key points

- 开工核对：HEAD=7afb4f4、MEMORY.md 44,482 字符/143 条；tasks/z8-acceptance.md 仍写旧的 44,973/只剩 27 字符，已用 renderTaskDocument 重刷并入库 bbab203，20:16 pass 自刷版入库 b47ce68。
- 正面证据：518 字符余量下 20:16 的整理 pass 正常完成，errors.log 仅多一行 adopted an externally edited MEMORY.md，MEMORY.md 字节与 7afb4f4 一致，未再 lossy-refused。
- 审计结论：143 条里只有 4 条确有问题——82a（Batch Z 只写到 Z8e）、ea5（brief 实际在 docs/archive/）、3cf（pre-isTopLevel 重跑前提已不可达）、5d3（残留失效 id d4x）；7b6 是「已处置」墓碑，非错误。
- 整理 pass 已自行写入这 4 条修正并换标（82a→f36、ea5→8cd、3cf→8a0，5d3 保留），并新增 ffa（id 与日期都不是年龄信号）与 e16（合并重复事实是省余量的常规手段）；这两条新事实与本会话审计结论一致。
- 防丢是机械验过的：拿 b47ce68 的 143 条对现有 145 条逐行比对，仅 2 个 token 消失（`2.6` 旧碰撞概率、`batch-*-brief.md` 旧错误位置），均为故意；其余反引号 token 与数字都仍在全篇。
- 完整性复核：44,943 字符、145 条（Project16/Invariants67/Pitfalls47/Index15）、round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、loadMemory 内容==磁盘、cappedDroppedChars 0、poisoned false、无截断标记。
- 审计副产品：「旧」不能按年龄找——entries.json 143 键只有 11-11/11-12 两天，id 由正文 sha256 派生，改写即换标并重置日期，77/143 条尾标与重算不一致；全篇无短提交哈希。
- 13 个疑似失效路径里 7 个是占位符模板（tasks/<slug>.md、docs/changelog/<version>.md 等），6 个真实路径全在；三个 probe（share-fit/roundtrip/measure）都在 .agents/evidence/ 下。
- 抽样确认无误：46e（devDeps 仍钉 0.1.7-rc.2、peer 下限一致）、86a（两份 profile 仍 wait + 20000；desktop 另设 handoffThreshold:400000 属未提及而非说错）、b68（406-12 跑当前构建、19:57 重启）。
- 两人份 profile 的 maxMemoryChars 都是 45000（desktop/web 均自 2026-11-07 起），所以 share-fit.mjs 按库默认 40000 出的结论不能直接采信。
- 任务文档已改为当前事实并入库 5ce1236：3,773 字符、round-trip 逐字节相同、dropped 0、meta 与尾注一致，标题写明 44,943/145 条/余 57，并标注 82a→f36、ea5→8cd、3cf→8a0 的换标关系。
- 现状 HEAD=origin/main=5ce1236（0cf685e 为 MEMORY.md、5ce1236 为任务文档），工作树干净；修完 4 条 + 新增 2 条净变化 +461 字符（44,482→44,943），余量从 518 降到 57。
- 自动交接：本会话上下文约 400k+/1,048,576（约 38%），已越 400,000 阈值；只在 turn/end 评估，轮内越线不立即触发。
- B 路线已执行：退 6 条 + 把 7c1 并入 e16，净省 1,466 字符 → MEMORY.md 43,440/45,000（余 1,560）、138 条（Project16/Invariants67/Pitfalls41/Index14）、最长条目 605 字符；round-trip 逐字节相同、三类 dropped 全 0、loadMemory==磁盘、cappedDroppedChars 0。

## Open tasks

- 空间路线：B 已执行，现余 1,560，够下一次 pass 加 3–4 条中等条目；若将来还要更多余量，只剩 C 调高 maxMemoryChars（记忆裁定它只缓解「整篇到 cap」那一半、反加剧模型输出上限）或继续按同一判据删，不急。
- 本机 desktop 重启一次（可选但建议）：现在插件是热换进来的，重启让整进程确定 5ce1236，之后只读复核 --verify-only PASS。
- Windows P02-1 下次启动 DSH 自动加载新包（已换好，无需再动）。
- 旧项：被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 旧项：只读复核 subagent 69845585 已随父会话结束而销毁，实际可勾掉；若仍有报告到达则逐条复现其发现。

<!-- latest-session-title: z8-acceptance：B 路线已执行——退 6 条并合并 1 对，MEMORY.md 43,440/45,000（余 1,560、138 条） -->
