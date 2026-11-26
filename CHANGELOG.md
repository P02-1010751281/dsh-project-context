# 更新日志

本仓库以 **`v0.1.0`** 作为首个发布（`package.json` 为 `0.1.0`）。更早的 `v0.1.0`/`v0.2.0`
标签因对应提交上的代码有误，已在本地与远端一并删除并作废。

- **未发布**：`v0.5.0` 之后的变更按时间倒序写在本文件里；发版时整段搬进 `docs/changelog/<version>.md`，
  本文件重新开一个空小节。
- **已发布**：每个版本一份 `docs/changelog/<version>.md`，本文件末尾的「版本目录」是唯一索引。
- 标注「修复」的条目都伴随一条**变异校验过**的回归测试（把修复改回原样，测试必须失败）。

## 未发布（`v0.5.0` 之后）

**文档（README / settings / GLOSSARY 与批次 AC 之后的实现对齐）**

- 性质：纯文档与注释修正，`src/` 只有注释变动（`lib/` 随重建同步），**行为零变化**，
  `pnpm typecheck` / `pnpm test`（832 例全通过）/ `pnpm docs:check` / `pnpm boundary:check` 全 exit 0。
  起因是 2026-11-26 按 `gated-review` 对 `README.md`、`AGENTS.md`、`RULES.md` 做了一次完整审查
  （声称逐条对源码实测 + 冷读 + 设计审问 + 门禁阴性对照），共九处与源码不符：
- `README.md` 配置表只列 20 个键，`DEFAULT_CONFIG` 是 23 个：补 `sessionSettledDays`、`taskMode`、
  `autolearnExpireSkills`——三个键都在 `src/shared/settings.ts` 的 schema 与 `client/card-fields.ts`
  的 `ROWS` 里，卡片上看得见，手册里查不到。提交 `ddc8260`。
- `README.md` 常见问题「先确认改的是 `project-context` 这一条（四个插件共享它）」与同页第 17–19 行
  「配置按卡分成四份 schema」自相矛盾：批次 AC 起是四张卡，改为逐张点名。
- `README.md` 致谢段说 AOCI 的漂移分类词汇「因本仓库没有 INDEX 对账报告面而未采纳」，已过期：
  `src/project-context/session-state.ts` 的 `SessionState` 含 `missing` / `orphan` / `stale` /
  `unbaselined`，`docs/research/2026-11-19-aoci.md:267` 记明 2026-11-21（`9a5062d` + 技能核）**已吸收**，
  并说明当初「不实现」的裁定是对的、所以那一笔是先把报告面建出来再换词。改为「已采纳三条」。
- `README.md:29` 的「（见「开发」）」是悬空引用：`1e3f675` 把 README 从 446 行拆到 141 行时删掉了
  `## 开发` 一节，括号里的节名不是 Markdown 链接，`pnpm docs:check` 查不出。改指 `docs/development.md`。
- `docs/settings.md` 开头仍写卡片「打开后是整理 / 沉淀 / 自动交接三区」，批次 AC 之后是四张卡、
  没有页签（`client/settings-card.tsx:298` 自述 `No tabs`）。改为四张卡并列明合计 23 个键。
- `docs/settings.md` 的字段表漏 `sessionSettledDays` 与 `autolearnExpireSkills`，而 README 第 102 行
  写着「每个键的完整语义见 `docs/settings.md`」——指向链本身不完整。补齐后覆盖 23/23。
- `docs/GLOSSARY.md` 两条术语过期（单独提交 `cad2888`，按 `RULES.md` 2.1 走 `docs(rules)`）：
  「设置命名空间」写「唯一的设置 schema 与发布方」（实为四份，共用十键只由 `project-context` 发布）、
  「设置卡片」写「三个页签」（实为四张卡、无页签）。
- 五个源文件加一个客户端文件的注释把共用键写成 `nine keys` / `shared nine`，而 `SHARED_KEYS` 与共用卡的
  `SHARED_SECTIONS` 都是 **10** 个（`archiveEnabled`、`sessionSettledDays`、`forceDedupeMs`、`maxTokens`、
  `maxOutputTokens`、`maxMemoryChars`、`taskMode`、`provider`、`model`、`handoffLang`）。共 23 行注释，
  提交 `a8f4f53`；`lib/` 随 `pnpm build` 重建，`git diff --exit-code -- lib` 为空。
