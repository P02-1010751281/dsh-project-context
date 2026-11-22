# Batch AC 规格：设置命名空间拆成三张功能卡 + 一张共用卡

> 事实快照：2026-11-21T22:00+08:00（Asia/Shanghai）。profile 里的值、宿主行号与仓库行号都是当天现读，引用前重读。
> 上游基线：API 基线 `0.1.7-rc.2`（`package.json:80-107`），本机运行线 `0.2.2-rc.3`。
> 宿主源码下称 `HOST/` = `/nix/store/xbbn6inj2q64j88gsmjrljqkh1m572sy-dsh-desktop-0.2.2-rc.3/lib/dsh-desktop/repo/`；换 store 路径后按符号名重新定位。
> 本文只写规格：落地批次改 `src/`、`client/`、`lib/`、`test/` 与两个 profile 的 `cordis.patch.yml`，本文件本身不改这些。

## 0. 结论速查

1. **四份 schema、四个命名空间、零新增 Loader 条目**：`project-context`（共用/归档，留在 bundle 页）+ `project-memory`、`project-autolearn`、`project-handoff`（三张功能卡，分别挂在三个 row 页）。
2. 用户说的“三张独立卡”指三张**功能卡**；第四张不是新功能，是现有 bundle 卡瘦身后只留跨功能与归档的 9 个键。理由见 §2.5。
3. 23 个键按**互斥集合**分给四份 schema，每个键只在一份 schema 里声明；不允许重复声明，不允许“隐藏 schema”（有 schema 就必然有卡，见 §2.5）。
4. 共享字段（`provider`/`model`/`maxTokens`/`maxOutputTokens`/`maxMemoryChars`/`forceDedupeMs`/`taskMode`）只在共用卡上编辑；其余三张卡通过 project-context 的 **live 发布**读取，不复制值。
5. 每个插件除了读共享值，还必须**在每次使用时重解析自己 fiber 的 config**：一次 volatile-only 保存不重启条目，apply 时的 `entry` 是快照。这是本批最容易做错的一条，见 §2.3。
6. 一次保存从“一个 `mutate` + 一个 revision”变成“**每张卡一个 `mutate` + 各自 revision**”；四个命名空间最多四份文档。单次点击仍然只写一张卡，卡内仍是原子的。
7. 跨卡没有共享键，所以没有“两处都写同一个键”的一致性问题；唯一的跨字段约束是 `provider`/`model` 必须成对，必须在共用卡保存前拦住（§4.4）。
8. 迁移**不写自动改写脚本**：手工改两个 profile 的 patch，配一个只读校验探针；没有兼容读取器、没有“两处都有值时谁赢”的优先级——键出现在错误条目上就是 apply 错误（§3.4）。
9. 回滚必须**代码与 profile 成对**：新代码 + 旧 patch、旧代码 + 新 patch 都不是受支持的稳态（§3.5）。
10. 一个 npm 包只有一个 client bundle（`HOST/packages/client/modules/src/index.ts:204,906`）；`lib/client.js` **不拆分**，`scripts/build-client.mjs` 不改，只在同一个 `apply` 里注册四张卡（§5.3）。
11. 迁移期用严格解析器把旧位置的键变成响亮的 apply 错误；但错误只落在**拥有该键的条目**上，另外三个会退回共享默认值——这个半静默后果写进验收（§3.4、§4.5）。
12. 不做的事见 §7：不改整理/交接/沉淀语义、不引入 DB、不做热迁移、不拆包、不改默认值与边界。

---

## 1. 现状：为什么现在是一个命名空间

### 1.1 投影：一份 entry 的 `Config` 就是一张表单

dsh 0.1.7-rc.2 起没有 `settings.installSection()` 这类运行时注册。设置表单由**归属插件模块导出的 `Config` schema 投影**而来，命名空间就是 **Loader 条目 id**：

- `src/shared/settings.ts:4-8`：`SettingsForms.schema(entry) = entry.fiber.runtime.Config`，`describe()` 报 `ns = entry.id`。
- `HOST/packages/settings/settings/src/index.ts:302-343`：`describe()` 遍历 `configEditor.configuration()`，每个条目取 `entry.fiber.runtime.Config`，`schema(entry)` 在 `:426-430`；`ns = entry.options.id`。
- `HOST/packages/settings/settings/src/schema.ts:37-49`：`volatileForm(schema)` 只保留带 `volatile` 标记的字段；一个字段都没有时返回 `undefined`，`describe()` 直接跳过该条目（`HOST/.../settings/src/index.ts:306-309`）。
- 当前四个 Loader 条目里**只有 `project-context` 导出 `Config`**（`src/project-context/index.ts:134`）；`project-memory`、`project-autolearn`、`project-handoff` 的入口都没有 `Config`（分别从 `src/project-memory/index.ts:702`、`src/project-autolearn/index.ts:91`、`src/project-handoff/index.ts:103` 进入 `apply`，没有 schema 导出）。因此被宿主服务的设置命名空间只有 `project-context` 一个。
- 一张 schema 的 23 个字段全部标了 `volatile`（`src/shared/settings.ts:48-72`），所以这一张卡能编辑全部 23 个键。

### 1.2 共享读取：一个发布者，三个读者

四个插件共用一份配置，靠的是模块级发布：

- `publishProjectContextSettings`（`src/shared/settings.ts:98-116`）把 project-context 的 live config 存进模块级 `live`；`effectivePluginConfig`（`:118-121`）返回 `live?.() ?? fallback`。
- 其余三个在 `apply` 里只做 `resolvePluginConfig(rawConfig)` 拿到自己的条目配置（实际为空，因为值都写在 `project-context` 条目上），然后每次使用时调用 `effectivePluginConfig(entry)` 读共享值：`src/project-memory/index.ts:724,733,752,773,782,795,809,819,839`、`src/project-autolearn/index.ts:98,112,178`、`src/project-handoff/index.ts:117,178,204,217`。
- 因此 profile 里 `id: project-context` 的 `config:` 是唯一基座；写在 `project-handoff` 条目上的 handoff 键会被完全忽略（现有实现只在 `project-context` 的 schema/config 里读）。`docs/settings.md:21-27` 记录了这一点。

### 1.3 `volatile` 的真实后果（把任务描述里的“整张卡消失”说准）

- **单字段缺标记**：该字段从投影表单里消失，不能编辑；`mutate`/`write` 对不在 volatile 祖先下的路径直接拒绝（`HOST/.../settings/src/index.ts:388-390,400-407`；`schema.ts:74-81`）。
- **全部字段都缺标记**：`volatileForm` 返回 `undefined`，整个命名空间不被服务，客户端的 `whileServed` 永不触发，卡片**无错误、无日志地不渲染**（`src/shared/settings.ts:10-16`；`HOST/.../settings/src/index.ts:302-310`）。
- **标记同时是“活引用”**：schemastery 把 volatile 字段交成 live reference，`resolvePluginConfig` 通过 `fieldValue` 解引用（`src/shared/config.ts:131-138`）；只改 volatile 字段的写入由 Loader 原地提交引用、**不重启条目**（`src/shared/settings.ts:86-90`）。
- 结论：每个字段都必须 `.extra("volatile", true)`；且所有读取都必须是**读取器**，不能是 apply 时的快照（§2.3）。
- 不要用 `.volatile()` 修饰符：它会把 schema 的解析模式切成 volatile 并让导出类型不可命名（`TS2742`，`src/shared/settings.ts:39-46`）。

