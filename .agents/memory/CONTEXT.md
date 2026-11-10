# Project Context

Last updated: 2026-11-10T14:50:15.295Z

## Summary

本会话做的是批次 Z6（路由型技能）：`.agents/skills/dsh-project-context-maintenance/SKILL.md` 用一张判断表把四块维护任务（记忆、索引与归档、交接、技能沉淀）路由到「先跑哪条命令 / 读哪个文件 / 载入哪个专项技能」，专项细节仍只写在既有技能里；`MEMORY.md` 的 Index 收了一行指针，并用 `test/routing-skill.test.mjs` 把 frontmatter 合规、名字不冲突、指向的技能与命令都存在、正文只是一张表钉住。Z5（todo 接线）已提交推送，Z6 之后只剩 Z7（种子按任务切片）。

## Key points

- 技能遮蔽按源码而非 README：最近层胜出，rank 只在层内去重（project .dsh 100 → project .agents 200 → runtime 250 → custom 300 → ~/.dsh 400 → ~/.agents 500 → bundled 600），插件注入会静默压掉用户技能库但压不掉项目 .agents/skills，且无查询 API。
- ctx.skills.register 要求四字段但 validateRuntimeSkill 只校验 kebab 名与非空描述；todo 投影首写前是 null 而非 []。
- 索引是 `session-logs/*/meta.json` 的生成物：每次写入扫目录整份重生成，漏写与悬空在结构上不再可能；`entryLines`/`LINE_PATTERN` 只剩 adoption 读旧文件用。本机按链接目标逐条解析：186 目录 / 186 行 / 悬空 0 / 漏写 0；用 `session-*` 通配数目录会少算。
- Z3 的三条实现事实：① 状态派生（只有 archived 自主，`manual` 冻结全部派生）；② `archived` 既不注入也**不被整理 pass 写入**（否则一次 lastSeen 刷新就复活），两个半边共用 `boundTaskSync`；③ 绑定写在 meta.json，而归档写每轮从活会话重建元数据，`preserveForeign` 必须继承 `kind`/`parentId`/`task`，否则绑定用一次就失效（解绑走同一队列与锁，不会被下一次 settle 复活）。
- `taskMode` 的三值是**制造权限阶梯**而不是状态开关：`assisted`（默认）/`manual` 拒绝裸 slug 并点名 `new`，`delegated` 裸 slug 即建且 90 天自动归档。规格里「模型可以提议」这半没有通道（本包不注册工具），确认门槛因此落在命令上，已记为残留。
- 任务文档的 `title` 放在元信息行（最后一个字段，含 ` · ` 安全），因为「其他任务」清单要一个标签而不该打开正文；`created`/`status` 在每次写入时保留，`lastSeen` 由落地本身刷新；回执点名真正落地的文件（`.agents/memory/tasks/<slug>.md`）。
- 退休（Z2）：立即从 MEMORY.md 删除 + retired.md 写墓碑（只记事实/时间/原因，不注入）；整理时注入墓碑标题行与日期（最多 20 条）防复活；条目标记只写 `（4f2a）`，日期进被 gitignore 的 entries.json——带日期的 23 字符标记会让渲染丢 7 条整条目。
- 清理（Z4）：四类本地产物有地板（备份 3 份 / 日志 90 天 / errors.log 1 MB / 候选 60 天），**先写 trash/<date>.tar 并读回磁盘字节校验，再删**；session-logs/ 与活 journal 永不在候选；purge.log 每次真的清理一行，预览不写；自动钩子在真的跑了的 pass 之后，失败不进 /memory update 回执。
- 仓库已有 30+ 技能，记忆相关至少 4 个（cap-guard、recovery、loss-repair、four-section-migration），新 skill 做成短路由型入口，专项细节留在已有技能里避免第二份真相。
- Z5 todo 接线：机械行 `- [todo] …` 只由 `src/project-memory/todo.ts` 维护，`turn/end` 与整理 pass 共用 `withTodoLines`；投影 `null`（本轮没写）一行不写、上次快照继续站着，只有空列表才清机械行；快照不变按整份文档逐字节相等判据不落盘。
- Z5 的 pass 半边不是可选项：pass 整份重写文档且恰跑在 `turn/end` 后的 idle 上，只做 `turn/end` 会在几秒后把刚写下的清单擦掉；机械行受 Open tasks 段落预算与 50 条上限约束，写不下的项计入 `droppedItems` 并写 `errors.log`。
- Z6 的落点是 `.agents/skills/dsh-project-context-maintenance/SKILL.md`（模型可调用、description 常驻），正文只有一张四列表：插件 / 任务 / 第一步 / 专项技能，15 行覆盖四块；`dsh-session-archive-repair` 与 `agents-memory-recovery` 在用户层（`~/.agents/skills`），clean clone 自证不了，测试里用显式白名单声明。
- Z6 的机械门禁是 `test/routing-skill.test.mjs`（5 条）：frontmatter 名=目录名、全语料无重名、每个 `dsh-*` 指向的技能在 `.agents/skills/` 存在、每个 `/命令` 都在 `src/*/index.ts` 真注册、正文 < 3000 字符且四块各有行；9 个变异各只红自己的目标。
- 项目层技能是 watcher 热加载：新建 `SKILL.md` 之后同一会话里 `skill` 工具就能载入（本次实测，不需要重启宿主），所以 Z6 不欠重启，欠重启的仍是 Z1–Z5 的宿主侧行为。
- MEMORY.md 的 Index 指针走的是 `loadMemory` → `renderMemoryDocument` → `recordMemoryDocument` 这条插件路径（不手工编辑）：44688/45000、一条不截断、无整条目丢弃、渲染→解析→渲染逐字节一致；同时把 test/ 套件名与 evidence 日期目录两处枚举压成读-now 说法，净增 133 字符。
- `MEMORY.md` 的 headroom 现在只剩 312 字符：下一次整理 pass 一旦丢整条目就会被 tier C 拒绝，要加事实得先按 cap-guard 压别的条目（它不是可选项，是这套文档的常态）。

