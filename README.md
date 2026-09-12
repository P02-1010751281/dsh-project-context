# dsh-project-context

为 **DeepSeek Harness (dsh)** 提供项目级持久上下文：

```
session.jsonl（项目内副本，唯一权威）
  ├─ ① 存档（无 LLM）      session.jsonl / session.md / INDEX.md
  ├─ ② consolidation 高频  raw + MEMORY.md + CONTEXT.md → MEMORY.md + CONTEXT.md（每轮注入）
  ├─ ③ autolearn 低频      MEMORY.md + CONTEXT.md（缺证据时按 INDEX.md 回读 session.jsonl 对话）→ .agents/skills/<name>/SKILL.md
  └─ ④ handoff             当前会话 raw → 新会话（老段摘要 + kept recent + 旧 log/INDEX 指针）
```

| 插件 | 职责 |
|---|---|
| `project-context`（包主入口） | ① 会话存档与索引（无 LLM） |
| `project-memory`（`/memory` 子路径） | ② 记忆整理：一次调用产出 `CONTEXT.md` + `MEMORY.md`，两者每轮注入 |
| `project-autolearn`（`/autolearn` 子路径） | ③ 技能沉淀：低频，缺证据时按索引回读 `session.md` |
| `project-handoff`（`/handoff` 子路径） | ④ 上下文接近上限时摘要（带旧会话指针）并另开新会话继续 |

## 数据布局（放在项目内）

```
<project>/.agents/
├── skills/<name>/SKILL.md            # autolearn 沉淀的技能（description 进目录，body 按需加载）
└── memory/
    ├── MEMORY.md                     # 持久项目记忆
    ├── CONTEXT.md                    # 会话摘要 + key points + open tasks
    ├── HANDOFF.md                    # 最近一次交接的摘要
    ├── errors.log                    # 插件吞掉的异常（诊断用）
    └── session-logs/
        ├── INDEX.md                  # 机械会话索引（无 LLM）
        └── <session-id>/             # session.jsonl + session.md（项目内副本；目录自带 .gitignore）
```

dsh 自身仍把会话存在 `~/.dsh/sessions/<project-slug>/…`；`session-logs/` 只是项目内副本，
写入时会自动放置一个忽略一切的 `.gitignore`，避免会话内容被误提交。
更早版本的目录布局会在 session 启动时自动合并迁移。

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
| `autoConsolidate` | `true` | 关掉后不再自动整理（命令仍可用） |
| `consolidateTurns` | `6` | 较上次整理新增的用户消息数达到后在 idle 触发 |
| `consolidateIntervalMs` | `300000` | 自动整理最小间隔 |
| `autoLearn` | `true` | 关掉后不再自动沉淀技能（命令仍可用） |
| `autolearnTurns` | `20` | 自上次沉淀累计的用户消息数阈值 |
| `autolearnIntervalMs` | `1800000` | 自动沉淀最小间隔；仅在有新 MEMORY/CONTEXT 内容时执行 |
| `forceDedupeMs` | `15000` | 强制调用去重窗口 |
| `maxTokens` | `8192` | 辅助模型调用（整理 / autolearn / 交接摘要）输出上限 |
| `provider` / `model` | 空 | 辅助调用路由覆盖；默认用 agent 最近一次请求的路由 |
| `handoffEnabled` | `true` | 关掉后不再自动交接，`/handoff` 仍可用 |
| `handoffAdaptive` | `true` | 自适应阈值（按窗口/基线/保留量推导）；false 时用固定比例 |
| `handoffThresholdRatio` | `0.4` | `handoffAdaptive: false` 时的固定比例（0.1–0.95） |
| `handoffTargetTokens` | `64000` | 自适应模式：每次摘要移交的对话量（8000–200000） |
| `handoffKeepTokens` | `20000` | 最近对话原文带入新会话（0–200000，0 = 只带摘要） |
| `handoffSummaryThinking` | `off` | 摘要调用思考级别：`off` 或 `session` |

四个插件共用同一配置命名空间；面板未覆盖的字段回落到 profile 配置，再回落到默认值。

## 命令（web/交互 profile）

| 命令 | 行为 |
|---|---|
| `/context` | 显示 CONTEXT.md、会话日志与索引路径 |
| `/context-update` | 立即整理一次（②）：更新 MEMORY.md 与 CONTEXT.md |
| `/session-log` | 立即写出当前会话 JSONL + Markdown（并刷新索引） |
| `/memory` | 显示项目记忆路径与状态 |
| `/autolearn` | 立即沉淀技能（③）；证据不足时按索引回读 session.md |
| `/handoff` | 立即交接：摘要当前会话并另开新会话继续 |
| `/handoff status` | 显示开关、阈值、当前上下文占用与保留量 |
| `/handoff on` / `off` | 开关自动交接 |
| `/handoff auto` / `0.4` / `60%` | 切自适应；给比例则切固定比例 |
| `/handoff target 64k` / `keep 20k` | 自适应移交量 / 保留量（`keep 0` = 只带摘要） |
| `/handoff thinking off\|session` | 切换摘要 thinking |

## 说明

- CONTEXT.md / MEMORY.md 经 `ctx.systemPrompt.context()` 动态注入（每轮 prompt 装配时读取）；
  `project-handoff` 默认自适应阈值，“摘要 + 最近原文（`handoffKeepTokens`）”作为新会话第一条消息发送，
  摘要同时写入 `.agents/memory/HANDOFF.md`；新会话首条消息与 HANDOFF.md 都带上旧会话 `session.md`
  与 `INDEX.md` 的相对路径。
- ② consolidation 由 `project-memory` 独占：一次模型调用同时产出 `MEMORY.md` 与 `CONTEXT.md`（`autoConsolidate` 自动触发，`/context-update` 手动），
  在 agent idle / disposed 时触发，`session/flush` 会等待进行中的调用；
  异常写入 `.agents/memory/errors.log`，不打断会话。会话日志按追加写入，长会话不会每轮重写整份文件，
  机械索引 `INDEX.md` 随 Markdown 渲染一起刷新（由 `project-context` 写入）。
- ③ autolearn 由独立的 `project-autolearn` 插件独占：读 `MEMORY.md` + `CONTEXT.md` + `INDEX.md`，缺具体步骤时按索引回读最多 3 份
  `session.jsonl`（按 dsh 事件格式渲染为对话、各截断 16KB，忽略 `assistant/message.stream` 等大负载）再生成技能；技能写入 `.agents/skills/<name>/SKILL.md`，由 dsh 原生发现注入
  description，body 按需加载；已存在的技能不会覆盖。
- 自动交接与 dsh 内置 `dsh-compaction-basic`（原地压缩）可共存；摘要输入是 `MEMORY.md`、最近对话
  窗口与文件操作索引，不依赖整理是否运行（没有 `MEMORY.md` 也能交接）。摘要失败对会话退避
  5 分钟，最后一条助手消息是未回答的问题时延后交接。

## 开发

```bash
pnpm typecheck        # host + 客户端 tsc --noEmit
pnpm build            # host → lib/*.js，客户端 bundle → lib/client.js
pnpm test             # 先编译再跑 node:test 纯逻辑回归（test/）
```

host 侧对 `@deepseek-ai/*` 仅 type-only import；客户端 bundle 只外部化 `react` / `react/jsx-runtime`，
改动后需刷新页面/重启 `dsh web`。

## 许可证

MIT © 2026 呼啸山庄 (P02-1010751281)，见 [LICENSE](./LICENSE)。

设置卡片、表单与 store 兼容层的模式改编自
[dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue)
（MIT，Copyright (c) 2025 HsiangNianian），相关源文件头保留了原署名。
