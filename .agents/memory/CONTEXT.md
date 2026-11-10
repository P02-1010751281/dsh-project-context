# Project Context

Last updated: 2026-11-10T12:30:22.974Z

## Summary

本会话从 session-8cb9feac 交接而来，前半段做源码级复核并纠正了上一轮一条只依据 README 的结论：dsh 技能解析是「最近层直接胜出，rank 只在同层内去重」，层内 rank 小者胜（project .dsh 100 → project .agents 200 → runtime 250 → custom 300 → ~/.dsh 400 → ~/.agents 500 → bundled 600），因此插件注入的 runtime 技能会静默压掉自定义目录与用户两份技能库，却压不掉项目 .agents/skills，且没有查询 API 能看出遮蔽。还从源码补了两条：ctx.skills.register 要求 {name, description, source, content} 四字段但只校验 name/description（绕过类型会得到空正文），todo 投影在首次写入前是 null 而不是 []。期间我自己写坏了 CONTEXT.md 的一条 bullet（846 字符 > MAX_LIST_ITEM_CHARS 800），被 roundtrip.mjs 抓住（over the 800-char cap: 1、byte-identical false），已拆条修好并清掉一条变假的记忆；提交 eabd273 已推送。后半段按用户要求改用 grilling 方式提问（白话 + 示例 + 推荐答案），分三轮收敛了批次 Z 的设计。已裁定：索引删掉 200 行上限（甲）；每会话一份 meta.json（乙），且索引改为生成式投影（乙）——含义是日期与标题必须进 meta.json；任务维度拆 tasks/<slug>.md 多文件，任务归属靠显式命令 + 模型只能在既有 slug 里挑、新建需确认；退休 = 立刻从 MEMORY.md 删除 + retired.md 墓碑（不注入），墓碑标题行在整理时注入以防复活；清理自动跑且先 tar，墓碑超 200 行压缩归档；对账在宿主启动时扫一次、只收顶层会话、双向（补漏 + 删悬空行）；todo 只收当前会话并接在 turn/end 变化时写入 CONTEXT.md 的机械部分；autolearn 的 50 行窗口不动；项目记忆维护 skill 做成短的路由型入口（不复制专项内容，避开 autolearn 生成的名字）。澄清了用户的一个错误前提：插件从不读 todo（src/ 里 todo 0 命中），交接种子也从不带 todo，所以「上一个会话未完成的 todo 会自动继承」在机制上不成立。也纠正了一个测量错误：用 session-* 通配数目录会少算，按链接目标逐条解析后本机是 186 目录 / 186 行 / 悬空 0 / 漏写 0。当前停在第四轮四问上（task 生命周期状态、CONTEXT 机械/散文分离更新、skill 形态、清理留痕放哪），用户尚未回答；答完即写 §11 实现规格，然后按 Z1… 动 src/。全程未改 src/，因此不需要重启宿主。

## Key points