### 1.4 现在的保存语义

- 客户端一张卡 = 一个 `SettingsFormModel`（`client/settings-card.tsx:89-101`），保存时发**一次** `scope.mutate(ops, baseline.revision)`（`HOST/packages/client/ui-primitives/src/settings-form/form-model.ts:300-310`）。
- Host 侧 `SettingsForms.mutate(ns, ops, expectedRevision)` 对该 ns 的 `describe()` revision 做栅栏；不匹配抛 `SettingsConflictError`（`HOST/.../settings/src/index.ts:43-58,368-376`），wire 层映射成 `settings/conflict`（`HOST/packages/api/settings-controller/src/index.ts:242-266`）。
- 客户端把“revision 没动”解释成值被拒、把“revision 动了”解释成并发冲突（`client/settings-card.tsx:120-127`），两种文案分开（`client/locales.ts:13-15`）。
- 一次保存写一个 ns、一个 revision；卡内所有暂存字段原子落盘。

### 1.5 两个 profile 的现读值

两个 profile 的 patch 里只有 `project-context` 一个条目带配置；其余三行来自仓库的 bundle patch（`cordis.patch.yml:8-16`），没有 `config:`。

| profile | 文件:行 | `config:` 现读内容 |
|---|---|---|
| desktop | `~/.dsh/profiles/desktop/cordis.patch.yml:1191-1199` | `consolidateTurns: 1`、`maxMemoryChars: 52000`、`maxOutputTokens: 49152`、`handoffThreshold: "400000"`、`handoffBudgetRecentTokens: 20000`、`handoffPendingQuestion: wait` |
| web | `~/.dsh/profiles/web/cordis.patch.yml:54-60` | `maxMemoryChars: 52000`、`maxOutputTokens: 49152`、`handoffBudgetRecentTokens: 20000`、`handoffPendingQuestion: wait` |

这两个文件的值会随设置卡片保存而整份重写（`settings.mutate` 带 revision 重写 patch）；迁移前必须重读，不要把上表当结论抄。

---

## 2. 目标形状

### 2.1 数量

| 项 | 现在 | 拆后 |
|---|---|---|
| 被宿主服务的设置命名空间 | 1（`project-context`） | 4（`project-context`、`project-memory`、`project-autolearn`、`project-handoff`） |
| 导出 `Config` 的入口 | 1 | 4（同一批四个入口各自导出自己的 schema） |
| Loader 条目 | 4 | 4（不新增；只是另外三个从“无 Config”变成“有 Config”） |
| 客户端 bundle | 1（`lib/client.js`） | 1（不拆；见 §5.3） |
| 客户端卡片注册 | 1（`plugins.bundle.config`，key=`dsh-project-context`） | 4（1 个 bundle 卡 + 3 个 row 卡） |
| 一次保存的写入面 | 23 键一份文档 | 一张卡的键，一份文档；最多四份 |
| 客户端文件 | 5 | 约 10（§5.2） |

### 2.2 键归属规则与 23 行映射

规则按顺序应用，一条键只落一个集合：

1. **被两个及以上入口读的键 → 共用卡。** 这类键跨功能生效，放在任何单一功能卡上都会让另一个入口在“那个插件没加载/被禁用”时退回默认值。
2. **只被一个入口读的键 → 该入口自己的卡。** `archiveEnabled`/`sessionSettledDays` 只被 project-context 读，所以和共用键一起放在 project-context 的卡上（这张卡本来就是它自己的 bundle 卡）。
3. 现分组（`SECTIONS`）只作为起点；`forceDedupeMs` 现在在“记忆”页签下，但它同时被 autolearn 读（`src/project-autolearn/pass.ts:116` 与 `src/project-memory/consolidate.ts:742`），所以按规则 1 移到共用卡。

读点核对（只列配置读取，不含注释/文本分类）：

| 键 | 读它的入口 | 目标卡 |
|---|---|---|
| `archiveEnabled` | project-context（`index.ts:150,178,187,193,208`） | 共用（project-context） |
| `sessionSettledDays` | project-context（`index.ts:366`） | 共用（project-context） |
| `forceDedupeMs` | project-memory（`consolidate.ts:742`）、project-autolearn（`pass.ts:116`） | 共用 |
| `maxTokens` | project-memory（`consolidate.ts:829`）、project-autolearn（`pass.ts:163`） | 共用 |
| `maxOutputTokens` | project-memory（`consolidate.ts:829,844,863`）、project-autolearn（`pass.ts:166`） | 共用 |
| `maxMemoryChars` | project-context（`index.ts:236`）、project-memory（多处，如 `consolidate.ts:744`）、project-autolearn（`pass.ts:131`） | 共用 |
| `taskMode` | project-context（`index.ts:299,310`）、project-memory（`consolidate.ts:709` 等） | 共用 |
| `provider` | project-memory、project-autolearn（`src/shared/model-call.ts:103`）、project-handoff（`runtime.ts:129`） | 共用 |
| `model` | 同上 | 共用 |
| `memoryEnabled` | project-memory（`index.ts:774,783,796`） | 记忆 |
| `consolidateTurns` | project-memory（`consolidate.ts:740`） | 记忆 |
| `consolidateIntervalMs` | project-memory（`consolidate.ts:740`） | 记忆 |
| `autolearnEnabled` | project-autolearn（`index.ts:99,113`） | 技能 |
| `autolearnExpireSkills` | project-autolearn（`index.ts:77,102,114`） | 技能 |
| `autolearnTurns` | project-autolearn（`pass.ts:124`） | 技能 |
| `autolearnIntervalMs` | project-autolearn（`pass.ts:124`） | 技能 |
| `handoffEnabled` | project-handoff（`index.ts:118,179,204`、`command.ts:132`） | 交接 |
| `handoffThreshold` | project-handoff（`command.ts:193`、`threshold.ts:129`） | 交接 |
| `handoffBudgetSummaryTokens` | project-handoff（`command.ts:195`、`threshold.ts:478`） | 交接 |
| `handoffBudgetRecentTokens` | project-handoff（`auto.ts:56`、`command.ts:201`） | 交接 |
| `handoffPendingQuestion` | project-handoff（`decide.ts:96`、`perform.ts:49`、`command.ts:206`） | 交接 |
| `handoffLang` | project-handoff（`conversation.ts:603`、`command.ts:207`） | 交接 |
| `handoffRetireReplaced` | project-handoff（`perform.ts:284`） | 交接 |

计数：共用 9 + 记忆 3 + 技能 4 + 交接 7 = 23。与 `client/card-fields.ts:88-160` 的 `SECTIONS` 逐键相等（现有测试 `test/settings-form.test.mjs:45-63` 钉住这一条，拆后改成“四张表覆盖四份 schema”）。

`handoff` 不读 `maxTokens`/`maxOutputTokens`/`forceDedupeMs`/`maxMemoryChars`：`src/project-handoff/classify.ts:73,189` 只是在分类模型文本里出现的键名，不是配置读取。

### 2.3 共享字段的读取契约（本批最重要的正确性约束）