- 未改的两处按既有豁免保留：`docs/research/2026-11-18-similar-projects.md` 的「四段共享一份配置」是
  2026-11-18 的调研史实；`.agents/evidence/2026-11-21-post-restart-acceptance/README.md` 的「三个页签 /
  三区」在 `.agents/evidence/` 下，按 `RULES.md` 3.7 证据冻结、只新建不回改。
- 登记在案的残余：`docs/batch-ac-settings-split-spec.md` 仍写「每张卡最多 9 行 / 共用 9」，那是批次 AC
  当时的设计规格（该批最终落地 10 键），属带日期的设计文档，按 GLOSSARY 的豁免不动。

**文档（第二轮：全项目覆盖审计，按 `gated-review` 的独立冷读报告逐条复现后修正）**

- 第二轮把审计面从三份治理文档扩到 **25 份现行文档**（`git ls-files '*.md'` 去掉 `.agents/`、`docs/archive/`、
  `docs/changelog/`、`docs/batch-*`、`docs/research/` 等冻结与史实），每处可核对断言都配一条实测命令。
  独立冷读共核 80 条声称、报 16 条不一致；**逐条复现后确认 11 条成立**并修，5 条属史实或已在本轮前修掉。
- `docs/behavior.md:213` 写「②③④ 只作用于顶层会话，① 对子会话同样留档」，与源码相反：`src/project-context/start.ts`
  的 `turn/end`、`agent/status`、`agent/disposed` 三个归档点都先过 `isTopLevel`（注释自述 "this one now does too"），
  用例 `test/top-level-gate.test.mjs:466` 的标题就是 `project-context: a delegated session is not archived on any
  lifecycle event`。改为「①②③④ 都只作用于顶层会话」，并点明显式命令是例外。
- `RULES.md` 7.2 的 append 通道漏了 `session.md` 与 `memory.jsonl`：`src/project-context/session-log.ts:234` 用
  `appendFile` 写 `session.md`，`src/project-memory/journal.ts:54` 用 `open(file, "a")` 写 `memory.jsonl`，journal
  轮转走 `copyFile` + `rename`。按 RULES 第 5 行「规则与代码冲突时以规则为准」，这条原本会让现状代码违规，已补全。
- `RULES.md` 5.1 说 host 侧「唯一值依赖 `schemastery`」：`lib/host/dsh/llm.js` 还值导入 `@deepseek-ai/dsh-llm/brand`
  与 `@deepseek-ai/dsh-session`（`SessionId`、`ReasoningEffortId`、`isSurfaceEligibleType`），三者都是 peer。
  改为列出这三类并保留「不新增运行时依赖」的原意。
- `RULES.md` 11 章说「全仓无 >900 行文件」：只在 `src/` 与 `client/` 成立（最大 801 行 `report.ts`）。
  `test/logic.test.mjs` 6579 行、`docs/upstream-pi-triage.md` 1613 行都超过，已收窄为「源文件」。
- `RULES.md` 8.2 写 `docs/changelog/<version>.md` 而 3.5 写 `v<version>.md`，实际文件名带 `v`（`v0.5.0.md`）；
  统一为后者。`RULES.md` 11 章「已记入 `CHANGELOG.md` 未发布例外」也过期——该记录在 v0.5.0 发布时随整段
  移进了 `docs/changelog/v0.5.0.md`，已改指。
- `docs/architecture.md:28` 说 shared 对插件的 import「唯一例外是 `shared → project-handoff/language`」，但它自己
  的表里列了两条（另一条是 `shared → project-handoff/conversation`，`src/shared/receipt-language.ts:22`）。
  `RULES.md` 4.2 的「两条共享层例外」是对的，已让 architecture 与之一致。
- `README.md` 常见问题里的诊断文案 `N section(s) exceeded their budget` 已从代码里消失（`28d2459` 起是
  `N whole entry(ies) were dropped from M section(s) because the memory document reached its character cap`，
  `src/project-memory/report.ts:241`），用户照手册 grep 会空命中。
- `README.md` 的「手动 `/handoff` **始终执行**」说过头：`src/project-handoff/command.ts` 仍会拒绝三种情形
  （已有交接在跑 `:250`、没有会话控制器 `:256`、有后台子代理在跑 `:265`），且 README 自己下一段就写了会拒绝。
