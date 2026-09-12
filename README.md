# dsh-project-context

> 仓库：<https://github.com/P02-1010751281/dsh-project-context> · MIT License

把 pi“上下文”三件套移植到 **DeepSeek Harness (dsh)**：

| 插件 | 来源 | 职责 |
|---|---|---|
| `project-context`（包主入口） | pi `session-context` 扩展 | 会话日志 + `CONTEXT.md` 摘要/索引，作为 runtime context 注入 |
| `project-memory`（`/memory` 子路径） | pi `memory` 扩展 | `MEMORY.md` + autolearn 项目技能，作为 runtime context 注入 |
| `project-handoff`（`/handoff` 子路径） | pi `auto-handoff` 扩展 | 上下文接近上限时摘要并另开新会话继续 |

## 数据布局（与 pi 共用，放在项目内）

```
<project>/.agents/
├── skills/<name>/SKILL.md            # autolearn 生成的技能
└── memory/
    ├── MEMORY.md                     # 持久项目记忆
    ├── CONTEXT.md                    # 会话摘要 + key points + open tasks + session index
    ├── HANDOFF.md                    # 最近一次交接的摘要
    ├── errors.log                    # 插件吞掉的异常（诊断用）
    └── session-logs/<session-id>/    # session.jsonl + session.md（项目内可移植副本）
```

dsh 自身仍把会话存在 `~/.dsh/sessions/<project-slug>/…`；`session-logs/` 只是项目内副本，
autolearn 读的是实时事件。旧布局（`.pi/…`、`.agents/memory/skills`、`~/.omp/agent/memories/…`）
会在 session 启动时自动合并迁移。

## 安装

```bash
cd <这个仓库> && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-project-context   # 自动应用包内 cordis.patch.yml
dsh --profile web --dump-config | grep -A3 project-         # 验证
```

卸载：`dsh plugin --profile web remove dsh-project-context`。

## 配置

Settings → Plugins → Plugin configuration → **项目上下文与记忆** 卡片；写入
`~/.dsh/settings.yaml` 的 `project-context` 段，host 侧实时生效。也可在 profile 的
`cordis.patch.yml` 用户层按 id 覆盖（作为面板的 base 层）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `autoLearn` | `true` | 关掉后不再自动 learn（命令仍可用） |
| `learnTurns` | `6` | 较上次 learn 新增的用户消息数达到后在 idle 触发 |
| `learnIntervalMs` | `300000` | 自动 learn 最小间隔 |
| `forceDedupeMs` | `15000` | 强制 learn 去重窗口 |
| `maxTokens` | `8192` | 辅助模型调用（learn / 交接摘要）输出上限 |
| `provider` / `model` | 空 | learn 路由覆盖；默认用 agent 最近一次请求的路由 |
| `handoffEnabled` | `true` | 关掉后不再自动交接，`/handoff` 仍可用 |
| `handoffAdaptive` | `true` | 自适应阈值（按窗口/基线/保留量推导）；false 时用固定比例 |
| `handoffThresholdRatio` | `0.4` | `handoffAdaptive: false` 时的固定比例（0.1–0.95） |
| `handoffTargetTokens` | `64000` | 自适应模式：每次摘要移交的对话量（8000–200000） |
| `handoffKeepTokens` | `20000` | 最近对话原文带入新会话（0–200000，0 = 只带摘要） |
| `handoffSummaryThinking` | `off` | 摘要调用思考级别：`off` 或 `session` |

两个插件共用同一配置命名空间；面板未覆盖的字段回落到 profile 配置，再回落到默认值。

## 命令（web/交互 profile）

| 命令 | 行为 |
|---|---|
| `/context` | 显示 CONTEXT.md 与会话日志路径 |
| `/context-update` | 立即对当前会话 learn 一次并更新 CONTEXT.md |
| `/session-log` | 立即写出当前会话 JSONL + Markdown |
| `/memory` | 显示项目记忆路径与状态 |
| `/memory-learn` | 立即 learn 一次，更新 MEMORY.md / 技能 |
| `/handoff` | 立即交接：摘要当前会话并另开新会话继续 |
| `/handoff status` | 显示开关、阈值、当前上下文占用与保留量 |
| `/handoff on` / `off` | 开关自动交接 |
| `/handoff auto` / `0.4` / `60%` | 切自适应；给比例则切固定比例 |
| `/handoff target 64k` / `keep 20k` | 自适应移交量 / 保留量（`keep 0` = 只带摘要） |
| `/handoff thinking off\|session` | 摘要调用思考级别 |

## 说明

- CONTEXT.md / MEMORY.md 经 `ctx.systemPrompt.context()` 动态注入；`project-handoff` 默认自适应阈值，
  “摘要 + 最近原文（`handoffKeepTokens`）”作为新会话第一条消息发送，摘要同时写入
  `.agents/memory/HANDOFF.md`。
- learn 在 agent idle / disposed 时触发，`session/flush` 会等待进行中的 learn；异常写入
  `.agents/memory/errors.log`，不打断会话。
- 自动交接与 dsh 内置 `dsh-compaction-basic`（原地压缩）可共存；摘要失败对会话退避 5 分钟，
  最后一条助手消息是未回答的问题时延后交接。

## 开发

```bash
pnpm typecheck        # host + 客户端 tsc --noEmit
pnpm build            # host → lib/*.js，客户端 bundle → lib/client.js
```

host 侧对 `@deepseek-ai/*` 仅 type-only import；客户端 bundle 只外部化 `react` / `react/jsx-runtime`，
改动后需刷新页面/重启 `dsh web`。

## 许可证

MIT © 2026 呼啸山庄 (P02-1010751281)，见 [LICENSE](./LICENSE)。

设置卡片、表单与 store 兼容层的模式改编自
[dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue)
（MIT，Copyright (c) 2025 HsiangNianian），相关源文件头保留了原署名。
