# 改进方案（2026-11-18）

> 依据：[同类系统调研](./research/2026-11-18-similar-projects.md)、[压缩 vs 交接](./compaction-vs-handoff.md)
>（同日规格）、以及本仓库现有不变量。本文只写方案，不改 `src/`；每一批落地前仍要单独出
> spec、跑门禁、做变异轮。

## 0. 北极星与硬约束

**北极星**：让「项目记忆 + 会话交接」在真实长任务里**可查、可见、可验证**，而不是把记忆做得更花。

硬约束（来自已收口的批次与 2026-11-18 调研裁定）：

1. **不实现压缩器、不接管 `ctx.compaction`**。dsh 自带 compaction（`thresholdRatio 0.8`、
   `retainRatio 0.16`、`agent/pre-step` 自动、溢出重试）；一个 realm 只能有一个后端，抢它没有收益。
2. **权威源仍是 append-only `memory.jsonl`**；不引入 DB-first、不引入服务端。
3. **有损写入仍然整次拒绝**；任何新功能不得绕过 tier C、段预算、单条 800 字符上限。
4. **交接仍只在 `turn/end` 评估**；不为「越线必达」去停掉在飞的那一轮（2026-10-07 的
   「不能丢东西」裁定）。
5. **Wave 1 不新增配置键**。新键要走 batch H 的六面（`config.ts`、`settings.ts`、
   `client/card-fields.ts`、`locales.ts`、所有 reader、测试），且每个字段必须 `volatile`。

---

## 1. 现状盘点：缺什么、不缺什么

| 方面 | 已有 | 缺口 | 优先级 |
|---|---|---|---|
| 归档 | 每轮 JSONL + `session.md` + `INDEX.md` + `tree` + 导入 | 没有按内容检索；`INDEX.md` 只有元数据 | P0 |
| 记忆 | journal 权威、四节文档、tier C 拒绝、去重、退休、任务文档 | `/memory` 只报路径与 cap 警告；没有条目数/占用/最近状态 | P0 |
| 交接 | 膝线 + 门控 + 原文尾料 + 文件清单 + 未答问题 + 父子 meta + 退休 | 回执不报压缩历史；「为什么现在交接」的压缩侧证据缺失 | P0 |
| 压缩 | 宿主自带，我们不碰 | 不观察 `compaction/*`；用户看不到「已压缩几次、压缩后仍多满」 | P0（只观测） |
| 技能 | 证据门 + 候选/批准 + `autolearn-generated` | 采纳时没有「依据哪几条会话」的回执；没有冲突检查 | P1 |
| 任务 | `tasks/<slug>.md`、绑定、todo 投影、`/context task` | 列表不含会话数/未完成 todo/最近活动 | P1 |
| 检索 | 无 | 模型与用户都无法「按问题找条目/会话」 | P0/P1 |
| 可观测 | 回执、`errors.log`、设置卡 | 没有记忆/归档总览；没有压缩行；没有面板 | P0/P1 |
| 跨工具 | 仅 dsh | 无 `AGENTS.md` 只读导出 | P2 |
| 可靠性 | 手工门禁、变异轮、证据包 | 新事件类型的防御性解析；无 CI | 贯穿 |

---

## 2. 总表：九条线、四个波次

| # | 线 | 方案 | 波次 | 规模 | 风险 |
|---|---|---|---|---|---|
| A | 检索/召回 | `/context find <q>` 只读检索（归档 + 记忆 + 任务 + HANDOFF） | W1 | M | 低（无状态、无模型） |
| B | 记忆可观测 | 扩写裸 `/memory`：字符/cap、四节条目数、journal 行数、备份、归档数 | W1 | S | 低 |
| C | 压缩感知 | 从会话日志折叠 `compaction/*`，在 `/handoff status` 报次数/最近一次/压缩后占用 | W1 | S | 低（只读） |
| D | 交接回执 | 回执补「压缩历史 + 种子携带物 + 触发原因」，并保持与决策同源 | W1/W2 | S | 中（不得编造） |
| E | 技能治理 | 采纳回执记录证据会话；机械冲突检查（token 重叠），不做模型回测 | W2 | M | 中 |
| F | 任务维度 | `/context task` 增加会话数/未完成 todo/最近活动；只读 | W2 | S | 低 |
| G | 模型侧检索 | 只读工具 `project_context_search`（**需设计裁定**）或注入时相关性 | W2/W3 | M | 中高（工具面/ token） |
| H | 跨工具导出 | `/context export` 生成 `AGENTS.md` 兼容只读段落，不写用户文件 | W3 | S | 低 |
| I | 文档/叙事 | `compaction-vs-handoff.md`、README 边界、报告回链、发布说明 | W0/W1 | S | 低 |

