# RULES.md

> 本文件是本仓库的工程行为契约：结构、边界与长期约束。仓库事实导览在 [AGENTS.md](./AGENTS.md)，用户手册在 [README.md](./README.md)，机制说明在 [`docs/`](./docs/README.md)。规则与代码冲突时以本文件为准，并先按第 2 章改本文件。

## 1 概览与范围

- **项目**：dsh 插件包（4 个 cordis 插件 + 1 张 web 设置卡片），目标是把 dsh 会话蒸馏成项目级持久上下文（记忆 / 上下文 / 技能 / 交接），并保证在真实宿主里可验证地生效。
- **团队**：单人 + AI agent，没有人工 code review，也没有 CI。因此每条规则必须机器可判、或能用一个命令复核；依赖"有人会看"的规则不写进本篇。
- **范围**：`src/`、`client/`、`test/`、`docs/`、`.agents/`、仓库根文档。不覆盖用户的 `~/.dsh` 与两个 profile（只读；改动由用户执行）。
- **基线来源**：本仓库没有 `CLAUDE.md`；AI 协作基线取自 [README.md](./README.md) 的文档分工、[docs/development.md](./docs/development.md) 的门禁、`.agents/memory/MEMORY.md` 的不变量与 `.agents/skills/` 里的程序性技能。

## 2 元规则（制定 / 修改 / 废止）

- **2.1 改规则必须单独提交**：`docs(rules): …`，同一次提交只动 `RULES.md`（可附带 CHANGELOG 未发布登记）。判据：`git show --stat <commit>` 的路径列表里没有 `src/`、`client/`、`test/`。
- **2.2 例外必须留档且带到期点**：在 `CHANGELOG.md` 的 `### 未发布` 写出「违反哪条、为什么、何时复查」；对话里达成的例外不算。
- **2.3 废止规则同样走 2.1**：不得只在代码里"事实上不用了"。
- **2.4 冲突先改规则**：代码与规则必须同时改时，在提交消息里点名冲突的规则号。
- **2.5 只写可判定的规则**：一条规则若无法用命令或单一读数判定，改写成评审清单项并显式标注为软规则。

## 3 文件与目录约定

- **3.1 命名与放置**：文件名 kebab-case；一个插件包一个 `index.ts` 作入口；测试按主题命名 `test/<subject>.test.mjs`。
- **3.2 单文件行数上限**：`src/` 与 `client/` 每个文件 ≤ 900 行。判据：`wc -l src/*/*.ts client/*.ts* | awk '$1>900 && $2!="total"'` 无输出。
- **3.3 大文件只减不增（软规则）**：已超过 400 行的文件，若本次净增长，必须在 CHANGELOG 里说明为何不拆分；新增逻辑优先落到新文件。
- **3.4 测试不写成大杂烩**：新主题新建 `<subject>.test.mjs`；`test/logic.test.mjs`（已近 6000 行）只收跨主题的纯逻辑夹具。
- **3.5 文档登记**：新文档进 `docs/` 并在 [`docs/README.md`](./docs/README.md) 索引里登记；收口批次的决策档案进 `docs/archive/`；已发布版本正文进 `docs/changelog/v<version>.md`，`CHANGELOG.md` 只留「未发布 + 版本目录」。
- **3.6 引用写仓库相对路径**：跨文件引用写 `docs/...`，不写本文件相对路径。判据：链接目标从仓库根 resolve 得到。
- **3.7 `.agents/evidence/` 冻结**：只新建、不回改，包括其中的历史路径。

## 4 子包与模块边界

- **4.1 结构固定**：4 个插件（`project-context` / `project-memory` / `project-autolearn` / `project-handoff`）+ `src/shared/`。新增插件必须同时改 `cordis.patch.yml`、`package.json` 的 `exports` 与 README。
- **4.2 依赖方向**：跨插件 import 只允许现存方向（`project-autolearn → project-memory`、`project-autolearn → project-context`、`project-context → project-handoff`），以及 `shared → project-handoff/language` 这一处例外；不得新增反向依赖。判据：`grep -rn 'from "\.\./project-' src/shared/ | wc -l` 保持 ≤ 1。
- **4.3 设置只有一个命名空间**：只有 `src/project-context/index.ts` 导出 `Config` 并发布 schema，其余三个用 `effectivePluginConfig(entry)` 读；每个 schema 字段必须带 `volatile` 标记，否则整张卡会无声消失。判据：`grep -c 'export const Config' src/*/index.ts` 只在 `project-context` 命中 1。
- **4.4 公开面最小**：包 `exports` 只暴露四个插件入口、`./client`、`cordis.patch.yml` 与 `package.json`；内部模块不得被外部路径导入。
- **4.5 shared 不持有插件专属逻辑**：只放跨插件共用的原语（配置、设置 schema、路径、跨进程锁、原子写、日志、生命周期）。

