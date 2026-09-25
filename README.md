# dsh-project-context

为 **DeepSeek Harness (dsh)** 提供项目级持久上下文：把 dsh 的事件流会话在项目内留档，
再依次蒸馏成记忆、上下文与技能，最后在上下文将满时交接给新会话。

当前版本 **`v0.1.0`**；逐版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 安装

```bash
cd <这个仓库> && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-project-context   # 自动应用包内 cordis.patch.yml
dsh --profile web --dump-config | grep -A3 project-         # 验证
```

卸载：`dsh plugin --profile web remove dsh-project-context`。

## 架构与数据流

```
会话（事件流）
   │ ① 存档：无模型调用，逐轮增量 append
   ▼
session.jsonl（唯一权威）──► session.md（全量渲染，人读）──► INDEX.md（每会话一行）
   │
   ├─ ② 整理（1 次调用，节流）  raw 对话 + MEMORY/CONTEXT ─► CONTEXT.md + MEMORY.md ─► 每轮注入
   │
   ├─ ③ 沉淀（1 次调用，低频）  MEMORY/CONTEXT + 索引 ─► skills/<name>/SKILL.md
   │                            └ 证据不足（<2 个已存档会话）─► memory/skill-candidates/<name>.md
   │
   └─ ④ 交接（1 次调用）        当前会话 ─► 新会话（旧段摘要 + 最近原文 + 旧存档指针）+ HANDOFF.md
```

| 阶段 | 插件（子路径） | 触发 | 产物 |
|---|---|---|---|
| ① 存档 | `project-context`（主入口，`/context`、`/session-log`） | 事件驱动（见下）；`/session-log` | `session.jsonl`、`session.md`、`INDEX.md` |
| ② 整理 | `project-memory`（`/memory`、`/context-update`） | idle / disposed + 节流；命令 | `CONTEXT.md` + `MEMORY.md`（每轮注入） |
| ③ 沉淀 | `project-autolearn`（`/autolearn`） | 材料有更新 且（累计轮 ≥ `autolearnTurns`(20) 或距上次 ≥ `autolearnIntervalMs`(30min)）且项目内至少有一个真实存档 | `.agents/skills/<name>/SKILL.md`；证据不足写 `skill-candidates/` |
| ④ 交接 | `project-handoff`（`/handoff`） | 上下文占用越过阈值 **且没有仍在运行的后台子代理**，且触发它的 `turn/end` 之后本会话未再开新轮；命令 | 新会话 + `HANDOFF.md` |

四个插件是同一包内的独立 cordis 插件，共享一份配置与生命周期
helper（会话身份、串行后台任务、落盘跟踪）。② 的 raw 输入由本会话事件派生；③ ④
只作用于顶层会话（`origin !== "subagent"`），① 对子会话同样留档。

## 数据布局

```
<project>/.agents/
├── skills/<name>/SKILL.md          # ③ 沉淀的项目技能（description 常驻，body 按需加载）
└── memory/
    ├── memory.jsonl                # ② 权威记忆：append-only 记录 {"ts","op":"replace"|"append","text"}
    ├── MEMORY.md                   # ② 由 journal 折叠渲染（人读 / 注入 / 外部手改入口）
    ├── MEMORY.md.memory-backup-*   # 覆写前的字节级备份（保留最新 5 份；1 小时内的不删）
    ├── MEMORY.md.lock / .steal     # 跨进程写锁（30s 陈旧；claim 防双抢）
    ├── session-index.lock / .steal # ① 索引的跨进程写锁（同一套 30s/35s 参数；与 MEMORY.md 分开）
    ├── memory-log-*.jsonl          # journal 超 512KB 折叠后的归档（保留最新 5 份）
    ├── CONTEXT.md                  # ② 工作态：摘要 / 关键点 / open tasks（每轮注入）
    ├── HANDOFF.md                  # ④ 最近一次交接摘要（含旧存档指针）
    ├── autolearn-state.json        # ③ 沉淀闸门（材料时间戳 + 上次尝试时刻，跨重启生效；本地件，被忽略）
    ├── skill-candidates/<name>.md  # ③ 待确认候选（approve 后转正）
    ├── .gitignore                  # 首次写出时生成：忽略 journal / 备份 / 锁 / errors.log / autolearn-state.json 等本地件
    ├── errors.log                  # 各阶段捕获的异常；密钥脱敏后写入，单条截断 8000 字符，>1MB 轮换保留最新 64k
    └── session-logs/
        ├── INDEX.md                # ① 机械索引：每会话一行，按 id 去重、只留最新 200 行
        ├── .gitignore              # 首次写出时生成，忽略整个目录
        └── <session-id>/{session.jsonl,session.md}
```

