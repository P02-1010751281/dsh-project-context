# dsh-project-context

为 **DeepSeek Harness (dsh)** 提供项目级持久上下文：把 dsh 的事件流会话在项目内留档，
再依次蒸馏成记忆、上下文与技能，最后在上下文将满时交接给新会话。

当前版本 **`v0.4.3`**。

**文档分工**（这是这一页唯一需要先读的约定）：本文件是**手册**——装什么、怎么用、配置什么，
每条只给结论。机制与理由在 [`docs/`](./docs/README.md)：
[architecture](./docs/architecture.md)（数据流、数据布局、源码结构）、
[behavior](./docs/behavior.md)（四个阶段各自的闸门与边界）、
[settings](./docs/settings.md)（配置详解）、
[development](./docs/development.md)（门禁、依赖边界、破坏性变更）。
收口的批次档案在 `docs/archive/`，唯一索引是 [docs/README.md](./docs/README.md)。
仓库根另有两份给改代码的人看的文档：[AGENTS.md](./AGENTS.md) 是仓库事实导览（代码在哪、怎么跑、
有什么坑），[RULES.md](./RULES.md) 是 ≤150 行的行为准则（改代码前该守的约束与门禁）。
逐版本变更：未发布看 [CHANGELOG.md](./CHANGELOG.md)，已发布版本各一份
`docs/changelog/<version>.md`（目录在 CHANGELOG 末尾）。**长段说明不再写进本文件。**

## 四个插件

| 阶段 | 插件（子路径） | 命令 | 自动档触发 | 产物 |
|---|---|---|---|---|
| ① 存档 | `project-context`（主入口） | `/context`、`/session-log` | 每轮 `turn/end` 追加；idle / disposed 落盘 | `session-logs/<id>/`、`INDEX.md` |
| ② 整理 | `project-memory` | `/memory`、`/memory update` | idle / disposed + 节流 | `CONTEXT.md`、`MEMORY.md`（每轮注入） |
| ③ 沉淀 | `project-autolearn` | `/autolearn` | 有新材料 + 轮数/间隔达标 + 至少一个真实存档 | `skills/<name>/SKILL.md`；证据不足写 `skill-candidates/` |
| ④ 交接 | `project-handoff` | `/handoff` | 越过阈值 + 无在跑后台子代理 + 本会话未再开新轮 | 新会话 + `HANDOFF.md` |

四个插件是同一包内的独立 cordis 插件，共享一份配置与生命周期 helper。②③④ 只对顶层会话生效，
① 对子代理会话同样留档。④ 交接后旧会话**默认被归档**（可关，见配置表的 `handoffRetireReplaced`）。

## 安装

```bash
cd <这个仓库> && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-project-context   # 自动应用包内 cordis.patch.yml
dsh --profile web --dump-config | grep -A3 project-         # 验证
```

仓库带着构建产物（`lib/` 纳入跟踪），`pnpm build` 只在你要改 `src/`/`client/` 时才需要（见「开发」）。

卸载：`dsh plugin --profile web remove dsh-project-context`。

## 命令

| 命令 | 行为 |
|---|---|
| `/context` | 显示 CONTEXT.md、会话日志与索引路径 |
| `/memory update` | 立即整理一次（②）：更新 MEMORY.md 与 CONTEXT.md；回执按实际结果区分已更新 / 被截断 / 无新内容 / 被去重 / 失败 |
| `/session-log` | 只读：显示会话日志目录与索引路径，并提示用 `/session-log write` 立即写出 |
| `/session-log write` | 立即写出当前会话 JSONL + Markdown（并刷新索引） |
| `/session-log import <path…>` | 回填导入历史档案（zip/jsonl/目录，幂等、无模型调用） |
| `/memory` | 显示项目记忆路径与状态 |
| `/autolearn` | 立即沉淀技能（③）；证据不足时按索引回读 `session.jsonl`；`list` / `approve <name>` / `reject <name>` |
| `/handoff` | 立即交接：把逐字尾料、文件清单、未答问题或用户最后一次输入带进新会话继续（**不调用模型生成摘要**） |
| `/handoff status` | 显示开关、阈值、当前上下文占用与保留量；**手动设定的阈值被护栏压掉**时点名被覆盖的值与压住它的护栏（质量膝 / 容量 / 安全边际）；自动交接因“没有更早内容可摘要”被跳过时，一并报告**从何时起被跳过**与原因（重新可摘要即清除） |
| `/handoff on` / `off` | 开关自动交接 |
| `/handoff threshold auto` / `threshold 0.4` / `threshold 60%` | 切自适应；给比例则切固定比例。裸 `auto` 与裸比例已退役，不再生效 |
| `/handoff budget summary 64k` / `budget recent 20k` | 目标请求量（只用于回执，不移动触发点）/ 逐字保留的近端对话（`budget recent 0` = 不带尾料）；summary 被护栏压掉时 `/handoff status` 点名 |
| `/handoff pending defer\|wait` | 未答问题时：延后交接 / 照常交接并把问题带进新会话 |
| `/handoff lang auto\|zh\|en` | 交接语言：自动判定或固定中文 / 英文 |

## 它在项目里写什么