规模：S ≈ 1 批（半天内），M ≈ 2–3 批，L 不做。

---

## 3. 逐条方案

### A. 检索与召回（P0，W1）

**问题**：归档和记忆都是纯文本，但没有任何「按问题找条目/会话」的入口；这是调研里最便宜的短板。

**做法**：
1. 新增 `/context find <query>`（`/context` 已是伞命令，和 `/context task` 同族；不新造 `/find`）。
2. 检索源（只读、按需读，不建持久索引）：
   - `MEMORY.md` 的每条 `- ` 条目（四节）；
   - `CONTEXT.md` 的小节与 Open tasks；
   - `tasks/<slug>.md`；
   - `session-logs/<id>/meta.json`（标题/任务/kind/日期）；
   - `HANDOFF.md` 与最近 `session.md`（可配置条数上限，默认 20 个会话）。
3. 排序：整串命中 > 全部词命中 > 任一词命中；同分按新到旧；CJK 用 bigram 兜底，英文用词边界。
4. 输出：Top N（默认 8）带 `path:line` 与一行上下文；总字符上限（默认 6–8KB），超限截断并报「还有 N 条」。
5. 不调用模型、不写盘、不缓存跨进程；一次查询内按 mtime 去重。

**改动面**：新模块 `src/project-context/search.ts`（或 `src/shared/search.ts`）；`project-context/index.ts`
注册 `/context find` 分支；`README.md` 命令表；`docs/behavior.md` 补检索语义。

**验收**：
- fixture 项目 3 个会话 + 1 份记忆：指定查询 Top 3 必含目标；不存在词返回 0；
- 输出含 `path:line`；总长不超上限；空项目返回明确「没有可检索内容」；
- 全程无模型调用（用假 ctx 断言）。

**不做**：向量/嵌入、持久倒排索引、跨项目检索、写盘缓存。

### B. 记忆可观测（P0，W1）

**问题**：裸 `/memory` 只说路径和 cap 警告；用户看不到「文档多满、几条、journal 多大、备份几个」。

**做法**：扩写 `memoryStatusReply`（不新增子命令）：
- 字符/上限、四节各自条目数（用 `loadMemory` + `sectionsFromMarkdown`）；
- journal 行数与字节、备份文件数、`errors.log` 行数（只报计数，不解析内容）；
- 归档目录数、`INDEX.md` 行数（读 `session-logs`，不扫全文件）；
- 现有 damaged/poisoned/capped 警告原样保留。

**改动面**：`src/project-memory/index.ts` 的 `memoryStatusReply`；可能需要 `memory-store.ts` 暴露
journal 统计；测试 `test/logic.test.mjs` 或新 `test/memory-status.test.mjs`。

**验收**：
- 所有数字可由文件系统复算；空项目/有 journal/有备份/有归档四态；
- capped 文档仍显示警告；不误报「最近一次整理结果」（该值没有持久化，不编造）；
- 输出 < 3KB。

**不做**：读 `errors.log` 正文、解析上次 pass 结果、引入状态文件。

### C. 压缩感知（P0，W1，只读）

**问题**：dsh 压缩是活的，但用户和回执都看不到「这个会话压缩过几次、最近一次压缩后还多满」。

**做法**：
1. 新增纯函数 `compactionStats(events)`：折叠 `compaction/start|summary|end`，返回
   `{count, lastAtSeq, lastSummaryTokens?, lastEndSeq}`；payload 形状不匹配时返回
   `{available:false}`，**不得当 0**。
2. `/handoff status` 增加一行：`compactions N (last seq X, summary Y tokens)`；没有事件时
   `no compaction recorded`。
3. 只在 status（和将来的回执）用；不改触发、不改注入、不碰 `ctx.compaction`。

**改动面**：`src/project-handoff/compaction-stats.ts`（新）；`command.ts` 的 `statusText`；
`test/handoff-decide.test.mjs` 或新 `test/compaction-stats.test.mjs`。

**验收**：
- 合成事件 0/1/3 次；乱序/缺 `summary`/未知 payload → `unavailable`；
- 计数与 `session.snapshotEvents()` 逐条一致；重启后从日志折叠仍一致；
- 触发路径零改动（变异：删掉 status 行，只有 status 用例红）。

