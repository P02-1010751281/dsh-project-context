# 架构、数据流与源码结构

[README](../README.md) 的细节版：会话如何变成存档与记忆、磁盘上每个文件的用途、源码结构。
面向改代码的人；只想知道怎么用的读者不需要它。规则在 [RULES.md](../RULES.md)，术语在 [GLOSSARY.md](./GLOSSARY.md)，
阶段行为细节在 [behavior.md](./behavior.md)，配置项在 [settings.md](./settings.md)。

## 1 目录树与职责

```
src/project-context/   ① 归档：turn/end 追加、idle/disposed 落盘、/context、/session-log
src/project-memory/    ② 整理：整理 pass、/memory、/memory update、todo 机械行、退休与侧车
src/project-autolearn/ ③ 沉淀：低频 pass、/autolearn、候选与受管技能
src/project-handoff/   ④ 交接：turn/end 评估、/handoff、种子与子会话
src/shared/            四个插件共用的原语：配置、设置 schema、路径、锁、原子写、日志、生命周期
client/                设置卡片：字段表、渲染、zh/en 文案（bundle 进 lib/client.js）
scripts/               build-client.mjs（唯一产出 lib/client.js）、import-archives.mjs
test/                  *.test.mjs（按主题）+ 2 个共享 helper + fixtures/
lib/                   入库的构建产物（pnpm build 生成）
docs/                  机制文档、规格与索引（docs/README.md）
.agents/               memory/（记忆与存档）、skills/（项目技能）、evidence/（冻结证据）
```

## 2 分层与依赖方向

- 层：插件入口（`index.ts`）→ 实现模块 → 调用点；`src/shared/` 在最底层，不持有插件业务。
  唯一例外是 `shared → project-handoff/language`（纯字符串判定 `isHandoffContinuationText`，见下表末行），
  该边已列进白名单；shared 不得再新增对插件的引用。
- 允许的跨插件 import（白名单：7 条边、12 个不同 specifier、共 14 处）：

| 边 | 证据 |
|---|---|
| `project-autolearn → project-memory` | `src/project-autolearn/pass.ts:16` |
| `project-autolearn → project-context` | `src/project-autolearn/pass.ts:17`、`src/project-autolearn/pass.ts:18` |
| `project-context → project-memory` | `src/project-context/index.ts:22`、`src/project-context/index.ts:23`、`src/project-context/memory-export-source.ts:23`、`src/project-context/memory-export-source.ts:24`、`src/project-context/memory-export-source.ts:25`、`src/project-context/memory-export-source.ts:26`、`src/project-context/task-usage-source.ts:18` |
| `project-context → project-handoff/language` | `src/project-context/session-index.ts:16` |
| `project-handoff → project-memory/tasks` | `src/project-handoff/binding.ts:25` |
| `project-handoff → project-context/session-meta` | `src/project-handoff/binding.ts:26` |
| `shared → project-handoff/language` | `src/shared/conversation.ts:9` |

- 判据见 `RULES.md` 4.2；新增一条边或一个 specifier 即失败。

## 3 工具链版本

- Node：`^22.19.0 || >=24.0.0`（`package.json:77-79`）；TypeScript `^5.9.0`、esbuild `^0.28.2`（`devDependencies`）。
- 锁定文件：`pnpm-lock.yaml`（`lockfileVersion: '9.0'`）。
- dsh API 基线：`0.1.7-rc.2`（`devDependencies` 精确钉，peer 写 `>=0.1.7-rc.2`）；宿主会更新，升级前读 [harness/integration.md](./harness/integration.md)。

## 4 模块边界与公开 API

- 包导出 7 个键（`package.json:8-30`）：`.` → project-context、`./memory`、`./autolearn`、`./handoff`、`./client`、`./cordis.patch.yml`、`./package.json`；内部模块不得被外部导入。
- 入口导出 `name` / `inject` / `apply`：
  - project-context：`src/project-context/index.ts:126`、`src/project-context/index.ts:127`、`src/project-context/index.ts:136`
  - project-memory：`src/project-memory/index.ts:62`、`src/project-memory/index.ts:63`、`src/project-memory/index.ts:711`
  - project-autolearn：`src/project-autolearn/index.ts:30`、`src/project-autolearn/index.ts:31`、`src/project-autolearn/index.ts:91`
  - project-handoff：`src/project-handoff/index.ts:93`、`src/project-handoff/index.ts:95`、`src/project-handoff/index.ts:103`
- 调用点：宿主按 `cordis.patch.yml:8-16` 的 `insert` 装载四个条目（`project-context` → 包主入口，其余为子路径）；插件之间只走第 2 节的边。