记忆与存档同构：**journal 是唯一权威、`MEMORY.md` 是派生渲染**。
写入顺序固定为「先在锁内做字节级备份 → 追加 journal → 渲染 `MEMORY.md`」，因此崩溃只会让渲染落后于
journal，读取时以 journal 折叠结果为准；手改 `MEMORY.md`（且比 journal
新）会被读取优先采信，并在下一次整理时作为一条记录收进 journal 历史。损坏的 journal
行会被跳过并计数（写 `errors.log`，`/memory` 提示），整份不可读时 fail closed 而不是静默回退。旧版
`<memory>/session-index.md` 会在每次写索引时并入新索引（同 id 以新索引的行为准）、链接改写为相对
形式并按行内日期排序；只有它持有的每一行都已写进新索引时才删除它，因此 200 行上限丢行时旧文件留在
原处、下次再采。

配置不在项目内：开关与参数在 `~/.dsh/settings.yaml` 的 `project-context` 段（设置卡片编辑）。dsh
自身仍把会话存在 `~/.dsh/sessions/…`，`session-logs/` 是项目内副本，便于随项目阅读与检索。
更早版本的目录布局在 session 启动时自动迁移（旧记忆 / 上下文 / 日志 /
技能各归其位；文件/目录类型冲突时两侧都保留并在日志点名；`.omp` 旧记忆存在但读不了会记进
`errors.log` 而不是静默跳过）。

## 源码结构