### D. 交接回执（P1，W2）

**问题**：回执已有阈值/路由/携带物变体，但没有把「压缩历史」和「为什么现在交接」放在一起。

**做法**：
- 在 `statusText` 的输出里把 C 的压缩行放在 `context` 行之后；
- 若 `handoff` 刚发生，`/handoff status` 报最近一次种子的三件事：尾料消息数、文件清单数、
  未答问题（已有 `continuationCarried/Trimmed/Nothing`，补数字）；
- 每个数字必须来自决策用的同一对象（`handoffSplit` / `measuredContext`），不得二次估算。

**验收**：数字与 `HANDOFF.md` 一致；拒绝/延后时不报「已交接」；空尾料显示 `0` 而非省略。

### E. 技能治理（P1，W2）

**问题**：采纳技能后没有「依据哪几条会话」的回执；技能与既有记忆/技能冲突只能靠人看。

**做法**：
1. 采纳时在 `SKILL.md` 的可选 frontmatter 记录 `evidence: [session ids]` 与
   `derived_from: autolearn`；不改变正文格式，`sectionsFromMarkdown` 不受影响。
2. `/autolearn list` 与 approve 回执显示证据条数与 session id 前 8 位。
3. 机械冲突检查：把候选技能的关键 token（反引号词、路径、命令）与既有 `SKILL.md`/`MEMORY.md`
   比对，重叠超阈值时在回执里点名冲突对象；**不调用模型、不自动拒绝**。

**验收**：无证据 → 候选不晋升；采纳回执含 N 条证据；冲突检查对构造的重复技能开火、
对无关技能不误报；既有 `autolearn-generated` 语义不变。

### F. 任务维度（P1，W2）

**问题**：`/context task` 只有 slug/状态/标题；看不到绑定会话数、未完成 todo、最近活动。

**做法**：只读扩展列表行：`slug · 状态 · 标题 · sessions N · open todos M · last seen <date>`；
数据来自 `session-logs/*/meta.json` 与 `tasks/<slug>.md` 的 todo 行；不新增写路径。

**验收**：数字与文件一致；archived 任务不显示注入状态；无任务时明确提示。

### G. 模型侧检索（W2/W3，需裁定）

三个选项，互斥，先选一个：

| 选项 | 做法 | 优点 | 代价 |
|---|---|---|---|
| G1 命令 only | 只做 A | 零新面、零风险 | 模型不能主动查 |
| G2 只读工具 | 注册 `project_context_search`，参数 query/scope，返回带引用片段 | 模型可自主查；对标 mnemon/agentsearch | 打破「本包不注册工具」的现状；每轮多一个 schema；需设计裁定 |
| G3 注入时相关性 | 请求准入时按最后一条用户消息选 Top K 条目注入 | 无工具面 | 相关性错误会污染每轮；token 不可预测；与「常驻+指针」冲突 |

**建议**：先做 G1，用 `/context find` 的真实使用数据决定是否上 G2；G3 不做，除非出现「模型反复问同一
旧事实」的明确证据。若上 G2：工具名带命名空间、结果硬上限、默认关闭（需一个新配置键，走六面），
且必须证明它不改变「无工具」的既有不变量叙事。

### H. 跨工具导出（P2，W3）

**做法**：`/context export` 输出一段 `AGENTS.md` 兼容 Markdown（Project/Invariants/Pitfalls 摘要 +
指针），默认只打印；`--write` 写到 `.agents/memory/EXPORT.md`，**永不改用户 `AGENTS.md`**。

**验收**：导出内容与 `MEMORY.md` 同源；不含密钥；重复导出字节稳定；不触发任何写路径。

### I. 文档/叙事（W0/W1）

- 新增 `docs/compaction-vs-handoff.md`：压缩 vs 交接的边界、交叉点计算、`/handoff status` 压缩行
  规格、`compactNow` 可调用性探针清单。
- README「行为与边界」补一句：压缩归宿主，交接归本插件；`handoffThreshold` 可把交接退化为兜底。
- `docs/research/2026-11-18-similar-projects.md` 的 §10 与本方案互链。
- `CHANGELOG.md` 的「未发布」按批次各记一条。

### J. 可靠性/测试（贯穿）