## 5 运行与部署入口

- 无常驻进程、无监听端口、无环境变量；由 dsh 宿主按 profile 的 `cordis.patch.yml` 装载。
- 命令族：`/context`、`/session-log`、`/memory`、`/autolearn`、`/handoff`；每个命令的动词见
  [README](../README.md) 与各 `ctx.commands.register` 的 `input.hint`。

## 6 测试布局

- `test/` 平铺 `*.test.mjs`（按主题），另 2 个共享 helper（`session-views.mjs`、`context-fixtures.mjs`）与 `fixtures/`（含 `projection-typing/`）。
- 层：纯函数与状态核、真实 `apply()` 接线（`top-level-gate`）、卡片真渲染（`card-render`）、类型夹具（`projection-typing`，把 `tsc` 当判官）。
- 只跑一层：`pnpm build` 后 `node --test test/<name>.test.mjs`；整轮用 `pnpm test`（含 `tsc`）。

## 7 配置来源

- 唯一解析点 `src/shared/config.ts`（`DEFAULT_CONFIG` + 校验）；schema 在 `src/shared/settings.ts:48` 起，每个字段带 `volatile`。
- 发布方只有 `project-context`（`src/project-context/index.ts:134` 导出 `Config`、`src/project-context/index.ts:138` 发布）；其余插件用 `effectivePluginConfig(entry)` 读同一份。
- 用户值写在 profile 的 `cordis.patch.yml` 的 `project-context` 条目上（整体替换 `config`）。

## 8 数据存储（权威链）

```
<project>/.agents/memory/
  memory.jsonl                权威 journal（append-only）
  MEMORY.md                   派生渲染（注入 / 手改入口）
  MEMORY.md.memory-backup-*   覆写前备份（常留 5 份；1 小时内不删，但超过硬上限 20 份时连近期也轮换；src/project-memory/backup.ts:12）
  *.lock / *.steal            跨进程写锁（30s 陈旧，等待 +5s；src/shared/lock.ts:15）
  memory-log-*.jsonl          journal 512KB 折叠归档（保留 5 份；src/project-memory/journal.ts:24）
  CONTEXT.md                  工作态：摘要 / 关键点 / Open tasks
  tasks/<slug>.md             绑定任务的上下文文档
  entries.json                侧车：条目 id → 日期 / 确认
  HANDOFF.md                  最近一次交接的种子记录（含种子 id）
  autolearn-state.json        沉淀闸门（本地件，被 .gitignore 忽略）
  skill-candidates/<name>.md  候选
  retired.md                  退休墓碑（append-only 记录；src/project-memory/retired.ts:114）
  purge.log                   prune 清洗通道的日志
  trash/                      prune 移出的条目
  skill-bindings.json         受管技能的基线指纹（本地件）
  expired-skills/             已移出服役的技能
  errors.log                  各阶段异常（单条 8000 字符，>1MB 轮换保留 64k；src/shared/error-log.ts:14）
  session-logs/               INDEX.md + <id>/{session.jsonl,session.md,meta.json}
```

- 权威：journal 是记忆唯一的权威，`MEMORY.md` 是派生（`src/project-memory/load.ts:151`；损坏行跳过并计数，整份不可读时 fail closed）。
- 归档权威：`session.jsonl`；`INDEX.md` 由 `reconcileSessionIndexOnce`（`src/project-context/session-index.ts:495`）按目录重建，无行数截断。
- 忽略规则在 `src/shared/gitignore.ts:25`。

## 9 外部服务

- 唯一外部调用是宿主 LLM 服务：`requestPluginTextWithMeta`（`src/shared/model-call.ts:211`）经 `ctx.llm.stream`；无直接网络、无数据库。
- 预算读 `maxOutputTokens`；重试头寸固定；插件内无 timeout（见 `RULES.md` 第 11 章未决）。

## 10 一条端到端数据流：`/memory update`

1. 命令 → `consolidateProject`（`src/project-memory/index.ts:296`，命令与回执的包装）→
   `consolidateProjectState`（`src/project-memory/consolidate.ts:698`，模型 pass）。
2. 单飞 + 节流：同项目单飞（`activeConsolidation`，`src/project-memory/consolidate.ts:710`）、
   `throttle` 表（`src/project-memory/consolidate.ts:205`）。
