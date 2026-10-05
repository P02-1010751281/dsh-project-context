# 词汇与命名规范（dsh-project-context）

**本仓自有文件**，属于本仓的规则，不随上游 pi 的对应文件联动。

适用范围：本仓代码、提示词与工具 schema、`docs/`、`CHANGELOG.md`、`README.md`、tag 与提交信息、`.agents/skills/` 技能正文。
不适用：第三方技能与全局技能（`~/.agents/skills/`）——那是别人的产物，本仓只读不写，也不按本文件改名。

来历：`v0.3.0` 用「一个事实一个名字」收束了**命令面**；2026-10-05 的批 H 收束了**持久化配置键**与
**`project-memory` 层的通知前缀**（证据：`docs/batch-h-vocabulary-keys-brief.md` 与
`docs/batch-h-vocabulary-keys-ruling.md`）。写下来是为了避免再次只改一半。

---

## 1. 总则

1. **一个事实一个名字**：同一个事实出现在两个地方，必须用同一个名字（命令、帮助、通知、状态行、文档、键名都算）。
2. **名字说的是那个事实**，不是动作、不是历史、不是实现方式。反例：两个 token 量曾被叫 `target` / `keep`，
   两个词都说不出量的是什么；现在是 `budget summary` / `budget recent`，各自命名被定量的对象。
3. **改名必须同轮改齐**：代码 + 提示词 + `docs/` + `CHANGELOG` + MEMORY + 本文件。只改一半 = 未完成。
4. **偏离本文件要写下来**：确有必要偏离时，在 §5「例外」记一条并写理由；不要静默偏离。

## 2. 分层词汇表

### 2.1 命令面

- 命令名 = 层名：`/memory`、`/session-log`、`/autolearn`、`/handoff`；跨层的是 `/context` 与设置命名空间 `project-context`。
- 动词 = 这一层做的动作；**参数住在改变它的那一层**。
- **四层的「立即执行」动词各不相同，这是已决而非残留**（§5 D1）：`/memory update`、`/session-log write`、
  `/handoff now`、`/autolearn`（裸调用）。动词描述本层动作，不追求跨层同字。
- 二级词命名「被定量的对象」：`budget summary` / `budget recent`，不用「动作 + 宾语」（`summarize target`）。

### 2.2 配置键（profile 的 `cordis.patch.yml`）

- **落点两处**：host 侧 `src/shared/config.ts`（`PluginConfig` + `DEFAULT_CONFIG` + 读取器 + `CONFIG_KEYS`）与
  卡片 `client/card-fields.ts`（接口 + 行表）。两处的键集必须一致（`test/settings-form.test.mjs` 比对），
  回写路径产出的键也必须是 schema 键（`test/config-vocabulary.test.mjs`）。
- 形式：camelCase，不带下划线；同一特性的键**同一拼写**（`autolearn*` 全用小写 `learn`）。
- **键名镜射改变它的那个东西**（批 H 终态，见 §5 K）：有命令就用命令路径，没有就用设置卡——`memoryEnabled`（**设置卡开关；dsh 没有改这个键的命令**）、`autolearnEnabled`（同）、
  `handoffBudgetSummaryTokens`（`/handoff budget summary`）、`handoffBudgetRecentTokens`（`/handoff budget recent`）、
  `handoffThinking`（`/handoff thinking`）、`handoffThresholdAuto`（`/handoff threshold auto`，与 `handoffThresholdRatio` 成对）、
  `handoffLang`（`/handoff lang`）。
- 开关：`<能力>Enabled`；量：`<对象>Tokens` / `<对象>Chars` / `<对象>IntervalMs`，对象词与命令面二级词一致。
- 卡片文案：`field.<key>` 与 `field.<key>Hint` 各一个字典条目，键随字段搬迁；**文案本身可以不改**——改名不是复述。
- **改键名 = 破坏性变更**，同轮改齐六个面：`config.ts`、`settings.ts`、`card-fields.ts`、`locales.ts` 的键、
  运行期 reader 与回写路径、测试。本仓**没有兼容读取**：旧名在 apply 期抛 `unknown config key`，
  所以两个 profile 的键改名必须与宿主重启**同步**完成（理由见 §5 K）。

### 2.3 用户可见文案

- **通知/回执前缀**：一层一个前缀，形态 `<层>: <事实>`，且前缀之后**不再重复层名**
  （`Memory: updated MEMORY.md`，不是 `Memory: memory updated`）。dsh 没有 host 侧通知服务，
  这一面就是命令回执与状态行。
- **两条豁免**：① `Usage: …` 行以命令名开头，不加层前缀；② 多行 status 报表用**行标签**
  （`/context`、`/session-log` 的路径报表），与单行回执是两个面。
