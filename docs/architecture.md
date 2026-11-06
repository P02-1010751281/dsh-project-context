# 架构、数据流与源码结构

[README](../README.md) 的细节版：会话如何变成存档与记忆、磁盘上每个文件的用途、源码目录结构。
面向改代码的人；只想知道怎么用的读者不需要它。

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
| ① 存档 | `project-context`（主入口，`/context`、`/session-log`） | 事件驱动（见 [behavior.md](./behavior.md) 的 ①）；`/session-log` | `session.jsonl`、`session.md`、`INDEX.md` |
| ② 整理 | `project-memory`（`/memory`、`/memory update`） | idle / disposed + 节流；命令 | `CONTEXT.md` + `MEMORY.md`（每轮注入） |
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

配置不在项目内：开关与参数写在**当前 profile 的设置 patch 文档**里（`project-context` 条目，
设置卡片编辑；dsh 0.1.7-rc.2 会把旧的 `~/.dsh/settings.yaml` 段一次性导入该文档，文件改名为
`settings.yaml.imported`）。dsh
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
│   ├── index.ts            #    插件入口：整理 pass 编排、/memory update、/memory 回执
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
client/                     # 设置卡片、字段表、zh/en 文案（bundle 进 lib/client.js）
scripts/
├── build-client.mjs        # 客户端 bundle
└── import-archives.mjs     # 回填 CLI（不依赖运行中的 dsh）
```