```
src/
├── project-context/        # ① 存档（包主入口 "dsh-project-context"）
│   ├── index.ts            #    插件入口：turn/end 追加、idle/disposed 落盘、/context、/session-log
│   ├── session-log.ts      #    session.jsonl / session.md 写入
│   ├── session-index.ts    #    INDEX.md 渲染与跨进程锁
│   ├── archive.ts          #    存档回读（渲染成对话供 ③ 取证）
│   ├── session-jsonl.ts    #    session.jsonl / pi JSONL 解析与索引元数据
│   ├── zip.ts              #    dsh 导出 zip 的目录、deflate 条目与 session.jsonl 读取
│   └── import.ts           #    回填入口：单会话 / 单文件 / 整目录，幂等
├── project-memory/         # ② 整理（"dsh-project-context/memory"）
│   ├── index.ts            #    插件入口：整理 pass 编排、/context-update、/memory 回执
│   ├── memory-store.ts     #    记忆子系统对外门面（不变量文档 + 公共 API 再导出）
│   ├── journal.ts          #    追加日志：解析 / 折叠 / 轮转 / 归档
│   ├── record.ts           #    一次写入：采纳外部编辑、追加、重建渲染、legacy 导入
│   ├── load.ts             #    读取路径：journal / MEMORY.md / legacy，损伤报告
│   ├── document.ts         #    文档规范化与按行截断标记
│   ├── poison.ts           #    存储回复（JSON poison）解码与归一化比较键
│   ├── backup.ts           #    写入前字节级备份与清理
│   ├── consolidate.ts      #    整理 pass：节流、单飞、提示与结果落地
│   └── context-doc.ts      #    CONTEXT.md 渲染
├── project-autolearn/      # ③ 沉淀（"dsh-project-context/autolearn"）
│   ├── index.ts            #    插件入口：闸门、/autolearn 命令
│   ├── skill.ts            #    技能形状、SKILL.md 渲染、正文/描述安全校验
│   ├── candidate.ts        #    候选文件、准入规则、approve/reject 转换
│   ├── inventory.ts        #    技能清单（进提示词）与可取证的历史会话 id
│   ├── parse.ts            #    模型回复 → 候选；回溯预算
│   ├── prompt.ts           #    提示词：共享规则、正向 pass、回溯 pass
│   ├── pass.ts             #    pass 本身：每项目节流 + 单飞
│   └── learn-state.ts      #    项目本地状态（闸门时间戳等）
├── project-handoff/        # ④ 交接（"dsh-project-context/handoff"）
│   ├── index.ts            #    插件入口：session/event 监听、attempt 编排、命令注册
│   ├── threshold.ts        #    触发点 min(quality, capacity) 与护栏覆盖报告
│   ├── conversation.ts     #    会话切分、未答问题、文件索引、语言解析
│   ├── summary.ts          #    摘要提示与输出预算、HANDOFF.md 与首条消息文本
│   ├── child.ts            #    子会话创建、模型/权限携带、放弃回滚
│   ├── perform.ts          #    一次交接事务（摘要 → 落盘 → 播种 → 切换标记）
│   ├── classify.ts         #    失败分类：延后 / 暂态 / 终态
│   ├── guard.ts            #    子代理与轮次落定守卫
│   ├── state.ts            #    进程内按会话标记与测压节流
│   ├── runtime.ts          #    宿主服务结构视图与路由解析
│   ├── auto.ts             #    自动触发：测压并在越过阈值时交接
│   ├── command.ts          #    /handoff 参数解析、status 回执、手动交接
│   ├── language.ts         #    交接语言检测、标题本地化、陈旧提示识别
│   ├── marker.ts           #    交接会话标记（host 与浏览器共用）
│   └── watch.ts            #    浏览器侧自动切换
├── shared/                 # 四个插件共用
│   ├── lock.ts             #    跨进程写锁（记忆文件与会话索引共用，泛型 target）
│   ├── project-state.ts    #    项目状态**门面**（原始布局/迁移文档 + 公共 API 再导出）
│   ├── paths.ts            #    项目根定位（git + 缓存）与全部路径助手
│   ├── limits.ts           #    存储文档与提示输入的字符预算
│   ├── files.ts            #    文件系统原语：原子写、缓存读、探测、移动/合并、临时清理
│   ├── gitignore.ts        #    `.agents/.gitignore` 托管块
│   ├── error-log.ts        #    errors.log 轮转、诊断截断与脱敏写入
│   ├── redact.ts           #    日志脱敏
│   ├── migrate.ts          #    旧布局（`.pi` / `.agents/memory/skills` / `~/.omp`）一次性迁移
│   ├── config.ts           #    默认值与字段定义
│   ├── settings.ts         #    设置命名空间（web 卡片 ↔ cordis 配置）
│   ├── lifecycle.ts        #    会话身份、串行后台任务、落盘跟踪
│   ├── text.ts             #    文本计量、裁剪与渲染（回复头 / 截断 / token 估算）
│   ├── output-budget.ts    #    辅助调用的输出预算：推理预留、自适应边界、重试余量
│   ├── conversation.ts     #    会话渲染成对话分段 + 记忆输入适配
│   ├── reply-json.ts       #    从模型回复里读取结构化 JSON（容错扫描 + 解析）
│   └── model-call.ts       #    插件来源的辅助模型调用、路由与元数据
client/                     # 设置卡片、表单、zh/en 文案（bundle 进 lib/client.js）
scripts/
├── build-client.mjs        # 客户端 bundle
└── import-archives.mjs     # 回填 CLI（不依赖运行中的 dsh）
```

## 自动归档（①）

| 时机 | 动作 |
|---|---|
| `turn/end` | `session.jsonl` 追加增量（不渲染 Markdown） |
| agent `idle` / `disposed` | 追加 JSONL + 追加 `session.md` + upsert `INDEX.md` |
| `session/disposed` | 收尾写出 + 释放进程内游标 |
| `session/flush` | 等待进行中的写入（上限 90s），保证落盘 |
| `/session-log` | 手动立即写出（含索引刷新） |

- `session.jsonl`：首行 header，之后每个 dsh 事件一行。进程内按游标增量
  append，长会话不重写整份；每次写入记下目标文件的 **inode + 字节数 +
  mtime**，只有三者都仍是本进程写下的那一份才追加——被外部改写（`--replace`
  回填、手工截断/重写）时下一次写入**整份重建**，不把新事件接到别人的内容后面；
  没有新事件的写入不产生任何字节。