**问题**：今天只有 project-context 的字段是 live 的，因为其余三个读它的发布；project-context 自己也读发布。拆开后每个入口的字段都落在自己的 fiber 里，而 volatile-only 保存**不会重启条目**——apply 时的 `entry` 只是快照。若直接读 `entry`，卡片会显示“已保存”，但插件在重启前一直用旧值。这正是 `src/shared/settings.ts:86-90` 已经写下的理由。

**要求**：

- 每个插件在 `apply` 里解析出初始 `entry`，然后每次使用时重新解析自己的 fiber config：

```ts
// src/shared/settings.ts（新）
export function livePluginConfig(
  ctx: Context,
  fallback: PluginConfig,
  resolve: (raw: unknown) => PluginConfig,
): PluginConfig {
  const raw = (ctx as { fiber?: { config?: unknown } }).fiber?.config;
  if (raw === undefined) return fallback;
  try { return resolve(raw); } catch { return fallback; }   // 与现有发布的容错一致
}
```

- 共享值是 project-context 的发布，而且发布本身必须保持“读取器”语义：`publishProjectContextSettings(ctx, entry)` **签名不变**，内部改成 `live = () => livePluginConfig(ctx, entry, resolveSharedConfig)`。project-context 自己的读取也走 `effectiveSharedSettings(entry)`（即自己的发布），不能读 `entry` 快照。

```ts
// src/shared/settings.ts（新）
export type SharedSettings = Pick<PluginConfig, SharedKey>;
export function effectiveSharedSettings(fallback: SharedSettings): SharedSettings;
```

- 三个功能入口的用法：

```ts
const entry = resolveMemoryConfig(rawConfig);
const current = () => livePluginConfig(ctx, entry, resolveMemoryConfig);
const config = () => withShared(current(), effectiveSharedSettings(entry));
```

- project-context 自己是发布者，签名不变（传初始 `entry` 即可），但内部必须是读取器：

```ts
const entry = resolveSharedConfig(rawConfig);
publishProjectContextSettings(ctx, entry);   // 内部 live = () => livePluginConfig(ctx, entry, resolveSharedConfig)
```

- **删掉 `effectivePluginConfig`**，不要保留“读整份配置”的入口：否则某个调用点仍可能从共享发布里读到 15 个默认值（例如在 memory 里读到 `memoryEnabled: true` 的默认，而不是自己的条目值）。共享读取只能返回 `SharedSettings` 这 9 个键。
- 读取时机必须是“每次事件/每条命令”，不能在 `apply` 里缓存一份 `config` 常量；今天各入口已经基本如此（例如 `src/project-memory/index.ts:714` 的注入回调、`:809` 的命令路径），拆后逐处改成 `config()`。
- 若 project-context 条目没有加载（被禁用/apply 失败），发布不存在，`effectiveSharedSettings` 返回调用方 `entry` 里那 9 个键——即 `DEFAULT_CONFIG`。这是一个具名失败模式（§4.5），不是静默兼容层。

### 2.4 四份 schema 的字段清单

所有字段一律 `.extra("volatile", true)`。Host 侧的默认值与边界来自 `src/shared/config.ts:95-119`、`src/shared/limits.ts:8-13,52-60`；客户端**不能** import `config.ts`（它拉 `node:` 模块），只能 import 浏览器安全的 `limits.ts` / `threshold-spec.ts`，并由 `test/settings-form.test.mjs` 的 bounds 断言与 schema 对齐——数值不在卡片里另写一份。

**共用卡：`SharedSettingsSchema`（`project-context` 条目导出，bundle 页）** 9 键

| 键 | 类型 / 默认 / 边界 |
|---|---|
| `archiveEnabled` | boolean，true |
| `sessionSettledDays` | natural，7，1–365 |
| `forceDedupeMs` | natural，15000，≥0 |
| `maxTokens` | natural，8192，≥256 |
| `maxOutputTokens` | natural，32768，≥256 |
| `maxMemoryChars` | natural，40000，4000–200000 |
| `taskMode` | union `assisted` / `delegated` / `manual`，默认 `assisted` |
| `provider` | string，`""`；与 `model` 必须同时设置或同时为空 |
| `model` | string，`""`；同上 |

**记忆卡：`MemorySettingsSchema`（`project-memory` 条目导出，row 页）** 3 键

| 键 | 类型 / 默认 / 边界 |
|---|---|
| `memoryEnabled` | boolean，true |
| `consolidateTurns` | natural，6，≥1 |
| `consolidateIntervalMs` | natural，300000，≥1000 |

**技能卡：`AutolearnSettingsSchema`（`project-autolearn` 条目导出，row 页）** 4 键

| 键 | 类型 / 默认 / 边界 |
|---|---|
| `autolearnEnabled` | boolean，true |
| `autolearnExpireSkills` | boolean，true |
| `autolearnTurns` | natural，20，≥1 |
| `autolearnIntervalMs` | natural，1800000，≥1000 |

**交接卡：`HandoffSettingsSchema`（`project-handoff` 条目导出，row 页）** 7 键

| 键 | 类型 / 默认 / 边界 |
|---|---|
| `handoffEnabled` | boolean，true |
| `handoffThreshold` | string（`auto` / 比例 / token 数），默认 `formatThresholdSpec(DEFAULT_CONFIG.handoffThreshold)` |
| `handoffBudgetSummaryTokens` | natural，64000，8000–200000 |
| `handoffBudgetRecentTokens` | natural，20000，0–200000 |
| `handoffPendingQuestion` | union `defer` / `wait`，默认 `defer` |
| `handoffLang` | union `auto` / `zh` / `en`，默认 `auto` |
| `handoffRetireReplaced` | boolean，true |

**实现落点**：

- `src/shared/config.ts`：保留 `PluginConfig`（23 键的完整内部类型）与 `DEFAULT_CONFIG`；新增四个严格子集解析器 `resolveSharedConfig` / `resolveMemoryConfig` / `resolveAutolearnConfig` / `resolveHandoffConfig`，与现有 `resolvePluginConfig` 共用 `positive`/`string`/`boolean`/`bounded`/`threshold` 这些校验闭包（`config.ts:156-209`）。每个子集解析器对**不属于自己集合**的键抛错，错误消息点名该键属于哪张卡；`provider`/`model` 的成对校验只留在 `resolveSharedConfig`（`config.ts:226-230`）。
- `src/shared/settings.ts`：四份 schema、`publishProjectContextSettings`、`livePluginConfig`、`effectiveSharedSettings`、`withShared`；删除 `PluginSettingsSchema` 与 `effectivePluginConfig`。
- 新增 `src/shared/settings-namespaces.ts`：只放四个字符串常量（`"project-context"`、`"project-memory"`、`"project-autolearn"`、`"project-handoff"`），不 import 任何东西，供 host 与 client 共用，避免两边各写一份字面量。
- 四个入口：`export const Config = <自己的 schema>`；`apply` 用 `<自己的 resolver>`；读共享用 `effectiveSharedSettings`；读自己用 `livePluginConfig`。
- `src/project-handoff/command.ts:17,95`：`settings.update` 的目标从 `SETTINGS_NAMESPACE` 改为 `HANDOFF_SETTINGS_NAMESPACE`。这是本批唯一需要改写入命名空间的命令路径；`settingPatch` 写回的键不变（`command.ts:47-89`）。