- `README.md` 的「`archiveEnabled: false` 时不发生任何自动写入」也说过头：自动交接经 `performHandoff` →
  `bindHandoffChild`（`src/project-handoff/binding.ts:50`）写 `session-logs/<child>/meta.json`，而
  `grep archiveEnabled src/project-handoff` 为 0。已点名这个例外并说明它记的是交接链身份、不是存档。
- `README.md:72` 的「旧布局迁移：见 docs/architecture.md」指向不存在的内容（`grep -c '旧布局\|legacy\|迁移'
  docs/architecture.md` 为 0，该内容只在 `docs/batch-z-six-problems-spec.md`）。删掉该项，其余四项
  （锁、备份、`autolearn-state.json`、候选、journal 轮转）实测都在。
- `README.md` 命令表漏了 `/memory reconcile`（真实命令，`src/project-memory/start.ts:244` 的 description 与
  input hint 都列了它），已补一行并写明 `--accept` 只对非退役态写确认（`report.ts:655` 的 `retiresEntry`）。
- `README.md` ② 那行「每次整理 pass 之后跑一次清洗」不准确：`src/project-memory/update.ts:406` 的去重 pass
  提前返回，从不进入清洗分支。改为「真正跑了的整理 pass 之后追一次清洗」。
- 复核后**不改**的两处：`docs/memory-rewrite-loss-gate-spec.md:31` 与 `docs/upstream-pi-triage.md:1229` 里的
  `N section(s) exceeded their budget` 是规格与上游记录中的当时原文，属史实。
- `CHANGELOG.md` 自身的标题跳级（h1 → h3，`docgate` 报 `标题跳级：1` 并 rc=1）**改动前就存在**，从 v0.5.0
  发布起就有：顶层是 `# 更新日志`，未发布段却是 `### 未发布（…）`。按 RULES 2.4「冲突先改规则」，同一批把
  `RULES.md` 2.2 与 8.2 的 `### 未发布` 一并改成 `## 未发布`，再改 `CHANGELOG.md` 与三个引用它的技能
  （`dsh-command-receipt-localization`、`dsh-memory-pass-error-triage`、`dsh-project-context-release`）。
  改后 `docgate.py CHANGELOG.md` 从 rc=1 / 失败项 1 变为 rc=0 / 失败项 0。

## 版本目录

| 版本 | 日期 | 主要变更 | 明细 |
|---|---|---|---|
| `v0.5.0` | 2026-11-24 | 一份设置 schema 拆成四张卡（批次 AC，BREAKING）、SH-10 压缩取证、记忆上限抬到 54000 并零丢失压缩 | [v0.5.0](./docs/changelog/v0.5.0.md) |
| `v0.4.3` | 2026-10-06 | 整理提示词改为「压缩而不是删除」（批次 L） | [v0.4.3](./docs/changelog/v0.4.3.md) |
| `v0.4.2` | 2026-10-06 | 记忆分区预算、注入文档渐进披露、交接不再生成摘要、固定阈值不自称成功等 6 条 | [v0.4.2](./docs/changelog/v0.4.2.md) |
| `v0.4.1` | 2026-10-05 | `lib/` 纳入跟踪、项目根查找 | [v0.4.1](./docs/changelog/v0.4.1.md) |
| `v0.4.0` | 2026-10-05 | 命令面收口、设置名口径、autolearn 拉取模型、批 H 配置键 | [v0.4.0](./docs/changelog/v0.4.0.md) |
| `v0.3.0` | 2026-10-05 | 归档范围与会话索引、四节预算记忆、丢失回执与档 C、批 D/E 等 15 条 | [v0.3.0](./docs/changelog/v0.3.0.md) |
| `v0.2.1` | 2026-09-26 | 设置卡片改用平台组件、并发写入保护、自动沉淀 | [v0.2.1](./docs/changelog/v0.2.1.md) |
| `v0.2.0` | — | dsh 0.1.7-rc.2 宿主 API 适配、设置卡片、源码结构 | [v0.2.0](./docs/changelog/v0.2.0.md) |
| `v0.1.0` | 首个正式版本 | 归档 / 记忆整理 / 自动沉淀 / 交接四阶段首版 | [v0.1.0](./docs/changelog/v0.1.0.md) |
