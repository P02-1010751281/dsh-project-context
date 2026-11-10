# Project Context

Last updated: 2026-11-10T14:03:46.372Z

## Summary

本会话从 session-c99fdbaf 交接，按 §11.8 落地批次 Z3（任务维度）。新增 src/project-memory/tasks.ts：`tasks/<slug>.md` 每任务一份，头是 `# Project Task: <slug>` + `> created · status · lastSeen · title`，正文仍是 Summary / Key points / Open tasks，且与 CONTEXT.md **共用 context-doc.ts 的同一个渲染核心**（不是第二套格式）。三态里只有 `archived` 是自主值，`active`/`dormant` 由 `lastSeen` 年龄现算（>30 天 dormant，>90 天由 `delegated` 自动归档；`assisted` 只降级，`manual` 完全不派生）——这同时消掉了规格「dormant 满 90 天」与验收「91 天」的矛盾。`/context task <slug>` 把绑定写进该会话的 `session-logs/<id>/meta.json`，`new` 建并绑、`none` 解绑、`archive`/`activate` 改状态、裸 `/context task` 列出 slug/状态/标题。写路径与注入都按绑定切换：绑定会话整理时写任务文件（CONTEXT.md 一字节不动）、注入任务文档， 未绑定的仍用 CONTEXT.md；两种情况都另加一行一个的「其他任务」清单（只给 slug/状态/标题），无任务的会话注入与改动前逐字节一致。新配置键 `taskMode`（assisted/delegated/manual）。19 条用例 + 11 个变异（各只红目标用例），门禁 543 通过 / 0 失败；规格 §11.4、CHANGELOG、README、settings、AGENTS 已同步，MEMORY 加了一条不变量（43933/45000）。**需要重启宿主**才生效。

## Key points

- 技能遮蔽按源码而非 README：最近层胜出，rank 只在层内去重（project .dsh 100 → project .agents 200 → runtime 250 → custom 300 → ~/.dsh 400 → ~/.agents 500 → bundled 600），插件注入会静默压掉用户技能库但压不掉项目 .agents/skills，且无查询 API。
- ctx.skills.register 要求四字段但 validateRuntimeSkill 只校验 kebab 名与非空描述；todo 投影首写前是 null 而非 []。
- 索引是 `session-logs/*/meta.json` 的生成物：每次写入扫目录整份重生成，漏写与悬空在结构上不再可能；`entryLines`/`LINE_PATTERN` 只剩 adoption 读旧文件用。本机按链接目标逐条解析：186 目录 / 186 行 / 悬空 0 / 漏写 0；用 `session-*` 通配数目录会少算。
- Z3 的三条实现事实：① 状态派生（只有 archived 自主，`manual` 冻结全部派生）；② `archived` 既不注入也**不被整理 pass 写入**（否则一次 lastSeen 刷新就复活），两个半边共用 `boundTaskSync`；③ 绑定写在 meta.json，而归档写每轮从活会话重建元数据，`preserveForeign` 必须继承 `kind`/`parentId`/`task`，否则绑定用一次就失效（解绑走同一队列与锁，不会被下一次 settle 复活）。
- `taskMode` 的三值是**制造权限阶梯**而不是状态开关：`assisted`（默认）/`manual` 拒绝裸 slug 并点名 `new`，`delegated` 裸 slug 即建且 90 天自动归档。规格里「模型可以提议」这半没有通道（本包不注册工具），确认门槛因此落在命令上，已记为残留。
- 任务文档的 `title` 放在元信息行（最后一个字段，含 ` · ` 安全），因为「其他任务」清单要一个标签而不该打开正文；`created`/`status` 在每次写入时保留，`lastSeen` 由落地本身刷新；回执点名真正落地的文件（`.agents/memory/tasks/<slug>.md`）。
- 退休（Z2）：立即从 MEMORY.md 删除 + retired.md 写墓碑（只记事实/时间/原因，不注入）；整理时注入墓碑标题行与日期（最多 20 条）防复活；条目标记只写 `（4f2a）`，日期进被 gitignore 的 entries.json——带日期的 23 字符标记会让渲染丢 7 条整条目。
- 清理（Z4，未做）：自动执行但先 tar 到仓库外/trash；墓碑超 200 行压缩归档；清理记录写独立日志（`.agents/memory/purge.log`），不往索引里塞不可验证注释。
- todo（Z5，未做）：插件当前完全不读 todo、交接种子不带 todo；方案是 turn/end 时 todo 快照变化才写进 CONTEXT.md 的机械部分（机械部分实时、Summary/Key points 仍只在整理 pass 更新）。
- 仓库已有 30+ 技能，记忆相关至少 4 个（cap-guard、recovery、loss-repair、four-section-migration），新 skill 做成短路由型入口，专项细节留在已有技能里避免第二份真相。

## Open tasks

- Z3 已实现并推送（工作区本轮提交）：`tasks/<slug>.md` + 三态派生 + `/context task` + `taskMode` + 注入切换 + 归档写继承绑定。门禁 543 通过 / 0 失败。**待宿主重启才生效**（判据：宿主进程启动时刻晚于本次提交）；重启后可验证 `/context` 多一行 `Task:`、`/context task release new` 建文件并绑定、设置卡多一行「任务维护模式」。
- 重启后一次 `/memory update` 同时验证 Z1 + Z2 + Z3：`MEMORY.md` 每条尾部出现 `（xxxx）`、`entries.json` 生成且被 gitignore 覆盖、`retired.md` 只在真的退条时出现（本机当前应不出现）、INDEX 行数 = 目录数且无 `<!-- N older sessions dropped -->`；并观察 cap 45000 下是否出现 lossy 拒绝（现在 43933，余量约 1000 字符）。
- 行为验证（用户侧）：跑一次 /memory update，确认点名 effort → 网关接受 → 写入落地整链。
- 行为验证（用户侧）：闲置会话上执行 /handoff now，应立即可归档父会话（进 workspace.json 的 global.archivedSessionIds）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档；另可验证 handoffRetireReplaced 关掉后的效果。
- 设计选择待用户裁定：路由长期钉在失效模型上时自动交接会持续 5 分钟退避、唯一痕迹是 errors.log 且无用户可见面；是否变成可见告警，不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。
- 下一批按 §11.8 是 Z4（清洗通道：tar → 删 → purge.log，`/memory prune` 预览 + `--apply`），依赖 Z2；之后 Z5（todo 接线）依赖 Z3。

<!-- latest-session-title: 批次 Z3：任务维度落地（tasks/<slug>.md、三态、绑定命令） -->