## Open tasks

- Z1–Z5 已实现并提交，**待宿主重启才生效**：重启后第一次整理 pass 应写出 `.agents/memory/purge.log` 与 `trash/<date>.tar`（本机现有 5 份备份，会删最旧 2 份）。
- 重启后一次 `/memory update` 同时验证 Z1–Z4：`MEMORY.md` 每条尾部出现 `（xxxx）`、`entries.json` 生成且被 gitignore 覆盖、INDEX 行数 = 目录数、`purge.log` 多一行且 `trash/` 有当天 tar；Z5 由重启后的下一个 `turn/end` 验证（`CONTEXT.md` 的 Open tasks 顶部出现 `- [todo] …`）。
- 行为验证（用户侧）：跑一次 /memory update，确认点名 effort → 网关接受 → 写入落地整链。
- 行为验证（用户侧）：空闲会话上执行 /handoff now，应立即可归档父会话（进 workspace.json 的 global.archivedSessionIds）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 设计选择待用户裁定：路由长期钉在失效模型上时自动交接会持续 5 分钟退避、唯一痕迹是 errors.log 且无用户可见面；是否变成可见告警，不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。
- Z6 已落地并推送（新技能 + 一条 Index 指针 + 5 条用例，无 src 改动，路由技能已在当前会话热加载）；下一批按 §11.8 是 Z7（种子按任务切片，依赖 Z3/Z4/Z5），现在可做。
- MEMORY.md 只剩 312 字符 headroom，下一次整理 pass 前先按 cap-guard 压 Index，否则会撞 tier C 的整条目拒绝。

<!-- latest-session-title: 批次 Z6：路由型技能（四块维护任务的入口） -->
