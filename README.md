# dsh-project-context

为 **DeepSeek Harness (dsh)** 提供项目级持久上下文：把 dsh 的事件流会话在项目内留档，
再依次蒸馏成记忆、上下文与技能，最后在上下文将满时交接给新会话。

## 架构与数据流

```
session.jsonl（项目内副本，唯一权威）
   │
   ├─① 存档（无 LLM）      session.jsonl / session.md / INDEX.md
   │
   ├─② consolidation pass  raw + 现有 memory/context ──► CONTEXT.md + MEMORY.md
   │    （高频节流；每轮注入）                              │
   │                                                      ▼
   ├─③ autolearn pass      读 CONTEXT.md + MEMORY.md（+ 按缺证据回溯存档）
   │    （低频）                    ──► .agents/skills/<name>/SKILL.md
   │    （只注入 description，body 按需）
   │
   └─④ handoff             当前会话 raw ──► 新会话（老段摘要 + kept recent + 指向旧索引）
```

| 阶段 | 在 dsh 上的落点 |
|---|---|
| ① 存档 | dsh 会话是事件源；插件把 `session.snapshotEvents()` 镜像成项目内 `session.jsonl`（首行 header，之后一事件一行；进程内只追加增量）。`session.md` 是全事件渲染，`INDEX.md` 是机械索引 |
| ② 整理 | `raw` = 本会话事件派生的对话；一次模型调用同时产出 `CONTEXT.md` 与 `MEMORY.md`，两者经 `ctx.systemPrompt.context()` 在每轮 prompt 装配时动态注入 |
| ③ 沉淀 | 写入 dsh 原生发现的 `.agents/skills/<name>/SKILL.md`：frontmatter description 常驻技能目录，body 按需加载；缺证据时按 `INDEX.md` 回读 `session.jsonl`（渲染为对话） |
| ④ 交接 | 经 dsh sessions service 新建会话并排队首条消息（老段摘要 + kept recent + 旧存档指针），同时写 `HANDOFF.md`；web 端凭标记自动切到新会话。阈值 0.4 早于 dsh 内置压缩的 0.8，两者可共存 |

### 四个插件

| 插件（子路径） | 阶段 | 触发 | 产物 |
|---|---|---|---|
| `project-context`（包主入口） | ① 存档 | 事件驱动（见下）；`/context`、`/session-log` | `session.jsonl` / `session.md` / `INDEX.md` |
| `project-memory`（`/memory`） | ② 整理 | idle / disposed + 节流；`/context-update` | `CONTEXT.md` + `MEMORY.md`（每轮注入） |
| `project-autolearn`（`/autolearn`） | ③ 沉淀 | 低频（新材料 + 轮数/间隔）；`/autolearn` | `.agents/skills/<name>/SKILL.md` |
| `project-handoff`（`/handoff`） | ④ 交接 | 上下文越过阈值；`/handoff` | `HANDOFF.md` + 新会话 |

四个插件共享同一份配置（设置面板一次编辑）。

## 自动归档（①）

无模型调用，事件驱动；`session.jsonl` 为唯一权威：

| 时机 | 动作 |
|---|---|
| `turn/end` | `session.jsonl` 追加增量（不渲染 Markdown） |
| agent `idle` / `disposed` | 追加 JSONL + 追加 `session.md` + upsert `INDEX.md` |
| `session/disposed` | 收尾写出 + 释放进程内游标 |
| `session/flush` | 等待进行中的写入（上限 90s），保证落盘 |
| `/session-log` | 手动立即写出（含索引刷新） |