- `session.md`：全事件 pretty-JSON 渲染（含 tool 调用/结果、thinking、compaction、模型切换），
  供人阅读与交接导航，不参与自动流程。
- `INDEX.md`：每会话一行 `- [id](id/session.md) — YYYY-MM-DD — 标题`，标题取
  `session/title`（回退首条用户消息），同一会话原位刷新、按 id 去重后只留最新 200
  行；同一进程内的写入走一条写链，跨进程则走 `<memory>/session-index.lock`（与 `MEMORY.md` 同一套
  30s 陈旧 / 35s 等待参数；仍在运行旧构建的宿主不遵守此锁，重启后才受同一把锁约束）。等不到锁时这次
  索引写入失败并记进 `errors.log`，该行在下一轮写索引时补上。
- 项目根 = 会话 cwd 的 git 顶层（`git rev-parse --show-toplevel`），非 git 目录回退
  cwd；首次写日志时自动放一个忽略整个目录的 `session-logs/.gitignore`，不动项目根
  ignore。
- 只归档插件启用后实际发生的会话（首次写出会带上该会话此前的完整事件快照）；
  更早结束的会话用下面的回填补。异常写入 `.agents/memory/errors.log`（scope
  `session-log`），单条截断 8000 字符，文件超过 1MB 时保留最新约 64000
  字符并写入截断标记，不打断会话。

## 回填历史会话（①补，无模型调用）

```bash
# CLI（不依赖运行中的 dsh；自带 zip 读取，无需 unzip）
node scripts/import-archives.mjs --project <项目根> <archive.zip|session.jsonl|目录>…
node scripts/import-archives.mjs --project . --dry-run sessions_archive/   # 只解析并报告
node scripts/import-archives.mjs --project . --replace --no-md archives/   # 覆盖；不渲染 session.md
# 交互 profile 里：/session-log import sessions_archive/
```

- 导入结果落在 `<项目根>/.agents/memory/session-logs/<session-id>/`，`session.md`
  用与实时路径**同一份**渲染器、`INDEX.md` 用同一份索引写入，
  因此后续整理/沉淀/交接读到的回填会话与实时归档无法区分。
- `session.jsonl` **逐字节保留原文**（只把结尾规范化成一个换行；重序列化会丢掉旧版 header
  里已删除的字段）。
- 幂等：已归档的会话默认跳过，`--replace` 才覆盖；全程不调用模型。`--no-md` 只写 canonical JSONL +
  索引（`session.md` 体积是 JSONL 的数倍，纯机读场景可省）。
- 输入支持 dsh 自己导出的 zip：会话日志在 zip 根，文件名随格式代次变化（当前 `session.v3.jsonl`，第
  0 代才是 `session.jsonl`），子代理日志在 `subagents/<id>/`
  下——导入只看根目录并优先取最高代次。
- 实测规模参考：21 个 zip / 586,909 个事件 → 13s 导入，约 1.1GB（`session-logs/` 自带
  `.gitignore`，不随项目入库）。

## 配置

Settings → Plugins → Plugin configuration → **项目上下文** 卡片（记忆整理 / 技能沉淀 /
自动交接三区，共享的辅助模型路由在记忆整理区末尾），写入 `~/.dsh/settings.yaml` 的
`project-context` 段，host 侧实时生效。也可在 profile 的 `cordis.patch.yml`
用户层覆盖：四个插件共享同一个设置命名空间，base 层取**先加载的 `project-context` 行**的
`config:`（四行里的第一行），改其余三行不生效；面板未覆盖的字段回落到 profile
配置，再回落到默认值。

