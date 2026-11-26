# 术语表（GLOSSARY）

> 本仓库的标准术语。现行文档（[README](../README.md) 与 `docs/` 下除历史档案外）、注释、回执与记忆一律使用
> 「规范写法」一列；同义异名视为缺陷。已冻结的档案（`docs/archive/`、`docs/changelog/`）与带日期的规格
> （`batch-*-spec.md`）保留写作时原文。代码标识符保持英文原名，不改写。

## 概念

| 规范写法 | 定义 | 代码锚点 |
|---|---|---|
| 插件包（package） | 本仓库的发布单元，含 4 个 cordis 插件与 1 张设置卡片 | `package.json:8-30` |
| 插件（plugin） | 一个 cordis 插件，导出 `name` / `inject` / `apply` | `src/*/index.ts` |
| 宿主（host） | 运行插件的 dsh 进程（desktop / web） | — |
| profile | 一份 dsh 安装配置（`~/.dsh/profiles/<name>`），决定依赖 pin 与 `cordis.patch.yml` | — |
| 会话（session） | 有独立事件日志的对话单元；子代理会话的 `origin` 为 `subagent` | `src/shared/lifecycle.ts` |
| 回合（turn） | 会话内一次用户→模型→工具循环，边界是 `turn/start` / `turn/end` | — |
| 子代理（subagent） | 由宿主或交接创建、`origin: "subagent"` 的会话 | `src/project-handoff/child.ts` |
| 归档（archive） | ① 把会话事件写成 `session.jsonl` / `session.md` / `INDEX.md` | `src/project-context/start.ts:127` |
| 记忆（memory） | ② 由 journal 折叠出的 `MEMORY.md`，每轮注入 | `src/project-memory/load.ts:151` |
| 上下文（context） | ② 每会话的 `CONTEXT.md` 或 `tasks/<slug>.md`，含摘要 / 关键点 / Open tasks | `src/project-memory/context-doc.ts` |
| 记忆日志（journal） | `memory.jsonl`，append-only，记忆的唯一权威 | `src/project-memory/journal.ts` |
| 条目（entry） | 记忆文档里一个 `- ` 项目符号事实，带 3 位十六进制 id | `src/project-memory/retirement.ts:61`（`entryTid`）、`src/project-memory/sections.ts`（语法） |
| 段落（section） | 记忆文档的四个固定 `##` 段：Project / Invariants / Pitfalls / Index | `src/project-memory/memory-schema.ts` |
| 整理（consolidation） | ② 的模型 pass：`/memory update`，产出记忆与上下文 | `src/project-memory/consolidate.ts:69`（`consolidateProjectState`） |
| 沉淀（autolearn） | ③ 的模型 pass：把材料沉淀成项目技能 | `src/project-autolearn/pass.ts` |
| 候选（candidate） | 沉淀产出、尚未提升为受管技能的文件（`skill-candidates/`） | `src/project-autolearn/candidate.ts` |
| 受管技能（managed skill） | 由沉淀提升、带基线指纹的技能；手写技能不受管 | `src/project-autolearn/skill-state.ts` |
| 交接（handoff） | ④ 上下文越线时把会话续进新会话并写 `HANDOFF.md` | `src/project-handoff/perform.ts:126`（`performHandoff`） |
| 种子（seed） | 交接写进新会话的首条消息（含 `<handoff>` 块与种子 id） | `src/project-handoff/summary.ts` |
| 设置命名空间（settings namespace） | 设置 schema 所在的 Loader 条目；四张卡各有自己的 schema 与发布方，共用十键只由 `project-context` 条目发布 | `src/shared/settings.ts` |
| 设置卡片（settings card） | 浏览器半边的设置界面（四张卡、无页签：共用 / 整理 / 沉淀 / 交接） | `client/settings-card.tsx` |
| 预算（budget） | 字符或 token 的分配额（`maxMemoryChars` / `maxOutputTokens` 等） | `src/shared/limits.ts` |
| 上限（cap） | 硬性截断阈值，超过即丢弃或拒绝 | `src/shared/limits.ts:8-15` |
| 门禁（gate） | 推送前必须通过的可复现检查（命令 + 退出码） | `RULES.md` 第 6 章 |
| 快照（snapshot） | 带日期的事实读数；引用前必须现读 | `AGENTS.md` 头部 |
| 探针（probe） | 只读取证脚本，用于证明运行期行为 | `.agents/evidence/*/probe.mjs` |
| 退休（retire） | 把不再成立或过期的条目移出文档并留墓碑 | `src/project-memory/retirement.ts`（判定）、`src/project-memory/retired.ts:114`（落盘） |
| 墓碑（tombstone） | 退休记录，写在 `retired.md` | `src/project-memory/retired.ts:114`（`appendTombstones`） |
| 侧车（sidecar） | `entries.json`：条目 id → 日期 / 确认，不进文档正文 | `src/project-memory/entry-sidecar.ts` |
| 证据（evidence） | `.agents/evidence/` 下冻结的取证材料 | `RULES.md` 3.7 |
| 证据（引用） | 沉淀产出的 `evidence:` frontmatter：被核对的 session id 列表；回执写作「证据：N 个会话」 | `src/project-autolearn/evidence.ts`（`evidenceText`） |
| 变异验证（mutation check） | 把修复改回原样、确认具名用例变红的证明 | `.agents/skills/dsh-plugin-mutation-round/SKILL.md` |
| 权威（authority） | 唯一事实源（journal、`session.jsonl`）；`MEMORY.md` 与 `INDEX.md` 是派生投影 | `docs/architecture.md` 第 8 节 |