### 2.5 被否的三个形状

**A. 三份 schema，共享字段归记忆卡。** 看似最贴近“三张卡”，但 `project-context` 仍要读 `archiveEnabled`/`sessionSettledDays`/`taskMode`/`maxMemoryChars`；它自己的 2 个归档键无处安放，只能塞进记忆卡。更重要的是：memory 条目被禁用或 apply 失败时，autolearn/handoff 失去共享发布，`maxMemoryChars` 从 profile 的 52000 退到 40000，`provider`/`model` 退到空——静默降级。**拒绝。**

**B. 四份 schema 里重复声明共享字段。** 每个功能卡各声明 `provider`/`model`/`maxOutputTokens`，用户要写三遍；三份值会漂移，`provider`/`model` 的成对校验在三个命名空间里各判一次，可能出现三个“半对”。**拒绝。**

**C. 引入第四份 schema 但不注册卡。** `describe()` 会为任何带 volatile 字段的 schema 投影一个命名空间；没有注册就没有页面，用户能看见 bundle 页/row 页却点不到这个表单，这些键成了不可达的存储。**拒绝。** 第四份 schema 必须是一张真实的卡。

**因此**：四份 schema、四张卡；其中三张是用户要的功能卡，第四张是现有 bundle 卡的瘦身（共用/归档），不是新增功能页。

### 2.6 去掉页签

拆后每张卡最多 9 行（共用 9、记忆 3、技能 4、交接 7），平台表单本身就是一项一块的竖排（`HOST/packages/client/ui-primitives/src/settings-form/fields.module.css:4-6`、`SettingsForm.module.css:4-6`），再加一层页签只会多一次点击。**本批移除 `SegmentedTabs`**：删除 `client/settings-card.tsx:314-320` 的 tab 构造、`:321-344` 的面板循环里的 `hidden` 切换，以及 `client/styles.ts:14` 的 `.dshPcTabs`；每张卡用 `<h3>` + 描述保留原来的 section 文案。共用卡的 9 行建议在同一表单内用两个 `<h3>` 分组（「归档与任务」：`archiveEnabled`/`sessionSettledDays`/`taskMode`；「辅助调用与预算」：`provider`/`model`/`maxTokens`/`maxOutputTokens`/`maxMemoryChars`/`forceDedupeMs`），仍然只有一个保存。`test/card-render.test.mjs:497-507` 的 tablist/panel 断言改成“每张卡没有 tablist、只有一个可见表单”。

---

## 3. 值如何迁移

### 3.1 现在值在哪

见 §1.5。要点：

- 两个 profile **只覆盖 `project-context`**；`project-memory`/`project-autolearn`/`project-handoff` 没有 profile 条目，也没有配置。
- profile patch 的语义是**整份替换** `config`，不是合并：`@deepseek-ai/cordis-plugin-include` 的 `applyEntryPatches` 对每个 override 执行 `target[key] = value`（仓库内 `node_modules/.pnpm/@deepseek-ai+cordis-plugin-include@1.0.9_*/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js:95-101`）。同 id 的重复块以后一个为准。
- 一个条目的 config 里出现别的卡的键，schemastery **不会拒绝**（实测 `PluginSettingsSchema({bogus:1})` 原样保留未知键），`projectForm` 只投影 schema 声明过的键（`HOST/packages/settings/settings/src/schema.ts:59-71`）。所以“放错条目”不会在 Loader 层报错，只能靠插件自己的严格解析器。

### 3.2 目标放置

| 原键（现在都在 `project-context`） | 拆后条目 | 卡 |
|---|---|---|
| `maxMemoryChars` | `project-context` | 共用 |
| `maxOutputTokens` | `project-context` | 共用 |
| `consolidateTurns` | `project-memory` | 记忆 |
| `handoffThreshold` | `project-handoff` | 交接 |
| `handoffBudgetRecentTokens` | `project-handoff` | 交接 |
| `handoffPendingQuestion` | `project-handoff` | 交接 |
| 其余未出现的键 | 不写入 profile，用默认值 | — |

两个 profile 的具体放置：

| profile | `project-context` 保留 | `project-memory` 新增 | `project-handoff` 新增 |
|---|---|---|---|
| desktop | `maxMemoryChars: 52000`、`maxOutputTokens: 49152` | `consolidateTurns: 1` | `handoffThreshold: "400000"`、`handoffBudgetRecentTokens: 20000`、`handoffPendingQuestion: wait` |
| web | `maxMemoryChars: 52000`、`maxOutputTokens: 49152` | 无（省略 `config:`） | `handoffBudgetRecentTokens: 20000`、`handoffPendingQuestion: wait` |

`project-autolearn` 两个 profile 都不需要条目（没有现存值）。

### 3.3 迁移步骤（每个 profile 一次，宿主停止时）

1. **备份并记哈希**：`cp cordis.patch.yml cordis.patch.yml.bak-$(date +%Y%m%d-%H%M)-settings-split`，`sha256sum` 两个文件写进证据目录。
2. **重读现块**：用 `sed -n` 读 §1.5 的行区间，确认值没被设置卡片写回改过。
3. **改 YAML**：把现有 `- id: project-context` 块瘦成只留共用键，新增 `- id: project-memory` / `- id: project-handoff`（web 只加 handoff）。保留原来的 `name:` 行，`applyEntryPatches` 会在 `name` 与目标不一致时跳过该补丁（`include/lib/index.js:95-99`），所以写错名字会响亮失败。
4. **不要创建同 id 的第二个块**：后一个会整份替换前一个，肉眼很难发现丢键。
5. **跑只读校验探针**（§3.6），确认四个 id 的键集合与允许集合一致、没有重复键、键值与备份一致。
6. **启动宿主**，按 §6.2 验收四张卡。

desktop 目标片段（值以 §1.5 的现读为准，下面是形状示意）：

```yaml
- id: project-context
  name: dsh-project-context
  config:
    maxMemoryChars: 52000
    maxOutputTokens: 49152

- id: project-memory
  name: dsh-project-context/memory
  config:
    consolidateTurns: 1

- id: project-handoff
  name: dsh-project-context/handoff
  config:
    handoffThreshold: "400000"
    handoffBudgetRecentTokens: 20000
    handoffPendingQuestion: wait
```

web 片段同理，只是 `project-memory` 整个块省略、`project-handoff` 只留 `handoffBudgetRecentTokens` 与 `handoffPendingQuestion`。

### 3.4 迁移期间两处都有值，以谁为准？

**没有优先级，也没有兼容窗口。** 原因是三者叠加：

- profile patch 整份替换 `config`，不是逐键合并（§3.1）。
- 四份 schema 的键集合互斥；每个入口的解析器只接受自己的键，别的键抛 `unknown config key`（实现要求，§2.4）。
- 没有别名/兼容读取器：`src/shared/config.ts:9-12` 已经为改名立过同样的规则——别名永远退不了场，宁可响亮失败。

所以：

