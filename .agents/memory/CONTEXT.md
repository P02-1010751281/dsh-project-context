# Project Context

Last updated: 2026-11-10T11:43:59.381Z

## Summary

2026-11-09 那轮（六问题取证）已收口：产出 docs/batch-z-six-problems-spec.md（六问取证 + 根因 + Z1–Z5 切分 + §8 五个待裁定岔口），CONTEXT.md 重写并复验（往返逐字节一致、21 条目、4932 字符），连同上次会话遗留的 autolearn 技能窄暂存提交 216ecc6（docs(spec)）并推送，远端 main = 216ecc6 = 本地 HEAD、工作区 0 变更；未动任何 src/。取证方法沿用「从隔壁机器取真实数据」：406-12 跑打包版 0.4.3 是唯一真实使用现场，本机是 link: 开发树（HEAD 含未发布提交）只作对照。已确立的结论：索引漏写根因是 migrateProjectState（src/shared/migrate.ts）整目录 mergePath 搬入 ~/.pi/session-logs 却不补索引行，且 src/ 里没有任何 readdir(logsDir) 对账路径（406-12 磁盘 194 / INDEX 131 / 漏 63 / 悬空 0，本机 185/185/0/0），cap、并发丢行、写后被删三条均已用现读证据排除；记忆「过时」不在路径漂移（本机 120 条中真漂移仅 1 条），而在内容层与结构层（CONTEXT.md 每项目一份、内容却每会话一份，无任务标识）；清洗通道确无（命令面仅 5 个、无 retention 键、唯一 purge 工具在仓库外且只管子代理）；交接摩擦是体验型而非报错型（远端 errors.log 中 handoff 0 条却有 11 个 handoff 会话）。2026-11-10 用户回来提五个新问题，均尚未调查：①session index 的最大限制是否合理、索引是否缺 schema、会话树形与交接关系是否缺失；②记忆是否分层（短期 + 长期）、不同任务记忆是否区分；③记忆会失效但目前没有失效路径，从而产生干扰；④是否需要 todo 项；⑤是否需要 skill 辅助、dsh 是否允许插件注入 skill。下一步是把这五问并入规格（在 batch-z 规格里追加一节，或另立 Z6+），仍先规格后改码。上一轮量出的硬约束继续有效：MEMORY.md 在 profile 配的 cap 45000 下渲染干净（41226/45000 = 91.6%、0 丢弃），但余量仅约 3.3k，下一次增长就可能触发 lossy 拒绝，所以清洗/压缩通道是当下最紧的一项。

## Key points

- 406-12 跑打包版 0.4.3，是唯一真实使用现场；本机是 link: 开发树，含未发布提交，只作对照。所有索引/记忆存量读数取自 406-12。
- 索引漏写根因锁定：migrateProjectState（src/shared/migrate.ts）整目录 mergePath 搬入 ~/.pi/session-logs 但不补索引行；且 grep -rn 'readdir(logsDir' src/ 为 0 命中，无任何对账路径。已排除 cap（MAX_INDEX_LINES 200 > 194、尾部无 dropped 注释）、并发丢行（跨进程锁自 b4794af 起在 0.4.3 内）、写后被删（git log -S 三条抽样 id 命中 0）。
- 11 月那 8 条漏写实为 11-01/02 迁移期产物，早于 11-02 安装 tgz；现行写入器自 11-02 起是完整的——问题②与③同源：索引只靠归档路径顺手 append，无独立对账。
- 索引形态（新问题①的事实基础）：INDEX.md 每会话一行 bullet，只由归档路径 append，无 schema 字段（无父 id、无交接链接、无状态），且写入器有一个硬行数上限（触顶时留 dropped 注释）；因此会话树与交接关系无法读出，只能另行推导。
- 记忆过时不在路径漂移：本机 MEMORY.md 120 条目中带目录的代码路径锚点 24 个、真漂移 1 条（scripts/check-dsh-plugin-patches.sh 已不存在）+1 条外部路径，行号越界 0；CONTEXT.md 0 漂移。
- 过时的真因在内容层与结构层：远端 ~/.agents/memory/CONTEXT.md 的 Last updated 停在 11-06、Open tasks 14 条横跨 8 条无关工作流（dsh-multi-root、浏览器工具、GPU hostfix、cc-switch、Codex、pi 退役…），并且它在每个 cwd 为 ~ 的会话里都被当项目上下文注入。
- 结构性原因两条：CONTEXT.md 每项目一份而内容每会话一份（无会话/任务标识，后写覆盖前写）；四节记忆条目无 id/日期/作用域/supersede，过期只能靠模型观感——正对应用户新问题②③。
- 无清洗通道断言成立：命令面 5 个（/context /session-log /memory /handoff /autolearn），无 purge/prune，无 retention/ttl/keep 类配置键；唯一工具是仓库外 purge-subagent-archives.mjs（仅子代理）。远端积压实测：5 份 MEMORY 备份、2×约 530KB memory-log、512KB memory.jsonl、52KB errors.log、63 个未入索引目录。
- 交接摩擦是体验型不是报错型：远端 errors.log 中 handoff 0 条却有 11 个 handoff 会话；本机 handoff 3 条为陈旧配对、429、QUOTA。摩擦表现为带错东西、带太多（与任务维度同源）或根本没发生而无人知晓——不能拿 errors.log 作验收信号。
- 真实余量（2026-11-09 现读，引用前须重算）：MEMORY.md 在 profile 实际 cap 45000 下渲染干净（41226/45000 = 91.6%，sectionDropped 0、droppedItems 0），仅剩约 3.3k 字符；同一文档按库默认 40000 会丢 3 节 6 条并报 lossy 拒绝。
- 本轮读数坑：share-fit.mjs 读库默认 MAX_MEMORY_CHARS 而非 profile 的 maxMemoryChars；wc -m 数字符、ls -l 数字节，比较二者会误判为并发重写。
- 规格文件 docs/batch-z-six-problems-spec.md 已落盘：六问取证、根因、Z1–Z5 切分、复现命令、§8 五个待裁定岔口。提交 216ecc6 已推送，远端 main = 216ecc6 = 本地 HEAD。
- 技能优先级（2026-11-10 读 dsh 0.2.2-rc.1 源码，更正上一轮「先到先得」的 README 转述）：最近层直接胜出、rank 只在同一层内决定同名去重；层内 rank 小者胜——project/.dsh 100 → project/.agents 200 → runtime 250 → custom 300 → user/.dsh 400 → user/.agents 500 → bundled 600。故宿主层注入会静默压掉自定义目录与用户两份技能库，却压不掉项目 .agents/skills，且无查询 API 能看出遮蔽。
- 会话上下文已越 157k 阈值；自动交接只在 turn/end 评估，轮内越线不触发，结论已落盘不依赖会话存活。