- 现状（现读）：`memory` 层 `Memory: …`；`handoff` 层 `Handoff …`（`Handoff session created:` 等）；
  `session-log` 层 `Session log written: …`。`autolearn` 层以**对象**命名
  （`Skill candidates:` / `Skill created:` / `Skill rejected:` / `No skill was considered:`），
  **尚未裁定是否收敛为层名前缀**，记为开放项（§5 X）。
- **拒绝理由**：小写、无句号、`<对象> <条件>`；必须是可被测试断言的**字面量**，唯一定义处在
  `src/project-autolearn/candidate.ts`。现行全集：`invalid kebab-case name`、`missing description`、
  `description too long`、`body too short`、`body too long`、`body looks like an instruction injection`、
  `body not shown this pass`、`needs at least one verified session id`、`needs evidence from at least two different sessions`。
- **状态行**：` · <事实> <值>` 片段；事实词与命令面同词（`threshold auto`，不是另起同义写法）。
- **用法提示**：`Usage: /<命令> <动词> <二级词> <参数>`，照抄命令面，不另起同义写法。

### 2.4 模型可见词汇（提示词与工具 schema）

- 工具名与字段：`record_memory`（字段 `memory` / `context`）、`record_skill`
  （字段 `skill{name,description,body,evidence,candidate,reason}`、`need_sessions`、`inspect_skill`）；
  与代码里同一事实同名，wire 名用 snake_case。
- 提示词小节名：kebab-case 全小写名词短语 —— `<existing-skills>`、`<learned-skill-bodies>`、
  `<existing-memory>`、`<existing-context>`、`<project-memory>`、`<project-context>`、
  `<session-index>`、`<session-logs>`、`<recent-conversation>`、`<project>`。
- **三个动词定死**（prompt / CHANGELOG / docs / MEMORY 一律照用）：**show 展示**（本轮把既有正文喂给模型）、
  **merge 合并**（带原文重写）、**supersede 取代**（覆盖一条既有 learned 技能）。禁止用 update / rewrite / replace 混指。
- **数量与长度上限写在代码里**，不指望 schema 关键字（`maxItems` / `maxLength` 不保证被执行）：
  例：`inspect_skill` 最多 2 条的唯一归属是 `learnedBodies` 的 `MAX_INSPECT_SKILLS`，schema 不写 `maxItems`。

### 2.5 代码词汇

- 函数：verb + noun（`collectSkillInventory`、`buildPrompt`、`resolveThreshold`）；判定用 `isX` / `hasX` / `xOf`。
- 常量：`MAX_` / `MIN_`，单位的后缀写出来（`_CHARS` / `_TOKENS` / `_MS`）。
- **预算常量的名字必须说出它量的是什么**：`MAX_INSPECT_SKILLS` 量的是「本轮可点名的技能条数」。
- 理由/状态字符串就是枚举：改动只在定义处，测试断言引用同一批字面量。

### 2.6 文件与目录

- 技能目录：`.agents/skills/<name>/SKILL.md`；引用文件**只一层**：`references/<kebab>.md`。
- 候选：`.agents/memory/skill-candidates/<name>.md`。
- 名字：lowercase-kebab-case。

## 3. 术语表（中文 ↔ 代码/英文）

| 中文 | 英文 / 代码 | 说明 |
| --- | --- | --- |
| 存档 | archive | 落 `session.jsonl` / `session.md` / `INDEX.md` |
| 整理 | consolidation | 重写 `MEMORY.md` / `CONTEXT.md` |
| 沉淀 | autolearn | 从记忆/上下文/会话索引蒸出技能 |
| 交接 | handoff | 阈值达成时开 successor session |
| 学到的技能 | learned skill | 带来源标记的 **project** 技能 |
| 来源标记 | provenance marker | `<!-- autolearn-generated: … -->`（写在 body） |
| 清单 | inventory | 提示词里的「名字 + scope + 描述」 |
| 展示 | show / `shownNames` | 本轮把正文注入提示词 |
| 合并 | merge | 带既有正文重写 |
| 取代 | supersede | 覆盖既有 learned 技能 |
| 入口 / 引用 | entry / `references/*.md` | 分层技能的两半；入口自包含 |
| 候选 | candidate | 等人确认的提案文件 |
| 预算 | budget | `/handoff budget summary\|recent` 的两个量；键名也用它 |

## 4. 与上游接缝的约束（不得违反）