| 情况 | 结果 |
|---|---|
| 键只在新条目上 | 正常。拥有它的条目通过，其他条目看不到它 |
| 键只在旧条目上（已迁移代码、未迁移 profile） | `project-context` 的解析器抛错 → 该条目 apply 失败、共用卡消失；`memory`/`autolearn`/`handoff` 的条目照常应用，但共享发布不存在 → 它们用 `DEFAULT_CONFIG` 的共享值（`maxMemoryChars` 40000、`maxOutputTokens` 32768、`provider`/`model` 空）。**半静默降级**，是本批最危险的中间态 |
| 键同时出现在旧条目和正确条目上 | 正确条目通过；旧条目因外来键抛错 → 共用卡消失，三个功能卡仍读正确条目的发布。不是“谁赢”，是一个 apply 错误 |
| 键出现在错误的功能条目上 | 该功能条目 apply 失败、它的卡消失；其他卡不受影响 |

因此迁移是**每个 profile 文件内的一次原子编辑 + 一次重启**；不存在“先写两处、慢慢切”的稳态。校验探针（§3.6）和宿主启动日志里的 `unknown config key` 是仅有的两个哨兵。

### 3.5 回滚

- **回滚单位是“代码 + profile”**。只回滚一个不行：
  - 新代码 + 旧 patch：`project-context` apply 失败、共用卡消失，三个功能入口退回共享默认值（上表第二行）。
  - 旧代码 + 新 patch：旧代码只在 `project-context` 的 schema 里认 23 键，`project-memory`/`project-handoff` 条目上的键被旧代码完全忽略；`project-context` 缺 `maxMemoryChars` 等键 → 全部退回默认值。**没有报错**，比上一种更静默。
- 回滚步骤：停宿主 → `cp` 回 `.bak-*` → `git revert`/切回上一提交 → 重建 `lib/`（`pnpm build`，由 lead 执行）→ 启动宿主 → 用同一份校验探针确认四个 id 回到旧形状。
- 备份文件保留到验收通过并过一轮宿主重启后再删。

### 3.6 要不要写迁移脚本？

**不写自动改写脚本；写一个只读校验探针。**

- 仓库不能写 `~/.dsh`（用户存储），自动改写会越过 ownership；profile 文件有大量注释与顺序，任何 YAML 重写都可能丢掉它们。
- 探针放 `.agents/evidence/2026-11-21-batch-ac-settings-split/probe.mjs`（证据，不进 npm 包），不新增 `scripts/` 里的发货脚本。
- YAML 解析用 profile 自己的 `yaml`，经 `createRequire` 从 profile 的 `package.json` 解析；已实测可用：

```js
const { createRequire } = require("node:module");
const requireFromProfile = createRequire("/home/user/.dsh/profiles/desktop/package.json");
const yaml = requireFromProfile("yaml");           // 已实测返回 parse
```

- 断言：
  1. 四个目标 id 各自最多出现一次；
  2. 每个块的 `config` 键集合 ⊆ 该卡允许集合（§2.4）；
  3. 同一个键不出现在两个块里；
  4. 与备份的 `project-context` 块相比，迁移后的四个块并集**恰好**等于迁移前那个块的键集合（不增不减）；
  5. 退出码：违规非 0，并打印 `id → 键` 表。
- 不做 `--fix`；不做“从旧块自动搬键”的重写。

---

## 4. 保存语义

### 4.1 一次保存 = 一张卡的一次 `mutate`

- 四张卡各自持有自己的 `configForms.get<T>(ns)`（`HOST/packages/client/ui-settings/src/client/config-form.ts:284-293`）与自己的 `SettingsFormModel`；保存时只发本卡的 ops + 本 ns 的 revision（`:129-150`）。
- Host 的 revision 是**按条目 id** 记的（`HOST/.../settings/src/index.ts:302-343` 的 `revisions` map），所以 memory 卡保存不会让 handoff 卡的 revision 动。
- 一次点击仍然只写一张卡，卡内仍是“一次原子 mutate + 一个 revision”；变的是“一次保存覆盖全部 23 键”变成“每次保存覆盖一张卡的键”。

### 4.2 部分成功

- 一次点击不会跨卡：其他卡上的暂存编辑保留在各自的表单里，不随这次保存提交。
- 一张卡保存失败：该卡的 `failed` 置位并保留草稿（平台语义，`client/settings-card.tsx:120-127`），其他卡完全不受影响。
- 因为键集合互斥，**没有“同一个键写了两处、只成功一处”** 的情况；不存在需要补偿的半写。
- 用户若有一个跨卡的意图（例如“关掉整理并把 cap 调低”），会变成两次保存；两次都成功前，中间态是合法的（`memoryEnabled: false` + 旧 cap），没有代码依赖这两个键同时变。

### 4.3 并发冲突矩阵

| 场景 | 结果 | 用户看到 |
|---|---|---|
| 同一张卡、两个标签页 | 后保存的一方 `settings/conflict` | “设置已被别处改动…刷新页面” (`client/locales.ts:15`) |
| memory 卡与 handoff 卡同时保存 | 两个 ns 各自的 revision，互不冲突 | 两次都成功 |
| `/handoff threshold ...` 写了 handoff ns，然后保存 handoff 卡 | 命令写没有 revision 栅栏（`settings.update(ns, patch)`，`command.ts:95`），会移动 handoff 的 revision；卡的下一次保存冲突 | 现有冲突文案已经点名 `/handoff 命令`，保留 |
| 共用卡改了 `maxMemoryChars`，同时 memory 卡在保存 | 两个 ns 各自成功；memory 的下一次事件读到新 cap | 无需刷新 |
| 宿主重启 | 每个条目重新 apply；新进程的 `describe()` revision 从 0 重新起算，所有卡重新读取 | 页面刷新后显示新值 |

### 4.4 跨卡一致性

- **共享键只在共用卡上写**，其余三张卡没有这些键的行；所以不存在“两个表单各有一份 `provider`”需要对齐。
- 共享值的传播是 live 的：共用卡保存后，`project-context` 的 volatile 引用原地更新，`effectiveSharedSettings` 在下一次调用返回新值。已经开始的 pass 保持它启动时解析到的值；下一个事件用新值。这是可接受的时间窗（与今天的共享发布一致）。
- **`provider`/`model` 成对**：平台表单没有跨字段校验，`SettingsFormModel` 只做单字段解析（`HOST/packages/client/ui-primitives/src/settings-form/form-model.ts`）。必须在共用卡保存前加一道客户端检查：
  - 两者都为空，或都非空 → 允许保存；
  - 恰好一个非空 → 阻止保存，显示新文案（建议 key `chrome.saveFailedRoute`：“`provider` 与 `model` 必须同时填写或同时留空”）。
  - 若不拦住：写入会落盘；`resolveSharedConfig` 在下次 use-time 读取时抛 `provider and model must be set together`，`livePluginConfig` 回退旧值（卡片看起来保存成功但没生效）；重启后 `project-context` 的 `apply` 抛错，共用卡消失。这三种后果都不该让用户自己发现。
- 实现位置：共用卡包装 `props.save`（`onSave` 回调）做检查，不修改平台的 `SettingsFormModel`；`saveFailure` 增加 `"route"` 分支与对应文案。若 lead 决定不做这道检查，则把“半对保存导致重启后共用卡消失”写成已知残余，并在验收里人工覆盖（不推荐）。

### 4.5 可接受的失败模式