## 5 代码风格与命名

- **5.1 ESM + NodeNext**：相对 import 必须带 `.js`，纯类型导入用 `import type`；不新增运行时依赖（唯一值依赖 `schemastery`，声明在 peer）。判据：`grep -rnE 'from "\.{1,2}/[^"]*"' src/ | grep -vE '\.js"' | grep -vE '\.json"'` 无输出，且 `pnpm typecheck` 通过。
- **5.2 命名**：函数 camelCase、类型 PascalCase、常量 UPPER_SNAKE；宿主服务用结构性 `*Like` 接口描述，不复制上游类型。
- **5.3 命令处理器不抛**：返回 `{ kind: "success" | "error", text }`；面向用户的文案跟随会话语言。
- **5.4 fire-and-forget 必须留痕**：`void … .catch(() => undefined)` 的异常先写 `errors.log`；`logError` 自身永不抛、写前脱敏。
- **5.5 枚举分支用 `assertNever` 收尾**：新增分支必须让 `tsc` 报错，而不是静默落空。
- **5.6 注释写"为什么"**：JSDoc/行内注释用英文，记录被否决的方案；中文只出现在面向用户的文案里；模型提示词一律英文。

## 6 测试与质量门禁

- **6.1 推送前三命令 exit 0**：`pnpm typecheck`、`pnpm build`、`pnpm test`（用例数每次现读，当前 492）。
- **6.2 产物必须同步**：`pnpm build` 后 `git diff --exit-code -- lib` 为空；改过 `src/` 或 `client/` 的提交必须带重建的 `lib/`。
- **6.3 修复必须能反证**：新增行为要有具名用例；修 bug 的用例必须能把修复改回后变红（变异验证），并记录变红的用例名。
- **6.4 UI 必须真渲染**：客户端界面改动要过 `test/card-render.test.mjs`（唯一真渲染）；源码字符串扫描只能证明"某字符串不在"，不能当作 UI 已测。
- **6.5 测的是 `lib/`**：改过 `src/` 后先构建再测；单文件运行的结果不能代替整轮 `pnpm test` 宣称通过。
- **6.6 不用裸 `node --test`**：会把 fixture 计成幽灵用例；用包脚本。

## 7 安全、性能与日志硬规则

- **7.1 不落敏感内容**：密钥、凭据、token 与提示词原文不进日志；所有错误先过 `redactSecrets`（`src/shared/redact.ts`），丢失只记字符数。
- **7.2 写盘只有两条路**：`writeAtomic`（临时文件 + rename）与跨进程的 `withMemoryLock`；不得用裸 `writeFile` 覆盖受跟踪文档。
- **7.3 外部调用有界**：辅助模型调用必须有超时、固定重试头寸，预算读配置（`maxOutputTokens`），不得在代码里另写一个上限。
- **7.4 注入路径保持同步纯读**：prompt 组装期间只允许缓存项目根 + 一次文件读，不得 await、不得起子进程或网络请求。
- **7.5 日志自身有界**：截断、轮转、保留量都是 `src/shared/error-log.ts` 里的常量；不得绕过 `logError` 直接 append。
- **7.6 热路径不加无界 I/O**：`turn/end`、`step/start` 上新增读操作要估算成本，并写进该批 CHANGELOG 条目。

## 8 禁令

- **8.1** 禁止手改 `lib/`：它只由 `pnpm build` 生成，从 `src/` 还原不会还原它。
- **8.2** 禁止绕过插件写路径编辑 `.agents/memory/{MEMORY,CONTEXT}.md`；确需手改时用 `loadMemory` + `isMemoryTruncated` 复验，不要 grep 标记。
- **8.3** 禁止 `git add -A`：多会话可能并发编辑本仓库，只 stage 本任务的路径。
- **8.4** 禁止在未验证时声称 host 改动已生效：判据是承载宿主的进程启动时刻，不是提交或构建时间。
- **8.5** 禁止改名只改一半：配置键、命令、字段的改名都是破坏性的，必须在同一次提交里覆盖全部六个面（config / settings / card-fields / locales / 每个读者 / `settingPatch` 写回）并同步两个 profile；不留兼容别名。
- **8.6** 禁止按 review 文字直接改代码：先复现（探针或 API 读数），再修。
- **8.7** 禁止把会漂的数字写进文档（端口、行数、字节数、用例数）：写读取命令或量级。
- **8.8** 禁止未获批准的运行时干预：重启宿主与 `/memory update` 是用户动作。