- 技能遮蔽按源码而非 README：最近层胜出，rank 只在层内去重（project .dsh 100 → project .agents 200 → runtime 250 → custom 300 → ~/.dsh 400 → ~/.agents 500 → bundled 600），插件注入会静默压掉用户技能库但压不掉项目 .agents/skills，且无查询 API。
- ctx.skills.register 要求四字段但 validateRuntimeSkill 只校验 kebab 名与非空描述；todo 投影首写前是 null 而非 []。
- 索引改为生成式投影（用户裁定乙）：每次写索引扫 session-logs/ 读各 meta.json 整份重生成，漏写与悬空在结构上不再可能；代价是日期与标题必须进 meta.json，adoption 老行需一次性迁移。
- 索引改成生成式后，写入路径不再走 entryLines：writeSessionIndex 改为扫目录读 meta.json 整份重写，并删掉 MAX_INDEX_LINES；entryLines / LINE_PATTERN 只留给 adoption 读旧文件用——所以「放宽 entryLines 才能加版本头」这条已作废。
- 本机按链接目标逐条解析：186 目录 / 186 行 / 悬空 0 / 漏写 0；用 `session-*` 通配数目录会少算，以后对账必须解析链接目标。
- 任务维度：tasks/<slug>.md 多文件；会话归属靠显式命令声明（未声明归默认），模型只能在既有 slug 里挑，造新 slug 需用户确认；task 本身有生命周期（active/dormant/archived，dormant 自动、archived 显式或超期自动）。
- 退休：立即从 MEMORY.md 删除 + retired.md 写墓碑（只记事实/时间/原因，不注入、不占上下文）；整理时注入墓碑标题行与日期（最多约 20 条）防模型把旧事实重新学回来。
- 清理：自动执行但先 tar 到仓库外/trash；墓碑超 200 行压缩归档；清理记录写独立日志（`.agents/memory/purge.log`，已定），不往索引里塞不可验证的注释。
- 对账：宿主启动时扫一次，只收顶层会话（排除 subagent），双向（补漏写 + 删指向已删目录的悬空行）；幂等。
- todo：插件当前完全不读 todo、交接种子不带 todo；方案是 turn/end 时 todo 快照变化才写进 CONTEXT.md 的机械部分（机械部分实时、Summary/Key points 仍只在整理 pass 更新）。
- 用户 Q4 丙（退休即删）+ Q5 乙丙（90 天延迟清理）自相矛盾，已用「删正文 + 写墓碑」统一，90 天条款改为墓碑文件的压缩归档阈值。
- 索引变化的连带后果：目录被清理后对应行消失，索引保持「每行都能在磁盘上验证」；曾经存在的会话靠 purge 日志审计。
- autolearn 读索引最新 50 行是素材新鲜度取舍，与索引长度解耦，删上限后不动。
- 仓库已有 30+ 技能，记忆相关至少 4 个（cap-guard、recovery、loss-repair、four-section-migration），新 skill 做成短路由型入口，专项细节留在已有技能里避免第二份真相。

## Open tasks

- 四轮裁定已全部落定并写进规格 §11（docs/batch-z-six-problems-spec.md）：① task 三态 active / dormant（30 天无活动自动）/ archived（显式或 dormant 满 90 天自动）；② CONTEXT 拆机械部分（turn/end 变化即写、不调模型）与散文部分（仍只在整理 pass）；③ 维护 skill 做成短路由型入口、渐进式披露，专项留给既有技能；④ 清理记录写 purge.log，索引不留不可验证注释。§11 另定：索引生成式重写、meta.json 带 date/title/kind/parentId/task、Z1–Z6 批次且 Z1 先行。
- Z1 已实现并推送（cf6a790）：索引成为 `session-logs/*/meta.json` 的生成物，`MAX_INDEX_LINES` 与 dropped 注释已删；`entryLines` / `LINE_PATTERN` 只剩 adoption 读旧文件用。待宿主重启才生效（判据：宿主进程启动时刻晚于 cf6a790），重启后核对 `meta.json` 出现、INDEX 行数 = 目录数、文档内无 `<!-- N older sessions dropped -->`。
- 索引「对账」在写入时天然发生（每次写入都重扫目录），但用户裁定「宿主启动时扫一次」尚未实现，留给后续批次；Z2 清洗通道依赖 Z3 标记约定，Z4 任务维度是 Z5 按任务切片种子的前置。
- 行为验证（用户侧，阻塞）：跑一次 /memory update，确认点名 effort → 网关接受 → 写入落地整链，同时观察 cap 45000 下是否仍出现 lossy 拒绝。
- 行为验证（用户侧）：闲置会话上执行 /handoff now，应立即可归档父会话（进 workspace.json 的 global.archivedSessionIds）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档；另可验证 handoffRetireReplaced 关掉后的效果。
- 设计选择待用户裁定：路由长期钉在失效模型上时自动交接会持续 5 分钟退避、唯一痕迹是 errors.log 且无用户可见面；是否变成可见告警，不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: 批次 Z 设计评审：索引投影、任务生命周期、维护 skill -->