| 失败 | 直接影响 | 其他卡 | 恢复 |
|---|---|---|---|
| 单卡保存被值拒绝 | 该卡显示 `rejected`，草稿保留 | 不变 | 改成合法值再存 |
| 单卡保存撞 revision | 该卡显示 `conflict`，草稿保留 | 不变 | 刷新页面重读 |
| 共用条目 apply 失败（外来键/半对/非法值） | 共用卡消失，宿主日志一条 apply 错误 | 三个功能入口用 `DEFAULT_CONFIG` 的共享值（cap 40000、输出 32768、路由空） | 修 profile/值 → 重启 |
| 某个功能条目 apply 失败 | 该功能卡消失，功能本身停用 | 其他卡与外加入口不受影响 | 修 config → 重启 |
| 宿主重启后某张卡一直不出现 | 该 ns 未被服务（无 volatile / 无 `Config` / 条目未激活） | 其他卡正常 | 查 `describe()` 是否含该 ns 与条目状态 |
| 共用卡不存在但三个功能条目在跑 | 共享值全为默认 | 功能可用但 cap/路由不是用户设定 | 这是迁移未完成或 project-context 被禁用；按 §3.4 处理 |

原则：**每张卡独立失败、失败可见**；没有“一次保存悄悄只写了一半”的路径。半静默只发生在“共用条目失败 → 其余三个退回默认”，已在 §3.4 具名。

---

## 5. 目录与测试改动

### 5.1 `src/` 改动面

| 文件 | 改动 |
|---|---|
| `src/shared/settings-namespaces.ts`（新） | 四个命名空间字符串常量，无 import；host/client 共用 |
| `src/shared/config.ts` | 保留 `PluginConfig`/`DEFAULT_CONFIG`/`resolvePluginConfig`；新增四个严格子集解析器与共享键集合；把现有校验闭包（`:156-209`）提成可复用形式；`provider`+`model` 成对校验留在共享解析器 |
| `src/shared/settings.ts` | 四份 schema；`publishProjectContextSettings`（内部改用 `resolveSharedConfig`，仍是读取器）；`livePluginConfig`、`effectiveSharedSettings`、`withShared`；删除 `PluginSettingsSchema` 与 `effectivePluginConfig` |
| `src/project-context/index.ts` | `export const Config = SharedSettingsSchema`（`:134`）；`apply` 用 `resolveSharedConfig` + `livePluginConfig` + 发布（`:136-138`）；所有 `effectivePluginConfig(entry)` 改成自己的 live 读取器 |
| `src/project-memory/index.ts` | 新增 `export const Config = MemorySettingsSchema`；`apply`（`:702-703`）改子集解析；每次使用组合 `withShared(current(), effectiveSharedSettings(entry))` |
| `src/project-autolearn/index.ts` | 同上（`:91-92`） |
| `src/project-handoff/index.ts` | 同上（`:103-104`） |
| `src/project-handoff/command.ts` | `:17` 改导入 handoff 命名空间；`:95` `settings.update` 目标改为 `project-handoff`；`settingPatch` 的键不变 |

不得顺手改：整理/交接/沉淀的判定与写路径；`DEFAULT_CONFIG` 的值与边界；命令语法。

### 5.2 `client/` 文件

| 文件 | 职责 |
|---|---|
| `client/card-fields/common.ts` | `FieldKind`/`FieldBounds`/`FieldRow`、`booleanField`/`boundedNumberField`/`thresholdField`/`unionField`、`labelKey`/`hintKey`（从现 `card-fields.ts:55-263` 拆出） |
| `client/card-fields/shared.ts` | 共用卡 9 行 + `SharedSettings` 独立接口（镜像 `SharedSettingsSchema`） |
| `client/card-fields/memory.ts` | 记忆卡 3 行 + `MemorySettings` 接口 |
| `client/card-fields/autolearn.ts` | 技能卡 4 行 + `AutolearnSettings` 接口 |
| `client/card-fields/handoff.ts` | 交接卡 7 行 + `HandoffSettings` 接口 |
| `client/card-fields/index.ts` | 纯数据注册表 `CARDS`（namespace、slot、key、rows、标题/描述 key），不 import React |
| `client/settings-card.tsx` | 一个泛型 `SettingsCard` + 泛型 controller 工厂；去掉 `SegmentedTabs` 与 section 循环，改成“标题 + 描述 + rows” |
| `client/index.ts` | 四个注册：共用卡 `plugins.bundle.config` / key `dsh-project-context`；三张 row 卡 `plugins.row.config` / key `dsh-project-context#project-memory|project-autolearn|project-handoff`；每张各自 `whileServed([ns])`、`configForms.get(ns)`、`effect` dispose；`watchHandoffSwitch` 不变 |
| `client/locales.ts` | 一个 locale 命名空间（`project-context`）；删除 `tabs.label`/`tab.*` 与 `section.*`，改成每卡 `card.<id>.title`/`card.<id>.description`；`field.<key>` / `field.<key>Hint` 保持 23 个键各一份；新增 `chrome.saveFailedRoute`（若做 §4.4 的成对检查） |
| `client/styles.ts` | 删除 `.dshPcTabs`（`:14`）；其余几何样式保留，仍然零颜色 |

`ProjectContextSettings` 接口拆成四个独立副本：这是客户端按 `tsconfig.client.json` 编译时抓住“host schema 有键、客户端漏键”的唯一机制（现有规则见 `client/card-fields.ts:27-52`）；不要用一个 `Record<string, ...>` 糊过去。

### 5.3 构建与 `package.json`：一个 bundle，不拆

- 宿主的一个 npm 包只发现**一个** client bundle：`HOST/packages/client/modules/src/index.ts:204-213` 的 `clientExportOf` 从 `exports["./client"]` 取一个路径；`:905-908` 在声明了 `dsh.client` 却没有 `./client` 时直接抛错，`clientPath` 是单值（`:80,159`）。
- 仓库的 `package.json:26-28` 只有一个 `./client`，`:39-50` 的 `dsh.client` 是一个对象；`scripts/build-client.mjs:18-25` 从包名与 `exports["./client"]` 推出 id 与输出，`:50-52` 要求 esbuild 恰好产出一个 bundle，`:57-68` 把它包成一次 `window.__ModuleLoader__.load({...})`。
- 因此：**`lib/client.js` 不拆，`scripts/build-client.mjs` 与 `package.json` 不改**。四张卡由同一个 `client/index.ts` 的 `apply` 注册四次；`dsh.client.inject` 仍是 `["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-plugin-manager"]`（`package.json:43-50`）。
- 如果未来真要多个 bundle，那是“拆成多个 npm 包”的发布面改动（每个包一个 `exports["./client"]`、各自的 `dsh.client`、profile 安装与升级路径），不属于本批。

### 5.4 测试改动

