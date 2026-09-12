# dsh-project-context

> 仓库：<https://github.com/P02-1010751281/dsh-project-context> · MIT License

把作者自研的 pi“上下文”三件套移植到 **DeepSeek Harness (dsh)**（原扩展运行在 pi coding agent 上）：

| 插件 | 来源 | 职责 |
|---|---|---|
| `project-context`（包主入口） | 自研 pi 扩展 `session-context` | 会话原始日志 + `CONTEXT.md` 摘要/索引；把 CONTEXT 作为 runtime context 注入模型 |
| `project-memory`（`/memory` 子路径） | 自研 pi 扩展 `memory` | 持久项目记忆 `MEMORY.md` + autolearn 项目技能；把 MEMORY 作为 runtime context 注入模型 |
| `project-handoff`（`/handoff` 子路径） | 自研 pi 扩展 `auto-handoff` | 上下文接近上限时摘要并另开新会话继续；写 `.agents/memory/HANDOFF.md` |

前两个共享自研扩展的 `_shared/learn.ts` autolearn pass：按项目节流、单飞，一次模型调用同时产出
`memory_markdown`、可选 `skill`、`context`（title/summary/key_points/open_tasks）。

> `project-handoff` 对应自研 pi 扩展 `auto-handoff`：默认**自适应阈值**（按窗口、实测基线、`handoffKeepTokens`、
> `handoffTargetTokens` 推导，而不是固定比例；可在设置里改回固定比例），触发时用一次辅助模型调用
> 摘要较早的对话，最近的 `handoffKeepTokens` 原文带入新会话，写入 `.agents/memory/HANDOFF.md`，
> 在同 workspace 新建会话并把“摘要 + 最近原文”作为第一条消息发送。摘要调用默认 thinking=off
> （模型支持时），失败有 5 分钟退避；
> dsh 内置的 `dsh-compaction-basic` 是**原地压缩**，两者可共存；不想自动交接可关掉
> `handoffEnabled`，`/handoff` 手动仍可用。dsh 没有“草稿”通道：最后一条助手消息是未回答的
> 问题时，自动交接会推迟到用户回复之后（不会替你回答）。

## 数据布局（与 pi 共用同一份，放在项目内）

```
<project>/.agents/
├── skills/<name>/SKILL.md            # autolearn 生成的技能（dsh-skill-filesystem 原生发现，rank 200）
└── memory/
    ├── MEMORY.md                     # 持久项目记忆，注入 runtime context
    ├── CONTEXT.md                    # 最近会话摘要 + key points + open tasks + session index
    ├── HANDOFF.md                    # 最近一次交接的摘要文档
    ├── errors.log                    # 插件吞掉的异常（诊断用）
    └── session-logs/<session-id>/    # session.jsonl（原始事件流）+ session.md（渲染）
```

> 关于会话“自动保存”：dsh 自己会把每个 session 存到
> `~/.dsh/sessions/<project-slug>/session-<id>/session.jsonl.zstd`（Web 的会话列表/恢复读它）。
> 这里的 `session-logs/` 是**项目内的可移植副本**（与 pi 共用 `.agents/` 布局，CONTEXT.md
> 的会话索引指向它），不是 learn 的输入——autolearn 读的是当前会话的实时事件。

旧布局会在 session 启动时自动合并迁移：
`<project>/.pi/{MEMORY.md,CONTEXT.md,session-logs,skills}`、
`<project>/.agents/memory/skills`、`~/.omp/agent/memories/<encoded-project>/`（只读导入）。

## 安装

```bash
# 1) 构建（本地 link 安装不会自动 build）
cd <这个仓库> && pnpm install && pnpm build

# 2) 装进某个 profile；`dsh plugin` 会把包加进 dsh.profile.bundles
#    并自动应用包里的 cordis.patch.yml（插入 project-context / project-memory / project-handoff 三行）
dsh plugin --profile web add /path/to/dsh-project-context

# 3) 验证组合
dsh --profile web --dump-config | grep -A3 project-
```

卸载：`dsh plugin --profile web remove dsh-project-context`（bundle 列表随之移除）。

## 配置（Web 设置面板 / profile 用户层）

**Web 设置面板**：Settings → Plugins → Plugin configuration → **项目上下文与记忆** 卡片。
写入的是 `project-context` settings 命名空间（`~/.dsh/settings.yaml`），host 侧实时生效。

也可以在 profile 的 `cordis.patch.yml` 用户层按 id 覆盖（作为设置面板的 base 层/无 settings 服务时的回退）：

