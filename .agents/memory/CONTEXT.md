# Project Context

Last updated: 2026-11-11T03:16:22.011Z

## Summary

本会话从 session-19b9f719 交接而来（当前会话为 session-0f1996da，meta 已带 kind=handoff / parentId），目标是确认 Z7/Z8a/Z8b/Z8c 四批在宿主重启后真正生效，并做完所有可离线完成的验收。核对顺序是先磁盘后进程：HEAD = origin/main = d4bb012、工作树干净、最后 `src/` 提交 b2798e5 于 2026-11-11 10:35:15；旧宿主 pid 5222 启动于 11-10 23:21:37（早于 Z8c 提交），用户重启后新宿主 pid 71971 启动于 11-11 10:41:56，晚于最后 src 提交，两条生效判据都通过。宿主 `--verify-only` 探针 RESULT: PASS（255 个条目，enabled 但非 active = 0，wrapper 对应当前 store）；cordis Config 里 `include:project-context` 存在且 status=schema，说明插件 apply 成功；`lib/` 中 Z7 的 `createdDir`、Z8a 的 `HandoffRouteError`/`withRouteFailure`、Z8b 的 `build/renderSessionTree`、Z8c 的 `rmdir` 全部在位；启动后无新 crash 日志，errors.log 仍是 11-10 23:44、无新行。存档不变量：196 目录 / 196 带 meta / 196 行 INDEX / 0 悬空 / 0 空目录，之前缺的一行正是本会话——10:41 归档后补上，meta 保留 `kind:"handoff"` 与 `parentId`，父会话也在 workspace.json 的 archivedSessionIds 里，证明交接的退休步骤确实执行。Z8b 用已加载的 lib 对真实档案渲染出 196 session / 194 root / 2 handoff continuation，交接链 8c58ea1f → 19b9f719 → 0f1996da 层级正确。Z7 的 live 证据是本会话 meta 本身；本会话未绑定任务，所以没有 `task` 字段是正确负控。剩余行为验收需要用户敲命令：`/session-log tree` 验宿主命令面（agent 无 slash 命令通道），`/memory update` 同时验 Z2/Z4。Z8a 与 Z8c 的触发条件（死路由、失败交接）无法在正常路由上人为制造，只能靠已有测试钉住。MEMORY.md 44892/45000（headroom 108），未截断、无整条目丢弃、渲染往返逐字节一致。本会话上下文已越线 15%（157,760 / 1,048,576，阈值 157,000），自动交接只在轮末评估，因此本轮结束时很可能触发，子会话 meta 正好是 Z7 的又一件 live 验收件。

## Key points