| 测试 | 现在钉住什么 | 拆后改成 |
|---|---|---|
| `test/settings-form.test.mjs:45-103` | 一张表与一张 schema 逐键相等、每键一行、每段一行 | 四张表与四份 schema 逐卡相等；新增“四份 schema 的键集合两两不相交、并集 = 23” |
| 同文件 `:105-129` | bounded 行的边界等于 schema | 按卡循环；bounded 键仍是 `sessionSettledDays`、`handoffBudgetSummaryTokens`、`handoffBudgetRecentTokens`（共用卡 1 + 交接卡 2） |
| 同文件 `:193-210` | 只有 `project-context` 导出 `Config`、`SETTINGS_NAMESPACE === "project-context"`、client 绑定 `NS` | 四个入口各自导出自己的 `Config` 且 `Config({})` 等于对应 schema；四个命名空间常量等于四个条目 id；client 注册表绑定四个 ns |
| 同文件 `:212-226` | 每个字段 volatile | 四份 schema 的每个字段都 volatile（循环四份） |
| 同文件 `:228-260` | `effectivePluginConfig` 的 live 读取 | 改成 `livePluginConfig` + `effectiveSharedSettings`：改一个 volatile 引用后，读取器看到新值；发布释放后回退 |
| `test/card-render.test.mjs:292-326` | 一张卡每键一行、一个保存、按钮总数 | 四张卡分别渲染：每卡每键一行、每卡一个保存；`CLEAN_BUTTONS` 按卡计算 |
| 同文件 `:328-333` | 未服务 ns 显示提示 | 每张卡各自未服务时都不渲染 |
| 同文件 `:417-447` | rejected/conflict 两种失败 | 每张卡各自的 revision；仍按“revision 未动 = rejected / 动了 = conflict” |
| 同文件 `:497-507` | 一个 tablist、每段一 tab/panel、仅一个可见 | 删除 tab 断言；新增“每张卡没有 `role=tablist`/`tabpanel`，只有一个 `SettingsForm` 保存” |
| `test/client-inject.test.mjs:34-80` | 静态 inject 列表、`plugins.bundle.config`、`BUNDLE_KEY`、`whileServed([NS])`、`configForms.get<T>(NS)` | 保留 inject 列表断言；改成四条注册：bundle key `dsh-project-context`，三个 row key `dsh-project-context#<row>`；每张卡各自 `whileServed([ns])` 与 `configForms.get(ns)`；仍不得出现 `settingsScope` |
| `test/config-vocabulary.test.mjs:62-75,187-212,214-244` | 一张 `PluginSettingsSchema`、`PROFILE_SHAPES` 一份、四个 `apply` 接受同一形状 | 改成四份 schema/四个子集解析器；`PROFILE_SHAPES` 拆成每 profile 的四个卡形状；每个 `apply` 只接受自己卡的形状、对外来键抛 `unknown config key`；`/handoff` 写回测试增加“写到 `project-handoff` 命名空间”的断言 |
| `test/client-styles.test.mjs` | `ROWS.map(...)`、`SECTIONS.map(...)`、无手绘控件/颜色 | 改成新的 `CARDS`/`rows` 名称；保留“平台控件 + 零颜色”断言 |
| `test/top-level-gate.test.mjs:158,190,234,325,427` | 每个插件用 `resolvePluginConfig(...)` 的完整形状 apply | `apply` 只传自己卡的原始形状；路由/共享值用 `test/settings-fixtures.mjs` 的 `publishShared(...)` 先发布，并在 `t.after` 释放 |
| `test/autolearn.test.mjs:849,861,1416`、`test/logic.test.mjs:1513`、`test/prune.test.mjs:434`、`test/todo.test.mjs:258-347` 等 | 直接给 `apply` 传 `provider`/`model` 或 `resolvePluginConfig({})` 的完整 23 键对象 | 同样改成“自己卡的 raw config + 预发布共享值”；`resolvePluginConfig({})` 只用于纯函数，不再传给 `apply` |

新增测试夹具 `test/settings-fixtures.mjs`：

```js
// publishShared({ provider: "test-provider", model: "test-model", maxMemoryChars: 32_000 })
// 返回释放函数；内部用 publishProjectContextSettings 的 effect 语义。
```

注意：`publishProjectContextSettings` 的发布是**模块级单例**（`src/shared/settings.ts:74-76` 的 `live`/`owner`）；`livePluginConfig` 每次读自己的 fiber，没有全局状态。测试必须在 `t.after` 释放发布，避免同一进程里串场。

### 5.5 文档跟改（本批之外）

- `docs/settings.md:3-27`：命名空间从 1 个改成 4 个、每张卡的入口与槽位、保存语义“每卡一次”、共享字段只读发布。
- `docs/development.md:17-19`：卡片测试从“一张卡”改成“四张卡 + 交叉断言”。
- `docs/harness/integration.md` §2/§5：本批**不新增宿主接口**——用的还是既有的 `Config` 投影 + `settings` 服务；但投影面从 1 个命名空间变成 4 个，建议在接口表的“服务读取/投影”一行补注“`Config` 投影 ×4”，并在 §3 说明它不是 shim（没有为上游形状补适配层）。
- `docs/README.md`：把本规格登记进“当前生效的文档”。
- `.agents/memory`：落地后按插件写路径更新（不由本文件手工改）。

---

## 6. 验收标准

### 6.1 可执行门禁

| 命令 | 判据 |
|---|---|
| `pnpm typecheck` | 退出码 0；host 与 client 两半都干净（`package.json:55`） |
| `pnpm build`（由 lead 执行） | 退出码 0；构建后 `git diff --exit-code -- lib` 为空；`lib/client.js` 仍只有一个，大小应因拆分略增（不写死数字） |
| `pnpm test` | 退出码 0；新增/修改的用例具名出现；不引用旧计数，以本次输出为准 |
| 静态 grep | `grep -rn "effectivePluginConfig\|PluginSettingsSchema" src client test` 为 0；`SETTINGS_NAMESPACE` 只剩共用卡与 handoff 命令的目标常量 |
| 每字段 volatile | 由 `settings-form` 的四份 schema 循环断言覆盖；另可 `grep -c 'extra("volatile", true)' src/shared/settings.ts` = 23 |
| 键集合互斥 | 由 `settings-form` 新增断言覆盖；失败时打印两个 schema 的交集键 |
| 迁移探针 | 对两个 profile 各跑一次，退出码 0，输出四行 `id → 键`；违规时非 0 并点名键 |
| 构建产物归属 | `git status --short` 只含本批预期文件；`package.json`、`scripts/build-client.mjs` 无改动 |

### 6.2 用户可见判据

**生效前提**：desktop 与 web 两个 profile 在各自的 `package.json` 里钉的是 `git+ssh://…#<sha>`（不是 `link:`）。本批代码只有把 pin 抬到本批提交、重装并**重启宿主**后才生效；只 `pnpm build` 不更新 profile 不会让驻留宿主加载新代码。客户端 bundle 重建后还需要设置页硬刷新（宿主轮询 bundle `rev`）。