| 字段 | 默认 | 说明 |
|---|---|---|
| `archiveEnabled` | `true` | 关掉后不再自动写会话存档与索引（`/session-log` 仍可用） |
| `autoConsolidate` | `true` | 关掉后不再自动整理（命令仍可用） |
| `consolidateTurns` | `6` | 较上次整理新增的用户消息数达到后在 idle 触发 |
| `consolidateIntervalMs` | `300000` | 自动整理最小间隔 |
| `forceDedupeMs` | `15000` | 强制调用去重窗口 |
| `autoLearn` | `true` | 关掉后不再自动沉淀技能（命令仍可用） |
| `autolearnTurns` | `20` | 自上次沉淀累计的用户消息数阈值 |
| `autolearnIntervalMs` | `1800000` | 自动沉淀最小间隔；仅在有新 MEMORY/CONTEXT 内容时执行 |
| `maxTokens` | `8192` | 辅助模型调用的起始输出上限；整理会按「记忆+上下文需回吐的 token 数」自适应上调 |
| `maxOutputTokens` | `32768` | 自适应上调的边界（≥256）：输入很大时把单次输出上限往它上调。它是**自适应上调的边界**而不是绝对天花板：`maxTokens` 更大时以 `maxTokens` 为准；若适配器自己给出更小的模型上限，则以模型上限为准。交接摘要的失败重试同样被该边界压住（`min(2×maxTokens 或 32768 的较大者, max(maxTokens, maxOutputTokens))`；边界低于起始上限时重试被取消，只发一次原请求） |
| `provider` / `model` | 空 | 辅助调用路由覆盖；默认用 agent 最近一次请求的路由 |
| `handoffEnabled` | `true` | 关掉后不再自动交接，`/handoff` 仍可用 |
| `handoffAdaptive` | `true` | 自适应阈值 = **护栏**取小：质量层（`autoCompactTokenLimit ?? knee(window)`——宿主暴露可用输入上限时优先用它，目前 dsh 只暴露 `contextWindow`，故恒回退膝曲线）与可用窗口；基线/保留量只决定可行性下限。false 时用固定比例 |
| `handoffThresholdRatio` | `0.4` | `handoffAdaptive: false` 时的固定比例（0.1–0.95）；被 4K 安全边际压掉时阈值标签会写明实际值 |
| `handoffTargetTokens` | `64000` | 自适应模式：每次摘要移交的对话量（8000–200000）。这是**手动设定**的阈值请求，触发点由护栏决定；一旦被护栏压掉，`/handoff status` 点名被覆盖的值与压住它的那条护栏，不静默 |
| `handoffKeepTokens` | `20000` | 最近对话原文带入新会话（0–200000，0 = 只带摘要）。切点按**消息**而不是按轮，且至少要保留一条消息，所以实际带入量最多比它多一条消息（每条渲染后 ≤ 4000 字符） |
| `handoffSummaryThinking` | `off` | 摘要调用思考级别：`off` 或 `session` |
| `handoffLanguage` | `auto` | 交接语言：`auto` 按对话判定（CJK≥2 → zh；纯拉丁≥20 字母 → en；否则沿用上一条交接提示的语言，兜底 en），也可固定 `zh` / `en` |
| `handoffPendingQuestion` | `defer` | 最后一条助手消息是未答问题时：`defer` 让**自动**交接等回答（手动 `/handoff` 始终执行），`wait` 照常交接并把问题作为独立段落带进新会话，且该段落取代常规的「先做下一步」结尾（= pi 侧 `handoffGuard: wait`） |

## 命令（web/交互 profile）

| 命令 | 行为 |
|---|---|
| `/context` | 显示 CONTEXT.md、会话日志与索引路径 |
| `/context-update` | 立即整理一次（②）：更新 MEMORY.md 与 CONTEXT.md；回执按实际结果区分已更新 / 被截断 / 无新内容 / 被去重 / 失败 |
| `/session-log` | 立即写出当前会话 JSONL + Markdown（并刷新索引） |
| `/session-log import <path…>` | 回填导入历史档案（zip/jsonl/目录，幂等、无模型调用） |
| `/memory` | 显示项目记忆路径与状态 |
| `/autolearn` | 立即沉淀技能（③）；证据不足时按索引回读 `session.jsonl`；`list` / `approve <name>` / `reject <name>` |
| `/handoff` | 立即交接：摘要当前会话并另开新会话继续 |
| `/handoff status` | 显示开关、阈值、当前上下文占用与保留量；**手动设定的阈值被护栏压掉**时点名被覆盖的值与压住它的护栏（质量膝 / 容量 / 安全边际）；自动交接因“没有更早内容可摘要”被跳过时，一并报告**从何时起被跳过**与原因（重新可摘要即清除） |
| `/handoff on` / `off` | 开关自动交接 |
| `/handoff auto` / `0.4` / `60%` | 切自适应；给比例则切固定比例 |
| `/handoff target 64k` / `keep 20k` | 自适应移交量 / 保留量（`keep 0` = 只带摘要）；target 是被护栏约束的**请求**，被压掉时 `/handoff status` 点名 |
| `/handoff thinking off\|session` | 切换摘要 thinking |
| `/handoff pending defer\|wait` | 未答问题时：延后交接 / 照常交接并把问题带进新会话 |
| `/handoff lang auto\|zh\|en` | 交接语言：自动判定或固定中文 / 英文 |