- `session.jsonl`：首行 header，之后每个 dsh 事件一行；进程内按游标增量 append，长会话不重写整份文件。
- `session.md`：全事件 pretty-JSON 渲染（含 tool 调用、tool 结果、thinking、compaction、模型切换等），供人阅读与交接导航，不参与自动流程。
- `INDEX.md`：每会话一行 `- [id](id/session.md) — YYYY-MM-DD — 标题`；标题取 dsh 自己的 `session/title` 事件（回退首条用户消息），同一会话原位刷新，每项目一条写链防并发丢行。
- 项目根：会话 cwd 的 git 顶层（`git rev-parse --show-toplevel`），非 git 目录回退 cwd。
- 首次写日志时自动在 `session-logs/` 放一个忽略一切的 `.gitignore`，不动项目根 ignore。
- 只归档插件启用后实际发生的会话（首次写出会带上该会话此前的完整事件快照）；已结束且未归档的历史会话不会补。
- 异常写入 `.agents/memory/errors.log`（scope `session-log`），不打断会话。

## 数据布局（放在项目内）

```
<project>/.agents/
├── skills/<name>/SKILL.md            # ③ 沉淀的技能（description 进目录，body 按需加载）
└── memory/
    ├── MEMORY.md                     # ② 持久项目记忆
    ├── CONTEXT.md                    # ② 会话摘要 + key points + open tasks
    ├── HANDOFF.md                    # ④ 最近一次交接的摘要（含旧存档指针）
    ├── errors.log                    # 各阶段吞掉的异常（诊断用）
    └── session-logs/
        ├── INDEX.md                  # ① 机械会话索引（无 LLM）
        ├── .gitignore                # 自动生成：忽略整个目录
        └── <session-id>/             # session.jsonl + session.md（项目内副本）
```

dsh 自身仍把会话存在 `~/.dsh/sessions/…`；`session-logs/` 是项目内副本，便于随项目阅读与检索。
更早版本的目录布局会在 session 启动时自动合并迁移（旧记忆 / 上下文 / 日志 / 技能各归其位）。

## 安装

```bash
cd <这个仓库> && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-project-context   # 自动应用包内 cordis.patch.yml
dsh --profile web --dump-config | grep -A3 project-         # 验证
```

卸载：`dsh plugin --profile web remove dsh-project-context`。

## 配置

Settings → Plugins → Plugin configuration → **项目上下文** 卡片（记忆整理 / 技能沉淀 / 自动交接三区，
共享的辅助模型路由在记忆整理区末尾）；写入 `~/.dsh/settings.yaml` 的 `project-context` 段，
host 侧实时生效。也可在 profile 的 `cordis.patch.yml` 用户层按 id 覆盖（作为面板的 base 层）。

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
| `/autolearn` | 立即沉淀技能（③）；证据不足时按索引回读 `session.jsonl` |
| `/handoff` | 立即交接：摘要当前会话并另开新会话继续 |
| `/handoff status` | 显示开关、阈值、当前上下文占用与保留量 |
| `/handoff on` / `off` | 开关自动交接 |
| `/handoff auto` / `0.4` / `60%` | 切自适应；给比例则切固定比例 |
| `/handoff target 64k` / `keep 20k` | 自适应移交量 / 保留量（`keep 0` = 只带摘要） |
| `/handoff thinking off\|session` | 切换摘要 thinking |

## 说明

- ② 由 `project-memory` 独占：在 agent idle / disposed 触发，`session/flush` 会等待进行中的调用；
  异常写入 `.agents/memory/errors.log`，不打断会话。同一项目一次只跑一个整理 pass，版本去重避免重复写入。
- ③ 由 `project-autolearn` 独占：先读 `MEMORY.md` + `CONTEXT.md` + `INDEX.md`；模型可返回至多 3 个待回读会话，
  插件从对应 `session.jsonl` 提取对话（忽略 `assistant/message.stream` 等大负载、各截断 16KB）后二次调用；
  技能写入 `.agents/skills/<name>/SKILL.md`，由 dsh 原生发现，只把 description 放进技能目录、body 按需加载；
  已存在的技能不会覆盖。
- ④ 摘要输入是 `MEMORY.md`、最近对话窗口与文件操作索引，不依赖整理是否运行（没有 `MEMORY.md` 也能交接）。
  摘要失败对会话退避 5 分钟；最后一条助手消息是未回答的问题时延后交接。
- ②③④ 只作用于顶层会话（`origin !== "subagent"`）；① 对子会话同样留档。

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