- **计数与长度上限写在代码里**：`maxItems` / `maxLength` 不保证被 provider 执行（例：`inspect_skill` 用 `slice`）。
- 无 tools 的路由会回退到「文本 JSON」：同一个 parser 必须同时吃两条路径，字段缺失要容错。
- **被截断的工具调用不可信**：finish reason 是 `max-tokens` 或缺失（没有终止流事件）时丢弃并重试一次。
  注意 dsh 的拼写是 `max-tokens`，pi 是 `length`——照抄 pi 的字符串会静默关掉重试。

## 5. 已决与终态

### D. 已决（不再当残留）

- **D1 四层「立即执行」动词不统一是故意的**：`update` / `write` / `now` / 裸调用，各自描述本层的动作。

### K. 配置键终态（**已落地 2026-10-05，批 H**，无兼容读取）

| 现值 | 终态 | 理由 |
| --- | --- | --- |
| `autoConsolidate` | `memoryEnabled` | 能力名是 `memory`（歧义最小）；不用动作词。**没有命令改它**，只有设置卡 |
| `autoLearn` | `autolearnEnabled` | 同特性拼写统一（`autolearn*`）+ `<能力>Enabled`；同样只由设置卡改 |
| `handoffTargetTokens` | `handoffBudgetSummaryTokens` | 镜射 `/handoff budget summary` |
| `handoffKeepTokens` | `handoffBudgetRecentTokens` | 镜射 `/handoff budget recent` |
| `handoffSummaryThinking` | `handoffThinking` | 镜射 `/handoff thinking` |
| `handoffAdaptive` | `handoffThresholdAuto` | 镜射 `/handoff threshold auto`；与 `handoffThresholdRatio` 成对 |
| `handoffLanguage` | `handoffLang` | 镜射 `/handoff lang` |
| `archiveEnabled` / `handoffEnabled` | 不变 | 已是 `<能力>Enabled` |
| `handoffPendingQuestion` / `handoffThresholdRatio` | 不变 | pi 未改，不在本批改名集内 |

**为什么没有兼容读取（已决）**：值由平台持久化进各 profile 自己的 `cordis.patch.yml`，dsh 无法改写该文件，
所以旧名别名**永远无法退休**；本仓此前拒绝过命令层别名（`/context-update`、`/handoff force`），这次同样拒绝配置层别名。
代价分两半（独立审查 F2 纠正过初稿）：`project-context` 这条 entry（settings 命名空间的 owner）在 apply 期抛
`dsh-project-context: unknown config key "<旧名>"`，它的卡片随之消失；另外三条插件各自的 entry 本来就**不带 config**，owner 抛错时
`publishProjectContextSettings` 还没执行，于是它们回落到 `DEFAULT_CONFIG` **静默**运行（`handoffBudgetRecentTokens` 20000、
`handoffPendingQuestion` `defer`）——`src/shared/settings.ts` 的文件头本来就写着这个回落。
**部署顺序因此是规则的一部分：先改两个 profile，再重启**，而不是重启之后再补。

### P. 通知/回执前缀终态（memory 层 **已落地 2026-10-05，批 H**）

一层一个前缀：`Memory: `（原 `Project memory…` 一族归入）、`Handoff …`、`Session log written: …`；
`memory` 层的产物按**文件名**报（`MEMORY.md` / `CONTEXT.md` / `MEMORY.md and CONTEXT.md`），
这样既不重复层名，又保住「不得声称某个没落地的产物已更新」。
两条豁免照旧：`Usage: …` 行与多行 status 报表。

### X. 例外

- 内部变量名（如 `keep`、`target`）只要不出现在用户可见文案与配置键里，可保留；改了更好，但不是规范要求。
- `Consolidation ran but produced no new memory or context.` 不在 `Project memory…` 一族内，且 pi 同样原样保留。
- **开放项**：`autolearn` 层的回执以对象命名（`Skill …`）而不是层名前缀；尚未裁定是否收敛。

## 6. 执行与核验

- 本规范被三处钉住：① 测试断言（文案、拒绝理由字符串、schema 字段、键集一致性）；② `README.md` 的字段表与
  `CHANGELOG.md` 的用词；③ 本文件。
- **改用户可见文案或键名的验收口径**：`git grep` 旧词在**现行面**清零（`src/`、`client/`、`README.md`、
  `CHANGELOG.md` 的 `未发布` 段、`docs/` 的现行描述）+ 相关测试绿 + 本文件与 `docs/` 同轮更新。
- **历史面豁免**：已发布版本的 `CHANGELOG.md` 小节、批 H/E 的 brief 与其改名表、`docs/upstream-pi-triage.md`
  记录「改名前状态」的段落，都是历史记录，**不重写**——需要更正时加日期附注。
- 发布前扫一遍：`git grep -nE '<旧词>' -- src client test README.md CHANGELOG.md docs/`，逐条判断是现行面还是历史面。