## 说明

- ② 由 `project-memory` 独占：idle / disposed 触发，`session/flush`
  等待进行中的调用；同一项目一次只跑一个整理 pass，版本去重避免重复写入。
- ③ 由 `project-autolearn` 独占：先读 `MEMORY.md` + `CONTEXT.md` + `INDEX.md`，模型可返回至多 3
  个待回读会话，插件从对应 `session.jsonl` 提取对话（忽略 `assistant/message.stream`
  等大负载、各截断 16KB）后二次调用。闸门时间戳持久化在 `.agents/memory/autolearn-state.json`，
  **重启后不会重复沉淀**；它记录的是**本次真正蒸馏的材料时间戳**（而不是调用时刻），
  所以整理恰好在同一 idle 写入的新记忆不会被当成“已沉淀”而漏掉。
  **自动**沉淀时项目里一个真实存档都没有就直接跳过（正式技能要两个、候选要一个，跑了也不会有产物，
  白花一次模型调用；`/autolearn` 显式强制仍会调用）；prompt 里带 `<existing-skills>`
  清单并禁止重名；回读前逐个校验 `session-logs/<id>/session.jsonl` 真实存在（模型幻觉出的 id
  会被丢弃，全部落空时按“无证据”处理）；输出上限按需自适应上调（受 `maxOutputTokens`
  约束）。正式技能需要至少两个**已验证**的存档会话做证据，只举一个会话的提案进 `skill-candidates/`
  等 `/autolearn approve`；已存在的技能不覆盖，含提示注入话术的 body
  一律拒绝。