- 生效判据两条同时成立：socket holder pid 71971 启动 10:41:56 晚于最后 `src/` 提交 b2798e5（10:35:15），且 `lib/` 特征点在位（Z7 `createdDir`、Z8a `HandoffRouteError`/`withRouteFailure`、Z8b `build/renderSessionTree`、Z8c `rmdir`）。
- `--verify-only` 探针 PASS：255 条目、enabled 但非 active = 0、wrapper 对应当前 store；cordis Config 里仅 `include:project-context` 且 status=schema，插件 apply 成功。
- 启动健康：无今天的新 crash 日志（最新 11-05），`.agents/memory/errors.log` 仍是 11-10 23:44、新宿主未写错误行。
- 存档不变量实测 196 目录 / 196 带 meta / 196 行索引 / 0 悬空 / 0 空目录；「目录数 = 行数」这个核对只数带 `meta.json` 的目录，Z8c 之后只剩预先存在的空目录会破坏它。
- 之前 INDEX 少的一行就是本会话：10:41 被上一宿主归档后行已补上，meta 保留 `kind:"handoff"` + `parentId`，父会话在 workspace.json 的 `archivedSessionIds` 里，说明交接的退休步骤真的执行了。
- Z8b 用已加载的 `lib` 对真实档案渲染出 `196 session(s) · 194 root(s) · 2 handoff continuation(s)`，交接链 8c58ea1f → 19b9f719 → 0f1996da 层级正确，孤儿作根、环终止、子代理档案隐藏但计数、500 行上限这些分支由 `test/session-tree.test.mjs` 钉住。
- Z7 的 live 证据是本会话自己的 meta（`kind:"handoff"` + `parentId`）；本会话未绑定任务，所以没有 `task` 字段是正确负控，要验 `task` 继承需先 `/context task <slug> new`。
- Z8a 与 Z8c 的行为触发条件（`resolveModelInfo` 抛错的死路由、一次失败的交接）在正常路由/正常交接下不会出现，只能由测试用例钉住；现在 0 空目录是修复后的不变量，不是 Z8c 的触发证据。
- agent 没有执行 slash 命令的通道（不能驱动会话 UI），所以「宿主里敲命令」这一层必须由用户补，这是 Z8b 命令面验收的唯一缺口。
- `MEMORY.md` 44892/45000（headroom 108），`loadMemory` 读回 truncated:false / damaged:0 / poisoned:false、渲染→解析→渲染逐字节一致、无整条目丢弃、`itemTruncated 0`。
- 本会话上下文 157,760 / 1,048,576（15%），已越过 157,000 阈值；自适应阈值被质量膝曲线压在 157K 附近（即使 1M 窗口亦如此），而自动交接只在 `turn/end` 评估，所以轮内越线不会立即触发、轮末很可能触发。
- `HEAD = origin/main = d4bb012`，本轮只做只读核对，没有改任何代码；工作树 0 改动。
- 技能遮蔽按源码而非 README：最近层胜出，rank 只在层内去重（project .dsh 100 → project .agents 200 → runtime 250 → custom 300 → ~/.dsh 400 → ~/.agents 500 → bundled 600），插件注入会静默压掉用户技能库但压不掉项目 `.agents/skills`。
- `ctx.skills.register` 要求四字段但 `validateRuntimeSkill` 只校验 kebab 名与非空描述；todo 投影首写前是 `null` 而非 `[]`。
- 项目层技能是 watcher 热加载：新建 `SKILL.md` 后同一会话即可载入，不欠重启；宿主侧代码改动才需要重启。
- Z3 的三条实现事实：状态派生（只有 `archived` 自主，`manual` 冻结全部派生）；`archived` 既不注入也不被整理 pass 写入；绑定写在 `meta.json`，归档写必须继承 `kind`/`parentId`/`task`，否则绑定用一次就失效。
- Z5 todo 接线：机械行 `- [todo] …` 只由 `src/project-memory/todo.ts` 维护，`turn/end` 与整理 pass 共用 `withTodoLines`；投影 `null` 一行不写、上次快照继续站着，只有空列表才清机械行；快照不变按整份文档逐字节相等判据不落盘，pass 半边不是可选项。
- Z4 清洗通道：备份只留 3、日志 90 天、errors.log 超 1 MB 归档后原地截断、候选 60 天；先写 `trash/<date>.tar` 并读回磁盘字节校验再删，`session-logs/` 与活 journal 永不在候选，`purge.log` 每次真的清理一行。
- `/memory update` 是本机唯一的记忆落盘通道，也是 Z2/Z4 的验收手段：条目带 `（xxxx）` 标记、`entries.json` 生成且被 gitignore 覆盖、`purge.log` 多一行、`trash/` 有当天 tar。

## Open tasks

- 请用户在任一会话敲 `/session-log tree`，验收 Z8b 的宿主命令面：前两行应为 `196 session(s) · 194 root(s) · 2 handoff continuation(s)`；若本会话已自动交接则为 `197 · 194 · 3`（新子会话也是交接连续体）。
- 请用户敲 `/memory update`，同时验收 Z2/Z4：`MEMORY.md` 条目带 `（xxxx）`、`entries.json` 生成且被 gitignore 覆盖、`purge.log` 多一行且 `trash/` 有当天 tar。
- 想验 Z7 的 `task` 继承：先 `/context task z8-acceptance new` 绑定临时任务，再结束一轮让自动交接触发或 `/handoff now`，子会话 meta 应带 `"task": "z8-acceptance"`；本会话未绑定任务，无 `task` 字段是正确负控。
- Z8a 行为验收需要一次 `resolveModelInfo` 抛错的死路由（中途切换模型后旧请求头残留）；正常路由下不存在，目前只能确认 `/handoff status` 回执可正常构建（只读）。
- Z8c 行为验收需要一次失败的交接才能看到目录被取回；当前 0 空目录是修复后的不变量、不是触发证据，该分支已由 5 条真跑 `performHandoff` 的用例钉住。
- 行为验证（用户侧）：跑一次 `/memory update`，确认点名 effort → 网关接受 → 写入落地整链。
- 行为验证（用户侧）：空闲会话上执行 `/handoff now`，应立即可归档父会话（进 workspace.json 的 `global.archivedSessionIds`）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 观察 `context-injection.test.mjs` 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 `handoffBudgetRecentTokens`（如 4000）、调小宿主 compaction `headroomTokens`、并压小两份文档，缺一不可。
- `MEMORY.md` 现在 44892/45000（headroom 108）：下一批要加事实前先按 cap-guard 压别的条目，否则会撞 tier C 的整条目拒绝。
- 重启后顺手核对存档：`INDEX.md` 的行数应等于「带 `meta.json` 的目录数」，本会话归档后是 196/196；空目录只应来自 Z8c 之前的历史遗留。

<!-- latest-session-title: 批次 Z8 重启后生效验收：Z7/Z8a/Z8b/Z8c -->