```
<project>/.agents/
├── skills/<name>/SKILL.md        # ③ 沉淀出的项目技能（description 常驻，body 按需加载）
└── memory/
    ├── MEMORY.md                 # ② 长期记忆（由 journal 折叠渲染，可手改）
    ├── CONTEXT.md                # ② 工作态：摘要 / 关键点 / open tasks
    ├── HANDOFF.md                # ④ 最近一次交接
    ├── memory.jsonl              # ② 记忆权威日志（append-only）
    ├── session-logs/<id>/        # ① 会话存档（session.jsonl + session.md）+ INDEX.md
    └── errors.log                # 各阶段异常（脱敏、轮换）
```

完整布局（锁、备份、`autolearn-state.json`、候选、journal 轮转）、`journal` 与 `MEMORY.md` 的
派生关系、旧布局迁移：见 [docs/architecture.md](./docs/architecture.md)。

## 配置

设置卡（Settings → Plugins → `dsh-project-context`）编辑，host 侧实时生效；值写进当前 profile 的
设置 patch 文档。

| 键 | 默认 | 一句话 |
|---|---|---|
| `archiveEnabled` | `true` | 关掉后不再自动写会话存档与索引（`/session-log write` 仍可用） |
| `memoryEnabled` | `true` | 关掉后不再自动整理（命令仍可用） |
| `consolidateTurns` | `6` | 新增用户消息数达标后在 idle 整理 |
| `consolidateIntervalMs` | `300000` | 自动整理最小间隔 |
| `forceDedupeMs` | `15000` | 强制调用去重窗口 |
| `autolearnEnabled` | `true` | 关掉后不再自动沉淀（命令仍可用） |
| `autolearnTurns` | `20` | 累计用户消息数阈值 |
| `autolearnIntervalMs` | `1800000` | 自动沉淀最小间隔 |
| `maxTokens` | `8192` | 辅助调用起始输出上限（整理会按需上调） |
| `maxOutputTokens` | `32768` | 自适应上调的边界，也压住整理重试 |
| `maxMemoryChars` | `40000` | 记忆文档字符上限；超限按行截断并标记 |
| `provider` / `model` | 空 | 辅助调用路由覆盖，须成对设置 |
| `handoffEnabled` | `true` | 关掉后不再自动交接；`/handoff` 仍可用 |
| `handoffThresholdAuto` | `true` | 自适应阈值（护栏取小）；关掉用固定比例 |
| `handoffThresholdRatio` | `0.4` | 固定模式的比例（0.1–0.95；也接受 `40` / `40%`） |
| `handoffBudgetSummaryTokens` | `64000` | 自适应模式下**只用于回执**的目标量（8000–200000） |
| `handoffBudgetRecentTokens` | `20000` | 逐字带入新会话的最近对话（0 = 不带；0–200000） |
| `handoffPendingQuestion` | `defer` | 未答问题时：`defer` 等回答，`wait` 带进新会话 |
| `handoffLang` | `auto` | 交接语言：`auto` / `zh` / `en` |
| `handoffRetireReplaced` | `true` | 交接后归档旧会话；关掉则两个会话都留在列表里 |

每个键的完整语义（取值边界、哪种模式读它、回执怎么报、卡片为什么这样显示）：
见 [docs/settings.md](./docs/settings.md)。

## 行为与边界

- 手动 `/handoff` **始终执行**：不受 `handoffEnabled`、`handoffThresholdAuto` 与阈值门控。
- `archiveEnabled: false` 时不发生任何自动写入；`/session-log write` 是文档化的逃生口。
- 自动交接只在 `turn/end` 评估、没有定时器；有后台子代理在跑时**延后**，手动 `/handoff now` 则
  **拒绝并点名**。
- 各阶段的闸门、产物与理由：见 [docs/behavior.md](./docs/behavior.md)。
- 改 `src/` 后要 `pnpm build` **并重启承载插件的那个 host**；只看提交或构建时间不能判定已生效，
  要对进程启动时间。
- 改 `client/` 只需 `pnpm build`：运行中的 host 经 client HMR 换版，刷新页面即可。

## 常见问题

- **交接后旧会话不见了？** ④ 默认把被替换的会话归档（只隐藏、不删除，也不影响日志与工作区位置）。
  侧栏视图选项切到「全部对话（显示已归档）」→ 右键「取消归档」；想从此保留，把
  `handoffRetireReplaced` 关掉。
- **记忆没更新？** `/memory` 看状态。两种成因分开报：`N section(s) exceeded their budget` /
  `whole entry(ies)` = 文档太大、须压缩；`cut off by the model output limit` = 输出被上限截断，
  此时调大 `maxMemoryChars` 只会更糟。
- **卡片上改了没反应？** 先确认改的是 `project-context` 这一条（四个插件共享它）；改 host 侧要重启。
- **探针连不上？** 桌面 host 的端口每次重启都变（如 33647 → 38961），探针必须传当前 `--url`。

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

MIT © 2026 呼啸山庄 (P02-1010751281)，见 [LICENSE](./LICENSE)。

设置卡片按官方设置页（`@deepseek-ai/dsh-client-ui-settings-*` 各卡片）的写法组装：槽位注册 +
平台表单模型 + 平台控件。早期版本的卡片外壳与 store 探测层曾改编自
[dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue)（MIT，Copyright (c) 2025
HsiangNianian），这两处在改用平台组件后已删除。