- ④：摘要输入是 `MEMORY.md`、最近对话窗口与文件操作索引，不依赖整理是否运行；摘要失败退避 5
  分钟；未答问题按 `handoffPendingQuestion` 处理——`wait`
  会把问题原文作为独立段落带进新会话（此前只跳过延后、问题实际会丢），
  并以该段落**取代**常规的“先做下一步”结尾。
  自动交接在**本会话还有未结束的后台子代理时延后**（枚举读 `subagents.listChildren()` 并取其中
  `mode: continuable` 的直接子会话：0.1.6 的分类行与 0.1.7-alpha.1 的裸目录行
  `{id, createdAt, mode, label}` 都带 `mode`，一次读取同时覆盖两个版本；**是否在跑读活体注册表**
  `agents.get(id)?.status === "running"`，**不能**读清单里的 `activity`——那个字段的含义是「Session store
  还持有这个子会话」，落定后仍驻留的 teammate 也会报 `running`，会把交接无限期挡住；上游 `list_agents`
  在同样位置重新判状态，并写明 “Report turn activity without exposing whether the child is loaded”。
  **读不懂的清单必须交回**会话日志扫描，而不是当成「没有在跑」：`diagnostic` 行、没有 `mode` 的行、查询失败、
  或拿不到 `agents` 服务都走日志，只有空清单才是「确实没有」。teammate 是同一个注册表里的
  **continuable 直接子会话**（`subagents.startContinuable` 建的，会写 `subagent/catalog`），所以正在跑的
  teammate 同样让自动交接延后。**手动 `/handoff now` 也受这条守卫约束**：交接会退休旧会话并取消其中在跑的
  子代理，所以有在跑的直接**拒绝并点名**——回执给出数量、子会话 id 与杠杆（先 `interrupt_agent`，或等它们
  落定后重试），且不创建任何子会话）：
  子代理落定会唤醒父会话并开启新一轮，此时交接会变成父子两个会话同时改同一个项目（本仓库 2026-09-16
  实际踩到过），所以等到没有在跑的子代理再交；**同一个失败还会从另一侧发生**——触发点是
  `turn/end`，但 harness 会在当前轮一关就立刻把队列里的用户消息开成下一轮，
  所以只要交接时队列里已经有消息，父会话在插件写摘要的那几秒里就已经在跑新一轮了（本仓库 2026-09-17
  实际踩到过：`turn/end` 与下一轮 `turn/start` 只差 4 毫秒，8.3
  秒后子会话被创建，父子同时改了同一处代码）。所以自动交接在**触发它的那个 `turn/end`
  之后本会话又开了新轮**时直接放弃（不算失败、不占失败退避、不写
  `errors.log`，只记一条限频服务端日志）。检查点有四处：摘要调用前、摘要调用后、
  **投递首条消息前**（创建子会话是 RPC、再带上权限与模型，这段窗口里开的新轮同样要拦）、
  以及**投递之后**（消息 RPC 本身也是窗口）。前两处还没创建任何东西，直接放弃；后两处子会话已存在，
  于是**撤销**而不是硬删（dsh 没有删除会话的 RPC）：未播种的——不播种、标题改成
  `handoff deferred · …`（不带切换标记，浏览器不会切过去）、并用
  `workspaceRegistry.archiveSession()` 归档掉，侧栏不会多出一个空会话（归档只隐藏不删除，客户端
  `uiWorkspace.unarchiveSession` 可以还原）；已播种的——先用 `sessionController.cancel()`
  撤销刚投递的那一轮，**取消成功才归档**，取消失败或运行时没有该调用就保持可见，
  免得把一个可能还在跑重复续接的会话藏起来。`HANDOFF.md` 放最后写，
  所以任何被放弃的尝试都不会在项目里留下文件。真正的交接**失败**（不是延后）保持可见，仍以
  `handoff failed · …` 留在列表里以便排查。这套守卫是**尽力而为**的：最后一次检查之后还剩一个
  `rename` RPC 的窗口，无法再收窄；下一次尝试照常。判定读的是会话日志里更晚的 `turn/start`，因为
  `turn/end` 提交时 driver 的 phase 仍是 `running`，读 `agent.status`
  无法区分“这一轮刚结束”和“已经在跑下一轮”；落在某次尝试进行中的 `turn/end`
  不会被丢掉，而是记下来、等这次尝试结束后**按它补评**（否则一次被吞掉的、真正空闲的 `turn/end`
  可能让该会话再也不交接；若这次尝试以失败告终，则补评先受 5 分钟失败退避约束，不会立刻重试）。手动
  `/handoff now` 不受**这条轮次落定**限制（它本身就在一轮里执行），但仍受上面的子代理守卫约束（有在跑的
  就拒绝并点名）。**自动**交接因“没有更早内容可摘要”
  而跳过时写一条**限频的服务端日志**（约 10 分钟一次），并在 `/handoff status`
  的回执里报告**从何时起被跳过、以及原因**（同一个会话一旦重新变得可摘要，这条报告随即清除）——dsh
  没有 host 侧的通知服务，UI 里不会主动弹提示，`/handoff status`
  是唯一可见面；要看当时的上下文占用也用它，要强制移交用 `/handoff now`（手动路径的回执是可见的）。
  没有可摘要的更早消息时（空会话，或整段对话都落在 `handoffKeepTokens` 原文窗口内）直接拒绝，手动
  `/handoff now` 回一条错误说明而不是伪造摘要，并提示用 `/handoff keep 0`
  摘要整段对话。交接**跟随对话语言**（`handoffLanguage`，含摘要指令、六个段落标题与首条消息）；
  重放中**上一轮交接提示会被替换成一行标记**，不再把陈旧的交接提示原样带进孙会话。
  带入的"最近对话原文"是把消息渲染成文本（`## user` / `## assistant` /
  `## tool result`，助手只调工具时是 `[tool: 名称]`）——dsh 的交接只能把文本投给子会话、
  不能重放结构化消息，所以这里是**渲染**而不是 pi 的**真消息重放**；
  **工具输出会一并带入**（每条截断 1500 字符，`textOf` 读 `tool-result`
  块），同一份渲染也是整理/沉淀的输入。新会话沿用父会话的 **agent
  preset**、**权限预设**与**当前模型/思考级别**（`sessionController.create` 既不接受 model
  也不接受权限：创建后先按 `permissionPresets.current(父会话)` 取预设并经服务的 `set(子会话, 预设)`
  写入沙箱模式与审批策略，再按父会话最后一次请求的路由调 `selectModel`，
  最后才投递首条消息——否则用户切到的"完全访问"到了子会话会退回"每个敏感操作都要问"；父会话是
  `custom` 组合、子会话尚未进入内存、或运行时没有这些服务时按原样创建，失败只记警告不影响交接），
  workspace 按 cwd **精确匹配**接入（匹配不到就只用 cwd 创建），首条消息里的存档指针是绝对路径、
  `HANDOFF.md` 里写仓库相对路径；浏览器端在标题出现时自动切换，
  但**当前会话输入框非空或正在提交时不抢**。新会话被标记后，**被替换的旧会话会被「退休」**：先停掉它
  仍在运行的工作，再归档掉。dsh 的交接是**分叉**（子会话是另一个会话），旧会话不结束就仍算「活动」，
  而工作区列表按活动度分组，于是它排在自己延续的上面——这正是用户报的「handoff 的新会话落在旧会话
  下面」。宿主没有「结束会话」的 RPC，`archiveSession` 是唯一等价物，且必须带 `stopActivity`：不带该
  标志时宿主对仍有运行中工作的会话直接**拒绝**归档；归档只隐藏，日志、归档产物与工作区位置都保留，
  客户端可还原。带 `stopActivity` 时宿主还会经 subagent 家族的 `workspace/session-stop`，把该会话**仍在
  运行的子代理后代**（含 teammate）逐个 `cancel`——所以被替换会话里在跑的子代理不会变成孤儿，反过来
  也意味着交接会中断它们手上的活。时机是重点：**自动档**触发时该会话已经落定，立即退休；**手动档 `/handoff now` 跑在
  自己那一轮里**，此时归档会停掉正在渲染回执的那一轮，所以排到该会话的 `turn/end` 再退休（一次性，
  `session/disposed` 丢掉标记）。pi 侧不需要对应处理：它的 handoff 走 `ctx.newSession()`，是**替换**
  而非分叉，旧会话随之结束。阈值 0.4 早于 dsh 内置压缩的
  0.8，两者可共存。