1. 设置 → Plugins → 已安装 → `dsh-project-context` bundle 页：出现**一个**共用/归档表单（9 行），没有页签，底部一个保存。
2. 同一 bundle 页的三个 row（`project-memory`、`project-autolearn`、`project-handoff`）各有一个配置入口；打开后分别是 3 / 4 / 7 行，各一个保存。
3. desktop 现读值：共用卡 `maxMemoryChars` 52000、`maxOutputTokens` 49152；记忆卡 `consolidateTurns` 1；交接卡 `handoffThreshold` 400000（卡片显示同一拼写）、`handoffBudgetRecentTokens` 20000、`handoffPendingQuestion` wait。web 没有记忆卡覆盖（显示默认 6/300000）。
4. 每张卡改一个值并保存，刷新页面后值仍在；**不重启宿主**，验证 live 读取：
   - 功能卡自己的键：把交接卡 `handoffPendingQuestion` 从 `wait` 改成 `defer`，保存后直接跑 `/handoff status`，回执的 `pending question` 行应变成 `defer`（`command.ts:206` 读的是 use-time 配置）。
   - 共用键：在一次性项目里把共用卡 `taskMode` 从 `assisted` 改成 `delegated`，保存后跑 `/context task probe-settings-split`（不带 `new`）应创建而不是拒绝；验完改回 `assisted`。
   - **不要**用“把 `maxMemoryChars` 调到当前文档以下”来验证——那会触发下一次写入的截断（`docs/settings.md` 已把它列为危险操作），不是本批的验收手段。
5. 并发：两个标签页打开交接卡，A 保存后 B 保存 → B 显示 `conflict` 文案且草稿保留；A 的值已落盘。
6. 命令写：`/handoff threshold 0.4` 后打开交接卡 → 显示 0.4；随后在卡上保存 → 若命令已移动 revision，显示 `conflict`，不是静默覆盖。
7. 失败可见：手工把某个键放到错误条目（测试环境）→ 宿主日志出现带条目名的 `unknown config key`，对应卡消失，其他卡仍在；恢复后重启复原。

### 6.3 变异检查（按仓库规矩，每条先编译再判红）

| 变异 | 期望红 |
|---|---|
| 删掉某一字段的 `volatile` | `settings-form` 的“每字段 volatile” + 该卡渲染/服务断言 |
| 把同一个键声明进两份 schema | “键集合两两不相交” |
| 把一个键放到错误的入口 schema | 对应入口的 apply 外来键测试；迁移探针 |
| 删掉一张卡的 `whileServed` | `settings-form` 的 client 绑定断言；人工页面上该卡缺失 |
| 把某张卡的保存改成不带 revision | `card-render` 的 conflict 用例（revision 不动/动了） |
| 把 `provider`/`model` 成对检查删掉 | `card-render`/`settings-form` 的新增半对用例 |
| 把 `writeSetting` 的目标改回 `project-context` | `config-vocabulary` 的写入命名空间断言 |
| 把 `livePluginConfig` 改成直接返回 `fallback` | live-reference 用例（保存后读取器看不到新值） |

### 6.4 证据

- 构建前后 `lib/client.js` 的 sha256 与字节数、`git diff --stat lib`。
- 两个 profile 的 `.bak` sha256、迁移探针输出、迁移后 `sed -n` 的四个块。
- 四张卡的桌面截图（用户侧）与 `/handoff`、`/memory` 回执。
- 变异轮每个变异体的编译输出与打红用例名。

---

## 7. 明确不做的事

1. 不改 `project-memory` 的整理语义：tier C、四段预算、渲染/规范化、整篇重写闸、退休/七态判定都不动。
2. 不改 `project-handoff` 的判定与执行：阈值、膝点、预算分配、种子/身份、退休、路由失败都不动；只改 `/handoff` 设置写回的目标命名空间。
3. 不改 `project-autolearn` 的沉淀/过期规则与技能核。
4. 不引入数据库或第二份存储：值仍在 profile 的 `cordis.patch.yml`，仍由 Host 的 `SettingsForms` 写。
5. 不做热迁移：没有兼容读取器、没有别名、没有“两处都有值时谁赢”；迁移是“改文件 + 重启”的一次性动作。
6. 不拆 npm 包、不拆 client bundle、不改 `package.json` 的 exports/`dsh.client`、不改 `scripts/build-client.mjs`。
7. 不新增/删除配置键，不改任何默认值或边界，不改命令语法；`/handoff` 的写回键名不变。
8. 不改 Host 的 volatile/describe/mutate 机制，不为设置页新增平台能力。
9. 不写自动改写 profile 的迁移脚本（只写只读探针）。
10. 不做“三张卡共享一个未注册 schema”的隐藏命名空间。

---

## 8. 待拍板与待确认

### 8.1 需要 lead/用户拍板

1. **四份 schema 还是三份。** 本文推荐四份（三张功能卡 + 共用/归档卡），理由见 §2.5。若坚持“只有三张卡”，唯一可行的是把共用 9 键塞进记忆卡，并接受“memory 条目失败/被禁用时另外两个入口退回默认值”的静默降级；本规格不建议。
2. **共用卡放哪。** 推荐留在 bundle 页（`plugins.bundle.config`，key `dsh-project-context`），与现在的位置一致；替代方案是放到 `project-context` 的 row 页（`plugins.row.config`，key `dsh-project-context#project-context`），四张卡都成为 row 页，更对称，但多一次点击才能看到共用设置。
3. **`provider`/`model` 成对检查做不做。** 推荐做（§4.4）；不做的后果是半对保存会在下次读取时被 `livePluginConfig` 静默回退、重启后共用卡消失。
4. **`maxMemoryChars` 放共用卡还是记忆卡。** 推荐共用卡（三个入口都读；避免 memory 失败时 autolearn/context 退回 40000）。放记忆卡的代价是静默降级，收益是“记忆上限”出现在记忆卡上。
5. **迁移执行人。** profile 属于用户存储，按仓库规矩由用户/lead 改；本文只提供步骤、片段与只读探针。

### 8.2 待确认（附确认办法）

1. **宿主行号会漂。** 本文的 `HOST/` 行号读自 `dsh-desktop-0.2.2-rc.3` 检出；实现时若 store 变了，按 `describe`/`mutate`/`write`/`schema`/`volatileForm` 符号名重定位。API 基线的 `dsh-settings@0.1.7-rc.2` 已有同名函数（仓库 `node_modules/.pnpm/@deepseek-ai+dsh-settings@0.1.7-rc.2_*/node_modules/@deepseek-ai/dsh-settings/lib/index.js:488,501,538`），行为一致。
2. **row 页的配置入口是否在真实页面上出现。** 代码路径已确认：`PluginManagerPage.tsx:1642,1798-1801` 用 `ledger.rows` 与 `formFor(openRow.rowId)`；最终以桌面/profile 重启后的页面为准（§6.2 第 2 条）。
3. **profile patch 的 `name:` 是否必须。** `applyEntryPatches` 只在 `name` 存在且不匹配时跳过（`include/lib/index.js:95-99`）；写精确的 `name` 更安全，不写也能按 id 命中。迁移探针的“四个 id 出现且键集合正确”是判据。
4. **volatile-only 保存后 revision 是否按预期移动。** 这是现有卡片的冲突判定基础（`client/settings-card.tsx:120-127` 依赖它）；拆后按 ns 独立。用两个标签页的 §6.2 第 5 条验收；若发现 revision 不动，先查 Host 的 `describe()` 是否在写后被调用（`SettingsForms.write` 末尾的 `this.describe()`，`HOST/.../settings/src/index.ts:424`）。
5. **共用条目失败时三个功能入口的退回值是否需要额外告警。** 当前设计只靠宿主 apply 错误 + 卡片消失；若希望更响亮，可在 `effectiveSharedSettings` 的 fallback 分支写一行带条目名的 `errors.log`（需要项目根，事件路径里多数有），但这是新增行为，未包含在本规格的默认实现里。