## 禁止的同义异名

- 设置卡 / 设置面板 → **设置卡片**
- npm 包 / 包体 → **插件包**
- 记忆整理 / 整合 → **整理**（consolidation）
- 技能沉淀 / 学习 → **沉淀**（autolearn）
- 交接摘要 / 摘要器 → **交接**（handoff）；本项目**没有**摘要器（见 `src/project-handoff/summary.ts`）
- 尾标 → **条目 id**
- 清理 / 清洗 → **退休**（retire）或 **清洗通道**（prune，仅指 `src/project-memory/prune.ts`）

## 状态词（代码枚举 ↔ 回执中文）

四张状态核与两张词表各只有一处中文映射（下表最后一列），回执里出现英文枚举名即视为缺陷。改词表与改本表
必须同轮，否则下一个改回执的人会另造一个写法。

| 词表 | 英文枚举 | 中文规范写法 | 唯一来源 |
|---|---|---|---|
| 记忆条目态（七态） | `superseded` | 已被取代 | `ENTRY_STATE_LABEL`（`src/project-memory/entry-state.ts`） |
| | `anchor-drift` | 锚点漂移 | |
| | `task-closed` | 任务已归档 | |
| | `version-shipped` | 版本已发布 | |
| | `age-unconfirmed` | 年龄未确认 | |
| | `content-stale` | 内容已变 | |
| | `healthy` | 健康 | |
| 技能态（六态） | `unbaselined` | 未建基线 | `SKILL_STATE_LABEL`（`src/project-autolearn/skill-state.ts`） |
| | `expired` | 已过期 | |
| | `moved` | 已搬走 | |
| | `drifted` | 已漂移 | |
| | `orphan` | 无引用 | |
| | `intact` | 完好 | |
| 会话日志态（八态） | `live` | 进行中 | `SESSION_STATE_LABEL`（`src/project-context/session-state.ts`） |
| | `settled` | 已结束 | |
| | `stale` | 已过期 | |
| | `orphan` | 无行 | |
| | `missing` | 缺失 | |
| | `abandoned` | 已遗弃 | |
| | `dangling` | 悬挂 | |
| | `unbaselined` | 未对账 | |
| 任务态（三态） | `active` | 活跃 | `TASK_STATUS_LABEL`（`src/project-context/task-usage.ts`） |
| | `dormant` | 休眠 | |
| | `archived` | 已归档 | |
| 清洗原因（五类） | `byte-backup` | 字节备份 | `PRUNE_REASON_LABEL`（`src/project-memory/prune.ts`） |
| | `journal-archive` | 归档日志 | |
| | `journal-temp` | 日志临时文件 | |
| | `error-log` | 错误日志 | |
| | `skill-candidate` | 技能候选 | |

两条词形规则：

- **「已 X」是完成态，「X」是名词短语**。`anchor-drift` 是「锚点漂移」（条目引用的路径不在了，名词短语，
  与 `docs/batch-z-six-problems-spec.md` 的用法一致），技能态 `drifted` 是「已漂移」（提升后的正文被改过）。
  两者都含「漂移」是对的，不要合并成一个词。
- **存档 / 归档分工**：**存档**是层名与存储（`① 存档`、`session-logs/`、「父会话不在存档」），**归档**是动作与
  状态（`归档会话数`、`已归档`、`被归档`）。README 的层表用「存档」、`/memory` 摘要用「归档会话数」，两者都
  不改。同义异名清单里的「清理 / 清洗」只被 `/memory prune` 的**通道名**（清洗通道）占用，原因列是分类词，
  不是通道名。