```yaml
- id: project-context
  config:
    learnTurns: 6          # 本会话较上次 learn 新增的用户消息数阈值（默认 6）
    learnIntervalMs: 300000 # 自动 learn 最小间隔（默认 5 分钟）
    provider: scnet        # 可选：learn pass 专用路由（与 model 成对）
    model: GLM-5.3
    handoffEnabled: true   # 上下文接近上限时自动交接（默认 true）
    handoffAdaptive: true  # 自适应阈值（默认 true）；false 时用 handoffThresholdRatio
    handoffThresholdRatio: 0.75 # 固定阈值（占上下文窗口比例，0.1–0.95）
    handoffTargetTokens: 64000 # 自适应：每次摘要移交的对话量
    handoffKeepTokens: 20000   # 最近对话原文带入新会话的 token 预算
    handoffSummaryThinking: off # 摘要思考级别：off（默认）或 session
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `autoLearn` | `true` | 关掉后不再自动 learn（命令仍可用） |
| `learnTurns` | `6` | 本会话较上次 learn 新增的用户消息数阈值（达到后在 idle 时触发） |
| `learnIntervalMs` | `300000` | 自动 learn 最小时间间隔 |
| `forceDedupeMs` | `15000` | 强制 learn 的去重窗口 |
| `maxTokens` | `8192` | 辅助模型调用（learn / 交接摘要）输出上限 |
| `provider` / `model` | 空 | learn 路由覆盖；默认用 agent 最近一次请求的路由 |
| `handoffEnabled` | `true` | 关掉后不再自动交接，`/handoff` 仍可用 |
| `handoffAdaptive` | `true` | 自适应阈值（按窗口/基线/保留量推导）；false 时用固定比例 |
| `handoffThresholdRatio` | `0.75` | `handoffAdaptive: false` 时的固定比例（0.1–0.95） |
| `handoffTargetTokens` | `64000` | 自适应模式：每次摘要移交的对话量（8000–200000） |
| `handoffKeepTokens` | `20000` | 最近对话原文带入新会话（0–200000，0 = 只带摘要） |
| `handoffSummaryThinking` | `off` | 摘要调用思考级别：`off` 或 `session` |

两个插件各自接受同一套配置；`autoLearn` 独立生效。Web 面板与 profile 配置共用同一命名空间，面板里"未覆盖"的字段回落到 profile 配置，再回落到 schema 默认值。

## 命令（web/交互 profile）

| 命令 | 行为 |
|---|---|
| `/context` | 显示 CONTEXT.md 与会话日志路径 |
| `/context-update` | 立即对当前会话跑一次 learn 并更新 CONTEXT.md |
| `/session-log` | 立即写出当前会话 JSONL + Markdown |
| `/memory` | 显示项目记忆路径与状态 |
| `/memory-learn` | 立即跑一次 learn，更新 MEMORY.md / 技能 |
| `/handoff` | 立即交接：摘要当前会话并另开新会话继续（需 web/API profile） |
| `/handoff status` | 显示开关、自适应/固定阈值、当前上下文占用与保留量 |
| `/handoff on` / `off` | 开关自动交接（写入 `project-context` 设置） |
| `/handoff auto` / `0.6` / `60%` | 切自适应阈值；给比例则切固定比例 |
| `/handoff target 64k` / `keep 20k` | 自适应移交量 / 最近保留量（`keep 0` = 只带摘要） |
| `/handoff thinking off\|session` | 摘要调用思考级别 |

## 行为要点

- **注入方式**：用 dsh 原生的 `ctx.systemPrompt.context()` 动态 runtime context，
  内容变化时才生成一次快照（KV-cache 友好）；文本开头明确"是项目上下文，不是新指令"。
- **触发时机**：agent 进入 idle / disposed 时写日志并尝试 learn；`session/flush`
  会等待进行中的 learn（headless、ACP 退出前因此能落盘）。
- **死锁规避**：learn 的辅助模型调用**不带 `sessionId`**——带上的话会进入
  `dsh-session-checkpoint-policy` 的 `llm/stream` 拦截 → `sessions.flush()` →
  本插件自己的 `session/flush` 等待 → 自锁。
- **subagent**：事件与日志照写，但不触发顶层 learn。
- **交接**：`turn/end` 时用 `ctx.tokenMeter` 测压、`ctx.llm.resolveModelInfo` 取模型窗口大小；
  自适应阈值 = 基线（`totalTokens - surfaceTokens`）+ 保留量 + 目标移交量（受窗口 reserve 与 8k 下限约束）。
  触发后 `conversationSplit` 拆出“较早对话（摘要用）”与“最近尾段（原文带入）”，
  摘要调用默认 `reasoningEffort: off`（模型支持时），token 截断会加长输出重试一次；
  然后写 `HANDOFF.md`、`ctx.sessionController` 新建会话、重命名为 `↪ handoff · <父会话短 id>`
  并发送“摘要 + 最近原文”；旧会话追加 `project-context/handoff` 标记事件（备案用）。
  浏览器端在会话列表里发现这个标题前缀的新会话就切过去（只认插件加载后新出现的会话）。
  自动交接失败对会话退避 5 分钟；最后一条助手消息是未回答问题时延后交接。
- **出错不打扰会话**：异常写入 `<project>/.agents/memory/errors.log`，控制台只 warn。

## 开发

```bash
pnpm typecheck        # host tsc --noEmit + 客户端 tsc --noEmit
pnpm build            # host → lib/*.js + 客户端 bundle → lib/client.js
```

- host 半边对 `@deepseek-ai/*` 只做 type-only import + `schemastery`（settings schema）；
- 客户端半边（`client/`，esbuild 打成 `lib/client.js`）只 require `react` / `react/jsx-runtime`（Web 客户端 seed），
  以 `window.__ModuleLoader__.load({id: "dsh-project-context", ...})` 形式注册；
- 客户端改动需要刷新页面/重启 `dsh web`（客户端模块系统按 boot graph 加载）。

## 许可证

MIT © 2026 呼啸山庄 (P02-1010751281)，见 [LICENSE](./LICENSE)。

设置卡片、表单与 store 兼容层的模式改编自
[dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue)
（MIT，Copyright (c) 2025 HsiangNianian），相关源文件头保留了原署名。
