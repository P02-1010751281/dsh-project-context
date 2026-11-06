# 配置详解

设置命名空间、卡片语义与每个键的完整说明（取值边界、哪种模式读它、回执怎么报）。
键的默认值速查表见 [README](../README.md#配置)。

## 配置

Settings → Plugins → 已安装列表里的 **`dsh-project-context`** 一行（打开后是记忆整理 / 技能沉淀 /
自动交接三区，共享的辅助模型路由在记忆整理区末尾），host 侧实时生效。卡片挂在插件页的
`plugins.bundle.config` 槽位、键为 bundle 包名 `dsh-project-context`（该槽位按包名分派；
`plugins.item` 归**官方插件**卡片），经宿主的 `configForms` 服务读写本命名空间，并由 `whileServed`
门控——profile 没装 host 半时页面上不会留下痕迹。

卡片本身**不是自绘的**：框架、保存按钮、文本/数字行、只读与未加载提示都来自平台的
`@deepseek-ai/dsh-client-ui-primitives`（`SettingsForm` / `SettingsValueField` / `Switch` / `Pill` /
`Tag` / `Button`），暂存写入用平台的 `SettingsFormModel`，本仓库只提供一张**字段表**
（`client/card-fields.ts`：spec + 投影 + 渲染行三者共同的唯一来源，行数与 host schema **逐键相等**，由 `test/settings-form.test.mjs` 钉住）和一份**纯几何、零颜色**
的排版样式表。因此保存语义也是平台的：一次**原子** `mutate`（带 revision fence）、Host 拒绝时保留草稿，
**离开页面即丢弃草稿**——所以卡片上没有「放弃」按钮（与官方设置页一致）。

命名空间就是 **Loader 条目 id** `project-context`：dsh 0.1.7-rc.2 起，设置表单由**归属插件模块导出的
`Config` schema 投影**而来（`SettingsForms.schema(entry)` 读 `entry.fiber.runtime.Config`），
不再有 `settings.register` / `installSection` 这类运行时注册 API。所以 host 半边把
`PluginSettingsSchema` 作为 `Config` 从 `project-context` 入口导出；四个插件共享同一个命名空间
（该入口发布自己 fiber 的 live config，其余三个读取它），base 层因此恒为
`cordis.patch.yml` 里 `project-context` 那一行的 `config:`，改其余三行不生效。

**新增字段必须带 volatile 标记**（`.extra("volatile", true)`，见 `src/shared/settings.ts`）：
`describe()` 用 `volatileForm()` 过滤，一份没有该标记的 schema 会让**整个条目**从被服务命名空间里
消失，卡片随之无错误、无日志地不渲染（`test/settings-form.test.mjs` 逐个字段钉住这条）。标记同时让
这些字段以**活引用**交给插件，所以 `resolvePluginConfig` 会按 cosmokit 的共享协议解引用，而共享设置
是**读取器**而非快照——loader 对只改 volatile 字段的写入是原地提交引用、不重启条目。

设置值写在**当前 profile 的 patch 文档**里（`SettingsForms.documentPath`），不再是
`~/.dsh/settings.yaml`：rc.2 在 Loader 安定后把该文件里的旧段一次性导入 profile（文件改名为
`settings.yaml.imported`），既有配置因此自动接续。面板未覆盖的字段回落到 profile 配置，再回落到默认值。

| 字段 | 默认 | 说明 |
|---|---|---|
| `archiveEnabled` | `true` | 关掉后不再自动写会话存档与索引（`/session-log write` 仍可用） |
| `memoryEnabled` | `true` | 关掉后不再自动整理（命令仍可用） |
| `consolidateTurns` | `6` | 较上次整理新增的用户消息数达到后在 idle 触发 |
| `consolidateIntervalMs` | `300000` | 自动整理最小间隔 |
| `forceDedupeMs` | `15000` | 强制调用去重窗口 |
| `autolearnEnabled` | `true` | 关掉后不再自动沉淀技能（命令仍可用） |
| `autolearnTurns` | `20` | 自上次沉淀累计的用户消息数阈值 |
| `autolearnIntervalMs` | `1800000` | 自动沉淀最小间隔；仅在有新 MEMORY/CONTEXT 内容时执行 |
| `maxTokens` | `8192` | 辅助模型调用的起始输出上限；整理会按「记忆+上下文需回吐的 token 数」自适应上调 |
| `maxOutputTokens` | `32768` | 自适应上调的边界（≥256）：输入很大时把单次输出上限往它上调。它是**自适应上调的边界**而不是绝对天花板：`maxTokens` 更大时以 `maxTokens` 为准；若适配器自己给出更小的模型上限，则以模型上限为准。交接摘要的失败重试同样被该边界压住（`min(2×maxTokens 或 32768 的较大者, max(maxTokens, maxOutputTokens))`；边界低于起始上限时重试被取消，只发一次原请求） |
| `maxMemoryChars` | `40000` | 记忆文档的字符上限（4000–200000）：写入前按它生效，超限**按行边界**截断并写入 `_[memory truncated at <limit> characters: <dropped> dropped]_` 标记。调大它同时抬高每轮注入量与整理输出需求——整理被「模型输出上限」截断时，调大这个值只会更糟 |
| `provider` / `model` | 空 | 辅助调用路由覆盖；默认用 agent 最近一次请求的路由 |
| `handoffEnabled` | `true` | 关掉后不再自动交接（含交接子会话标题的事后改名），`/handoff` 仍可用 |
| `handoffThresholdAuto` | `true` | 自适应阈值 = **护栏**取小：质量层（`autoCompactTokenLimit ?? knee(window)`——宿主暴露可用输入上限时优先用它，目前 dsh 只暴露 `contextWindow`，故恒回退膝曲线）与可用窗口；基线/保留量只决定可行性下限。false 时用固定比例 |
| `handoffThresholdRatio` | `0.4` | `handoffThresholdAuto: false` 时的固定比例（0.1–0.95）；被 4K 安全边际压掉时阈值标签会写明实际值。卡片与 `/handoff threshold` 接受同样三种写法（`0.4`、`40`、`40%`），越界草稿在卡片本机就被拒（保存按钮置灰）。卡片只在固定模式下显示这一行 —— 自适应开启时触发计算不读它；例外：该行带覆盖值或非法草稿时仍显示，否则那个值无法重置 |
| `handoffBudgetSummaryTokens` | `64000` | 自适应模式下**只用于回执**的目标请求量（8000–200000）：`/handoff status` 用它判断并点名「目标没被完整采纳」，它不移动触发点，也不产生任何模型调用。触发点由护栏决定，被压掉时点名被覆盖的值与压住它的那条护栏，不静默。任何模式都显示——它是 `/handoff budget summary` 在任一模式都能写的预算，不是另一模式的触发器，固定模式里只是暂时不生效（触发器那一行才按模式隐藏）；越界或非整数草稿在卡片上直接拒掉 |
| `handoffBudgetRecentTokens` | `20000` | 最近对话原文带入新会话（0–200000，0 = 只带摘要；卡片按同一区间本机校验，越界或非整数草稿直接拒掉）。切点按**消息**而不是按轮，且至少要保留一条消息，所以实际带入量最多比它多一条消息（每条渲染后 ≤ 4000 字符）。**用户自己的最后一次输入**另有一段独立带入（见 ④），不受该值影响 |
| `handoffLang` | `auto` | 交接语言：`auto` 按对话判定（CJK≥2 → zh；纯拉丁≥20 字母 → en；否则沿用上一条交接提示的语言，兜底 en），也可固定 `zh` / `en` |
| `handoffPendingQuestion` | `defer` | 最后一条助手消息是未答问题时：`defer` 让**自动**交接等回答（手动 `/handoff` 始终执行），`wait` 照常交接并把问题作为独立段落带进新会话，且该段落取代常规的「先做下一步」结尾（= pi 侧 `handoffGuard: wait`） |
| `handoffRetireReplaced` | `true` | 交接成功后把被替换的旧会话「退休」：先停掉其中仍在跑的工作，再调 `workspaceRegistry.archiveSession(…, {stopActivity: true})` 把它从侧栏隐藏（只隐藏不删除，客户端「取消归档」可还原）。默认开启的原因：交接是**分叉**，旧会话不结束就仍算活动，会排在自己的续接会话上面。关闭后两个会话都留在列表里、旧会话里的工作也不会被停——`stopActivity` 只为让归档生效，没有归档就没有可停的东西 |
