# Project Context

Last updated: 2026-11-10T14:20:38.417Z

## Summary

本会话从 session-c5095aa7 交接，按 §11.8 落地批次 Z4（清洗通道）。新增 src/project-memory/prune.ts：四类本地产物终于有了地板——*.memory-backup-* 只留最新 3 份、memory-log-*.jsonl 与 memory.jsonl.*.tmp 超 90 天、errors.log 超 1 MB 归档后原地截断到最新约 64000 字符的整行尾巴、skill-candidates/*.md 超 60 天；session-logs/ 与活的 memory.jsonl 永不在候选（时间线是审计线，Z2 的两个机械触发读它）。归档器写在进程内（src/ 不许有命令能力这条不变量由 project-root 用例钉住）：ustar 512 字节头 + 补零 + 两个零块，写完用同一解析器读回磁盘字节逐成员核对，任一步失败一个文件都不删；trash/<date>.tar 未压缩以便同日追加。清理挂在每次真的跑了的整理 pass 之后（deduped 不算），失败只 warn + 自己的日志，不进 /memory update 回执。/memory prune 预览（不删、不写日志），--apply 才删；purge.log 每次真的清理一行。17 条用例 + 11 个变异（各只红目标用例），门禁 560 通过 / 0 失败；规格 §11.5 落地小节与 §11.8 状态行、CHANGELOG、README、AGENTS、behavior 已同步，MEMORY 加了一条不变量（44210/45000）。**需要重启宿主**才生效。

## Key points

- 技能遮蔽按源码而非 README：最近层胜出，rank 只在层内去重（project .dsh 100 → project .agents 200 → runtime 250 → custom 300 → ~/.dsh 400 → ~/.agents 500 → bundled 600），插件注入会静默压掉用户技能库但压不掉项目 .agents/skills，且无查询 API。
- ctx.skills.register 要求四字段但 validateRuntimeSkill 只校验 kebab 名与非空描述；todo 投影首写前是 null 而非 []。
- 索引是 `session-logs/*/meta.json` 的生成物：每次写入扫目录整份重生成，漏写与悬空在结构上不再可能；`entryLines`/`LINE_PATTERN` 只剩 adoption 读旧文件用。本机按链接目标逐条解析：186 目录 / 186 行 / 悬空 0 / 漏写 0；用 `session-*` 通配数目录会少算。
- Z3 的三条实现事实：① 状态派生（只有 archived 自主，`manual` 冻结全部派生）；② `archived` 既不注入也**不被整理 pass 写入**（否则一次 lastSeen 刷新就复活），两个半边共用 `boundTaskSync`；③ 绑定写在 meta.json，而归档写每轮从活会话重建元数据，`preserveForeign` 必须继承 `kind`/`parentId`/`task`，否则绑定用一次就失效（解绑走同一队列与锁，不会被下一次 settle 复活）。
- `taskMode` 的三值是**制造权限阶梯**而不是状态开关：`assisted`（默认）/`manual` 拒绝裸 slug 并点名 `new`，`delegated` 裸 slug 即建且 90 天自动归档。规格里「模型可以提议」这半没有通道（本包不注册工具），确认门槛因此落在命令上，已记为残留。
- 任务文档的 `title` 放在元信息行（最后一个字段，含 ` · ` 安全），因为「其他任务」清单要一个标签而不该打开正文；`created`/`status` 在每次写入时保留，`lastSeen` 由落地本身刷新；回执点名真正落地的文件（`.agents/memory/tasks/<slug>.md`）。
- 退休（Z2）：立即从 MEMORY.md 删除 + retired.md 写墓碑（只记事实/时间/原因，不注入）；整理时注入墓碑标题行与日期（最多 20 条）防复活；条目标记只写 `（4f2a）`，日期进被 gitignore 的 entries.json——带日期的 23 字符标记会让渲染丢 7 条整条目。
- 清理（Z4）：四类本地产物有地板（备份 3 份 / 日志 90 天 / errors.log 1 MB / 候选 60 天），**先写 trash/<date>.tar 并读回磁盘字节校验，再删**；session-logs/ 与活 journal 永不在候选；purge.log 每次真的清理一行，预览不写；自动钩子在真的跑了的 pass 之后，失败不进 /memory update 回执。
- todo（Z5，未做）：插件当前完全不读 todo、交接种子不带 todo；方案是 turn/end 时 todo 快照变化才写进 CONTEXT.md 的机械部分（机械部分实时、Summary/Key points 仍只在整理 pass 更新）。
- 仓库已有 30+ 技能，记忆相关至少 4 个（cap-guard、recovery、loss-repair、four-section-migration），新 skill 做成短路由型入口，专项细节留在已有技能里避免第二份真相。

## Open tasks

- Z4 已实现并提交（本轮）：`prune.ts` + `/memory prune [--apply]` + 整理 pass 后的自动钩子。门禁 560 通过 / 0 失败。**待宿主重启才生效**；重启后第一次整理 pass 应写出 `.agents/memory/purge.log` 与 `trash/<date>.tar`（本机现有 5 份备份，会删最旧 2 份）。
- 重启后一次 `/memory update` 同时验证 Z1 + Z2 + Z3 + Z4：`MEMORY.md` 每条尾部出现 `（xxxx）`、`entries.json` 生成且被 gitignore 覆盖、`retired.md` 只在真的退条时出现、INDEX 行数 = 目录数且无 dropped 注释、`purge.log` 多一行且 `trash/` 有当天 tar；并观察 cap 45000 下是否出现 lossy 拒绝（现在 44210，余量约 800 字符）。
- 行为验证（用户侧）：跑一次 /memory update，确认点名 effort → 网关接受 → 写入落地整链。
- 行为验证（用户侧）：空闲会话上执行 /handoff now，应立即可归档父会话（进 workspace.json 的 global.archivedSessionIds）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档；另可验证 handoffRetireReplaced 关掉后的效果。
- 设计选择待用户裁定：路由长期钉在失效模型上时自动交接会持续 5 分钟退避、唯一痕迹是 errors.log 且无用户可见面；是否变成可见告警，不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。
- 下一批按 §11.8 是 Z5（todo 接线，依赖 Z3）；Z6（路由型技能）独立可做，Z7（种子按任务切片）依赖 Z3/Z4。

<!-- latest-session-title: 批次 Z4：清洗通道（prune.ts、/memory prune、tar→删→purge.log） -->
