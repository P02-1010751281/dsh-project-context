# Project Context

Last updated: 2026-11-10T13:38:40.875Z

## Summary

本会话从 session-10a5ddff 交接，按 §11.8 连续落地批次 Z1 与 Z2。Z1（cf6a790 + 67021ed）：会话索引不再 append，改为每会话 meta.json 的生成物，每次写入扫 session-logs/ 整份重生成，删掉 200 行上限与 dropped 注释；漏写与悬空在结构上不再可能；另加宿主启动时扫一次的 reconcile，补上「目录在、行不在且无人写入过」的缺口。真机镜像验收 187 目录 / 187 行全保留、0 缺失 0 多余 0 重复、整份重生成 61 ms。Z2（本轮）：新增 retired.ts / retirement.ts，实现三条机械触发（锚点漂移 / supersedes:<id> / 180 天未被归档会话提到）、retired.md 墓碑（超 200 行折半进 retired-archive.md）、提示词墓碑摘要（日期与标题、最多 20 条），墓碑只在内存真的落地后追加。两处按实测改规格：条目标记只写 `（4f2a）`、日期进被 gitignore 的 entries.json（带日期的 23 字符标记会让渲染丢 7 条整条目），锚点判据收紧到「扩展名白名单 + 父目录必须存在 + 排除插件本地生成物」，把 30 条散文假阳性降到真机 0 误退。门禁 523 通过 / 0 失败，6 个变异各只红对应用例。两批都要重启宿主才生效。

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
- Z2 退休通道（`retired.ts` + `retirement.ts`）：锚点漂移 / `supersedes:<id>` / 180 天未被归档会话提到三条机械触发；墓碑只在内存真的落地后追加；条目标记只写 `（4f2a）`，日期进被 gitignore 的 `entries.json`——带日期的 23 字符标记在本机文档上会让渲染丢 7 条整条目。

## Open tasks

- 四轮裁定已全部落定并写进规格 §11（docs/batch-z-six-problems-spec.md）：① task 三态 active / dormant（30 天无活动自动）/ archived（显式或 dormant 满 90 天自动）；② CONTEXT 拆机械部分（turn/end 变化即写、不调模型）与散文部分（仍只在整理 pass）；③ 维护 skill 做成短路由型入口、渐进式披露，专项留给既有技能；④ 清理记录写 purge.log，索引不留不可验证注释。§11 另定：索引生成式重写、meta.json 带 date/title/kind/parentId/task、Z1–Z6 批次且 Z1 先行。
- Z1 已实现并推送（cf6a790 生成式 + 67021ed 启动对账）：索引成为 `session-logs/*/meta.json` 的生成物，`MAX_INDEX_LINES` 与 dropped 注释已删；`entryLines` / `LINE_PATTERN` 只剩 adoption 读旧文件用。待宿主重启才生效（判据：宿主进程启动时刻晚于 67021ed），重启后核对 `meta.json` 出现、INDEX 行数 = 目录数、文档内无 `<!-- N older sessions dropped -->`。
- 启动对账已实现并推送（67021ed）：`reconcileSessionIndexOnce` 接在 `agent/created` 上，每项目每进程一次、遵守 `archiveEnabled`、失败进 `errors.log` 并可重试。真机镜像验收：187 目录 / 187 行全保留、0 缺失 0 多余 0 重复、整份重生成 61 ms；首次重生成重排了行序（157/187 换位，日期仍非降）。剩余批次：Z3 任务维度是 Z5 按任务切片种子的前置；Z2 已落地（见下一条）。
- 行为验证（用户侧，阻塞）：跑一次 /memory update，确认点名 effort → 网关接受 → 写入落地整链；重启后这一次同时验证 Z2（`MEMORY.md` 每条尾部出现 `（xxxx）`、`entries.json` 生成且被 gitignore 覆盖、`retired.md` 只在真的退条时出现），并观察 cap 45000 下是否仍出现 lossy 拒绝。
- 行为验证（用户侧）：闲置会话上执行 /handoff now，应立即可归档父会话（进 workspace.json 的 global.archivedSessionIds）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档；另可验证 handoffRetireReplaced 关掉后的效果。
- 设计选择待用户裁定：路由长期钉在失效模型上时自动交接会持续 5 分钟退避、唯一痕迹是 errors.log 且无用户可见面；是否变成可见告警，不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。
- Z2 已实现并推送：三条触发 + `retired.md` 墓碑（超 200 行折半进 `retired-archive.md`）+ 提示词墓碑摘要（日期与标题、最多 20 条）+ 条目 id（内容派生的四字符 hex，盖在正文尾部）。真机只读测量 0 误退 / 134 条装下 / 44524 字符 0 丢条；待重启后一次 `/memory update` 同时验证 Z1 与 Z2。

<!-- latest-session-title: 批次 Z 设计评审：索引投影、任务生命周期、维护 skill -->