- ②③④ 只作用于顶层会话（`origin !== "subagent"`），① 对子会话同样留档；各阶段的**异常**都写
  `.agents/memory/errors.log`，不打断会话（④ 的“交接延后”按设计不算异常，只记服务端日志）。

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 开发

```bash
pnpm typecheck        # host + 客户端 tsc --noEmit
pnpm build            # host → lib/*.js，客户端 bundle → lib/client.js
pnpm test             # 先编译再跑 node:test 纯逻辑回归（test/）
```

host 侧对 `@deepseek-ai/*` 仅 type-only import（唯一的运行时值依赖是 `schemastery`，已声明在
`peerDependencies`）；客户端 bundle 的 esbuild 外部化只有 `react` / `react/jsx-runtime`，另有运行时
`require("@deepseek-ai/dsh-client-store")` 由 web shell 的平台种子提供。

客户端改动**只有 `pnpm build`（或 `pnpm build:client`）才会进 `lib/client.js`**：`pnpm test` 只编译
host，漏跑会让服务端继续分发旧 bundle；重建后运行中的 `dsh web` 经 client HMR 自动换版（boot graph
的 `rev` 变化），刷新页面即可。改 host 侧（`src/`）要先 `pnpm build`，再重启**承载插件的那个 host**
才生效——可能是 `dsh web`，也可能是桌面端的 dsh-desktop（其 host 监听
`127.0.0.1:19387`）；只看提交或构建
时间不能判定已生效，要对进程启动时间。

## 许可证

MIT © 2026 呼啸山庄 (P02-1010751281)，见 [LICENSE](./LICENSE)。

设置卡片、表单与 store 兼容层的模式改编自
[dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue)
（MIT，Copyright (c) 2025 HsiangNianian），相关源文件头保留了原署名。