## Open tasks

- 新五问已答并写进规格 §10（docs/batch-z-six-problems-spec.md），结论：①索引的 200 行上限应删（唯一消费方 autolearn 只读最新 50 条，200 行约 18KB，上限只破坏可导航性），索引要加版本头与 parent/kind/tags 尾注；②会话树确实缺失——dsh 原生会话头无 parent（实测 {harness,id,version,createdAt,cwd,isSeeded,agentPreset}），HANDOFF.md 有父 id 但是项目级单文件、每次覆盖，关系只靠标题「↪ handoff · 短 id」展示；③记忆分层结构已存在（CONTEXT=短期、MEMORY=长期）但缺晋升规则、失效路径与每会话隔离；④失效建议三条机械触发（锚点漂移/被取代/久未证实），退休是移到 retired.md 不是删除；⑤todo 不要另造——dsh 已有 todo_write（TodoItem={content,status}，整表快照 todo/write 事件，落会话日志），只做读取接线；⑥插件注入 skill 可行：ctx.skills.register（内存 runtime 技能）与 registerProvider（目录提供者），但磁盘是唯一持久通道，runtime 只用于会话级短生命周期提示。
- 待用户裁定五个旧岔口（规格 §8）：清洗删除语义 dry-run + --apply 还是 tar 后直接删；任务维度落在 CONTEXT.md 内分块还是 tasks/<slug>.md 多文件；条目标记用 [task:..][status:..] 前缀还是自然语言尾注；索引自检时机（宿主启动扫 vs 仅命令/归档失败后）；406-12 那 63 条存量是否现在就补（本机 0 条）。
- Z1 索引对账建议先做（只增不删、幂等、走现有锁），它同时验证「问题②③同源」的判断；Z2 清洗通道依赖 Z3 标记约定，Z4 任务维度是 Z5 按任务切片种子的前置。
- 行为验证（用户侧，阻塞）：跑一次 /memory update——成功即闭合「点名 effort → 网关接受 → 写入落地」整链；若仍 400 则改更高的启用档。也是 cap 45000 下是否仍出现 lossy 拒绝的观测点。
- 另一条行为验证（用户侧）：闲置会话上执行 /handoff now，应立即可归档父会话（进 ~/.dsh/storages/workspace.json 的 global.archivedSessionIds），被交接会话不再排在续接会话之上。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档；另可验证 handoffRetireReplaced 关掉后的效果。
- 设计选择待用户裁定：路由长期钉在失效模型上时自动交接会持续 5 分钟退避、唯一痕迹是 errors.log 且无用户可见面；是否变成可见告警，不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: 第二轮设计提问：索引上限与 schema、会话树、记忆分层与失效、todo、技能注入 -->