- 每个新纯函数配 fixture 测试；每个新命令配「真实 `apply()` 接线」用例（照 `top-level-gate` 的做法）。
- 涉及状态/回执的批次必须做变异轮（删行/反转优先级/把 `unavailable` 改成 0），只红目标用例。
- 任何新事件解析必须允许「形状不认识」并报 `unavailable`，不得静默当 0。
- 门禁仍是手工三连：`pnpm typecheck` / `pnpm build` / `pnpm test`；`lib/` 必须 diff 干净。
- 不为新功能引入新依赖；不碰 `ctx.compaction`。

---

## 4. 波次与顺序

### Wave 0（先做，纯文档）

1. `docs/compaction-vs-handoff.md`（已同意）。
2. 本方案进 `docs/README.md` 索引。
3. 不改 `src/`；不重启宿主。

### Wave 1（P0，3 批，全只读）

| 批 | 内容 | 依赖 | 交付 |
|---|---|---|---|
| W1-A | `/context find` | 无 | 命令 + 测试 + README |
| W1-B | `/memory` 状态扩写 | 无 | 回执 + 测试 |
| W1-C | `compactionStats` + status 行 | 无 | 纯函数 + status + 测试 |

三批都无新配置键、无写路径、无模型调用；可并行开发，但按 A→B→C 合并以减少冲突。

### Wave 2（P1，3 批）

| 批 | 内容 | 依赖 |
|---|---|---|
| W2-D | 交接回执补压缩/种子数字 | W1-C |
| W2-E | 技能证据回执 + 机械冲突检查 | 无（但需定 frontmatter 形状） |
| W2-F | 任务列表扩展 | 无 |
| W2-G | 模型侧检索裁定（只裁定，不实现） | W1-A 使用数据 |

### Wave 3（P2，按裁定）

- `compactNow` 可调用性探针（只探针，不实现兜底）；
- `/context export`；
- 只读面板（若要，先做卡片测试基建）；
- 重要性/衰减（需单独设计，可能永远不做）。

---

## 5. 需要拍板的五件事

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | 检索面 | G1 命令 / G2 工具 / G3 注入 | **先 G1**；G2 等真实使用数据；G3 不做 |
| D2 | 是否扩 UI | 无 / 只读面板 / 完整浏览器 | **W1 无 UI**；先把数字做对 |
| D3 | 压缩兜底 | 只观测 / 探针 `compactNow` / 实现 | **只观测 + 探针**；未证不写承诺 |
| D4 | 默认阈值 | 保持膝线 / 调到压缩线 | **保持膝线**；文档给出 `0.8`/`800k` 的杠杆与代价 |
| D5 | 新配置键 | 无 / 有 | **Wave 1 无**；G2 若上，只加一个默认关闭的键，走六面 |

---

## 6. 成功指标

- **检索**：fixture 查询 Top 3 命中率 ≥ 90%；50 个会话的查询 < 200ms；输出不超上限。
- **状态**：所有数字可用文件系统复算；空/满/损坏三态都有明确文案；0 处「猜」。
- **压缩感知**：计数与日志 100% 一致；未知 payload 100% 报 `unavailable`；触发路径零 diff。
- **交接回执**：数字与 `HANDOFF.md`/`handoffSplit` 同源；拒绝不冒充成功。
- **技能**：采纳 100% 带证据；冲突检查只对构造冲突开火。
- **可靠性**：每批 `typecheck`/`build`/`test` 绿；变异矩阵只红目标；`lib/` 无残留。

---

## 7. 明确不做

- 不实现压缩器、不接管 `ctx.compaction`、不抢 `agent/pre-step`。
- 不把 handoff 改成 mid-turn 触发。
- 不引入 DB/向量/服务端依赖。
- 不做无审核的技能自动采纳。
- 不为「看起来智能」增加模型调用（尤其交接路径保持零模型调用）。
- 不在 Wave 1 加配置键、不改阈值默认值。

---

## 8. 第一批的落地顺序（建议）

1. 写 `docs/compaction-vs-handoff.md`（规格，含交叉点与探针清单）。
2. W1-C（压缩感知）先做：纯函数 + status 行，风险最低，立刻让 `/handoff status` 有压缩证据。
3. W1-B（`/memory` 状态）第二：只读、只加数字。
4. W1-A（`/context find`）第三：改动面最大，先出检索语义 spec 再写代码。
5. 三批合并后跑一次全量门禁 + 变异轮，再决定 W2 的 G2/D3。