3. 读入：`loadMemory`（`src/project-memory/load.ts:151`）+ 上下文，再经 `fitMemoryInput` 按输出预算裁一次（`src/shared/conversation.ts:41`）。
4. 模型调用：`requestPluginTextWithMeta`（`src/shared/model-call.ts:211`）；`tools` 被拒时换一次无工具重试。
5. 解析回复：`resolveReply`（`src/project-memory/consolidate.ts:533`）优先 `record_memory` 工具调用，其次四段 Markdown，最后不透明文本。
6. 有损闸（tier C）：会丢整条目的回复先定向重试，仍丢则整次拒绝、零写入，状态 `lossy-refused`
   （判定 `src/project-memory/consolidate.ts:1111` 的 `memoryLossyRefused`，回执行 `src/project-memory/index.ts:358`）。
7. 回填闸：tier C 与退休之后补回措辞级丢失（`src/project-memory/lost-entry-repair.ts:119`），`no-room` 时不写。
8. 渲染：`renderMemoryDocument` 只在到 cap 时丢整条目（`src/project-memory/sections.ts:173`）。
9. 落盘：`withMemoryLock`（`src/shared/lock.ts:213`）→ `backupMemoryBeforeWrite`（`src/project-memory/backup.ts:33`）→ `recordMemoryDocument`（`src/project-memory/record.ts:97`，基线变了就拒绝 `src/project-memory/record.ts:116`）→ `writeAtomic`（`src/shared/files.ts:68`）→ 上下文文档（`contextPath`，`src/project-memory/index.ts:522`）。
10. 回执只报真正落地部分；每次拒绝或裁剪另写一行到 `errors.log`。
- 失败分支：tier C 拒绝（零写入）、输出上限拒绝（`cut off by the model output limit`）、基线变化拒绝、回填 `no-room`、输出预算装不下两份文档（`fit-capped-refused`）。

## 11 状态（只读派生，无转移通道）

| 状态机 | 状态 | 权威与实现 |
|---|---|---|
| 会话 | `live` / `settled` / `stale` / `orphan` / `missing` / `abandoned` / `dangling` / `unbaselined` | 同时读 `INDEX.md`、目录与 `meta.json`，按 `sessionSettledDays` 派生（`src/project-context/session-state.ts:27`） |
| 技能（受管） | `intact` / `orphan` / `drifted` / `moved` / `expired` / `unbaselined` | 基线指纹 + 引用是否仍在（`src/project-autolearn/skill-state.ts:29`） |
| 条目 | `superseded` / `anchor-drift` / `task-closed` / `version-shipped` / `age-unconfirmed` / `content-stale` / `healthy` | 只读调用方给的事实，顺序固定（`src/project-memory/entry-state.ts:79`） |

- 三套的状态都是派生标签，读完即弃：会话核与技能核只报告 broken 状态（`SESSION_SEVERITY` /
  `SKILL_SEVERITY`）；条目核用 `NON_RETIRING_STATES`（`src/project-memory/entry-state.ts:38`）与
  `retiresEntry` 区分「只能报告」与「由整理 pass 退休」。状态核本身不改写文件；自动落盘只发生在三处：
  `INDEX.md` 的启动对账（`reconcileSessionIndexOnce`，`src/project-context/index.ts:152`）、整理 pass 的
  条目退休（`retireWithinBudget`，`src/project-memory/consolidate.ts:810`）、受管技能 `expired` 的移出
  （`rename` + 写 `skill-bindings.json`，`src/project-autolearn/skill-state-source.ts:227`）；
  `--accept` 只写确认、不改状态本身。
- 交接的触发状态在进程内存（`src/project-handoff/state.ts:15-45` 的 `handedOff` / `inFlight` / `failedUntil` 等），宿主重启即失效；判定链是 `decideAutoHandoff`（`src/project-handoff/decide.ts:85`）：阈值 → 未答问题（`defer`，`src/project-handoff/decide.ts:96`）→ 运行中的子代理（`defer`）→ `nothing-to-drop`（`skip`）→ `handoff`。

## 12 扩展点

- 新增插件：按 `RULES.md` 4.1 的清单（`cordis.patch.yml`、`package.json` 的 `exports`、`README.md`、本文档）。
- 新增配置键：按 `RULES.md` 9.1 的六面一次改完，并补 `test/settings-form.test.mjs` 的每键断言。
- 新增记忆段落：只改 `src/project-memory/memory-schema.ts`（四段 schema 与预算的唯一来源）。
- 新增只读状态 / 回执字段：按 `.agents/skills/dsh-readonly-state-core-extension/SKILL.md`。

## 13 生成物目录

- `lib/`：由 `pnpm build` 生成并入库（`tsc` 出 host 半边，`scripts/build-client.mjs` 出 `lib/client.js`）；**手改会被下次构建覆盖**，纪律见 `RULES.md` 10.1。
