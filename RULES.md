# RULES.md

> 本仓库的工程行为契约：结构边界与长期约束。事实导览在 [AGENTS.md](./AGENTS.md)，结构文档在
> [docs/architecture.md](./docs/architecture.md)，术语以 [docs/GLOSSARY.md](./docs/GLOSSARY.md) 为准。
> 规则与代码冲突时以本文件为准，并先按第 2 章改本文件。

## 1 概览与范围

- **项目**：dsh 插件包，含 4 个 cordis 插件与 1 张设置卡片，把会话蒸馏成项目级持久上下文（记忆 / 上下文 / 技能 / 交接）。
- **许可**：MIT（`LICENSE`）。
- **团队**：单人 + AI agent，无人工评审、无 CI；因此规则要给出判据命令或可核对对象，纯判断项标「软规则」并由评审核对。
- **范围**：`src/`、`client/`、`test/`、`docs/`、`.agents/` 与仓库根文档。不含用户的 `~/.dsh` 与各 profile（只读，改动由用户执行）。
- **基线来源**：文档分工在 [README.md](./README.md)，门禁在 [docs/development.md](./docs/development.md)，不变量在 `.agents/memory/MEMORY.md`，程序性技能在 `.agents/skills/`。

## 2 元规则

- **2.1 治理文档单独提交**：`docs(rules): …`，一次只动治理文档（`RULES.md`、`AGENTS.md`、`docs/architecture.md`、`docs/GLOSSARY.md`、`docs/README.md` 与 `CHANGELOG.md` 未发布登记）。判据：`git show --stat <commit>` 的路径列表只含上述治理文档，不含 `src/`、`client/`、`test/`、`lib/`、`README.md`、`.agents/`。
- **2.2 例外留档且带到期点**：在 `CHANGELOG.md` 的 `### 未发布` 写「违反哪条、为什么、何时复查」；对话里的例外不算。
- **2.3 废止走 2.1**，不得只在代码里事实上不用。
- **2.4 冲突先改规则**：规则与代码冲突时先按 2.1 单独提交规则，紧随的代码提交在消息里点名规则号；不得只改代码。
- **2.5 只写可判定规则**：每条规则给判据命令或可核对对象；只能用评审判断的，标「软规则」并写清核对什么。

## 3 文件与目录

- **3.1 命名与放置**：文件名 kebab-case；一个插件一个 `index.ts` 入口；测试按主题命名 `test/<subject>.test.mjs`。
- **3.2 单文件 ≤900 行**。2026-11-23 起没有超限文件：`src/project-memory/consolidate.ts` 从 1241 行拆到 617 行（提示词 → `prompt.ts`，回复解析与损失 → `reply.ts`，共享类型 → `consolidate-types.ts`），因此本节不再声明任何基线。判据：`node scripts/check-docs.mjs` 的 baseline 检查 exit 0（任何 >900 行的源文件都必须在这里声明，未声明即失败）。
- **3.3 大文件只减不增**：超过 400 行的文件若本提交净增长，须在 `CHANGELOG.md` 未发布说明为何不拆。
  判据：`git show --numstat <commit>`（未提交时 `git diff HEAD --numstat`）里该文件新增行数大于删除行数。
- **3.4 测试按主题分文件**：新主题新建 `test/<subject>.test.mjs`；`test/logic.test.mjs` 只收跨主题纯逻辑（软规则，评审核对放置）。
- **3.5 文档登记**：新文档进 `docs/` 并在 [docs/README.md](./docs/README.md) 索引登记；收口批次档案进 `docs/archive/`；发布正文进 `docs/changelog/v<version>.md`，`CHANGELOG.md` 只留「未发布 + 版本目录」。
- **3.6 引用写法**：Markdown 链接按文档自身目录解析（标准语义）；`path:line` 作为**证据引用**时写仓库相对路径并带符号名
  （术语表的模块锚点不受此限）。判据：`node scripts/check-docs.mjs` 的 link / anchor / symbol 检查 exit 0（链接按文档目录解析、锚点现读行存在、
  紧邻锚点声称的符号必须落在该行窗口内）。
- **3.7 证据冻结**：`.agents/evidence/` 只新建；已冻结证据里的测量错误，用新增 `errata.md` 更正并在原文件顶部加指针，不回改正文。

## 4 依赖与可见性

- **4.1 结构固定**：4 个插件（`project-context` / `project-memory` / `project-autolearn` / `project-handoff`）+ `src/shared/`
  + `src/host/`（宿主适配层）。新增插件或宿主接口须同时改 `cordis.patch.yml`、`package.json` 的 `exports`、
  `README.md` 与 `docs/architecture.md`。
- **4.2 依赖方向白名单**：只允许 [docs/architecture.md](./docs/architecture.md) 第 2 节表里列出的 import 边（8 条边、
  13 个不同 specifier、共 15 处；含 `shared → project-handoff/language` 与 `shared → project-handoff/conversation`
  这两条共享层例外）。判据：
  `node scripts/check-docs.mjs` 的 edges 检查 exit 0（把第 2 节表的 15 条 `文件:行` 与 13 个 specifier 跟 `src/` 逐条比对）。
- **4.3 设置命名空间按卡分片**：四个入口各自从 `src/shared/settings.ts` 导出自己那张卡的 `Config`（共用 / 记忆 / 技能 / 交接），只有 `src/project-context/index.ts` 发布共用值；功能入口在 `start.ts` 的 `currentConfig()` 里经 `withShared(livePluginConfig(…), effectiveSharedSettings(entry))` 合并共用值，放错卡的键由严格子集解析器抛 `config key … belongs to …`；每个 schema 字段必须带 `volatile`。判据：`grep -c 'export const Config' src/*/index.ts` 四个入口各命中 1；`grep -rn effectivePluginConfig src client` 为 0（`test/` 里只允许历史注释提及）。
- **4.4 公开面最小**：`exports` 只暴露 `.`、`./memory`、`./autolearn`、`./handoff`、`./client`、`./cordis.patch.yml`、`./package.json`；内部模块不得被外部导入。
- **4.5 shared 不持有插件专属逻辑（软规则）**：只放跨插件原语（配置、设置 schema、路径、锁、原子写、日志、生命周期）；评审核对新增模块是否被两个以上插件使用。
- **4.6 核心与宿主解耦**：只有 `src/host/<harness>/` 下的文件可以 import 宿主包（今天是 `src/host/dsh/`），
  `src/host/contract.ts` 是核心读到的公开面、不得命名宿主包；`ctx` 的服务读取一律走 `src/host/dsh/*`；
  事件、命令与提示词注册只在各插件 `index.ts` 经 `ctx.*` 发生，或在核心里经入口交来的
  `HostContext`（`host.on` / `host.registerCommand` / `host.addPromptContext`）发生；
  `hostContextOf(ctx)` 只在插件 `index.ts` 调用；已移植的核心 `src/<plugin>/start.ts` 只 name
  `HostContext` / `HostPorts`，不得 import 原生 `Context`；`src/host/` 不得反向依赖插件或 shared 模块。
  判据：`node scripts/check-boundary.mjs` exit 0。

## 5 代码风格与命名

- **5.1 ESM + NodeNext**：相对 import 带 `.js`，纯类型导入用 `import type`，host 侧不新增运行时依赖（唯一值依赖 `schemastery`，声明在 peer）；客户端只 import 宿主提供的
  `react` 与 `dsh-client-ui-primitives`（声明在 devDependencies，不打包）。判据：`grep -rnE 'from "\.{1,2}/[^"]*"' src/ | grep -vE '\.js"' | grep -vE '\.json"'` 无输出且 `pnpm typecheck` 通过。
- **5.2 命名**：函数 camelCase、类型 PascalCase、常量 UPPER_SNAKE；宿主服务用结构性 `*Like` 接口。
- **5.3 命令处理器不抛**：返回 `{ kind: "success" | "error", text }`；面向用户的文案跟随会话语言。
- **5.4 fire-and-forget 必须留痕**：`void … .catch(() => undefined)` 的异常先写 `errors.log`；`logError` 自身永不抛、写前脱敏。
- **5.5 枚举分支穷尽**：`switch` 覆盖联合类型全部成员，用返回类型或 `assertNever`
  （`src/project-handoff/auto.ts:153`）让新增成员编译失败；不得用 `default` 吞掉新成员。判据：`pnpm typecheck`。
- **5.6 注释写「为什么」（软规则）**：注释用英文；只有引用被讨论的中文字面量可用反引号括注（如 `` `记忆` ``）；
  中文正文只出现在面向用户的文案里；模型提示词一律英文。评审核对：注释写动机与被否决方案，不复述代码。

## 6 测试与门禁

> 本节是权威条文；逐条操作细节与产物纪律见 [docs/development.md](./docs/development.md)。

- **6.1 推送前三命令 exit 0**：`pnpm typecheck`、`pnpm build`、`pnpm test`（用例数读 `pnpm test` 的 `ℹ tests` 行，
  不写进本文件）；改动文档的提交另跑 `pnpm docs:check`，改动 `src/` 的提交另跑 `pnpm boundary:check`。
- **6.2 产物同步**：`pnpm build` 后 `git diff --exit-code -- lib` 为空；改过 `src/` 或 `client/` 的提交必须带重建的 `lib/`。
- **6.3 修复必须能反证**：新增行为有具名用例；修 bug 的用例必须能把修复改回后变红，并把变红用例（文件 + 用例名）
  与所做变异写进 `CHANGELOG.md` 未发布条目。
- **6.4 UI 必须真渲染**：客户端界面改动过 `test/card-render.test.mjs`（唯一真渲染）；源码字符串扫描不能当作 UI 已测。
- **6.5 测的是 `lib/`**：改过 `src/` 后先构建再测；单文件运行不能代替整轮 `pnpm test`。
- **6.6 不用无参数的 `node --test`**：它会扫 `test/fixtures/` 把夹具计成幽灵用例；用包脚本 `pnpm test`，
  或显式 glob `node --test 'test/**/*.test.mjs'`。
- **6.7 门禁三件套**：给可复制命令、写成功判据为退出码 0、并用已知失败样本实测非零（改反一条断言，该文件必须非零，见 `.agents/skills/dsh-plugin-mutation-round/SKILL.md`）。
- **6.8 不得掩盖失败**：禁用 `exit 0`、`|| true` 之类掩盖失败。

## 7 安全、性能与日志

- **7.1 不落敏感内容**：密钥、凭据、token 与提示词原文不进日志；错误先过 `redactSecrets`（`src/shared/redact.ts:6`），丢失只记字符数。
- **7.2 覆盖写只有两条路**：`writeAtomic`（`src/shared/files.ts:68`）与跨进程 `withMemoryLock`
  （`src/shared/lock.ts:213`）；append 只走各自有界通道（`errors.log`、`session.jsonl`、`purge.log`）；
  不得用裸 `writeFile` 覆盖受跟踪文档。
- **7.3 外部调用有界**：辅助模型调用必须有固定重试头寸，预算读 `maxOutputTokens`，不得在代码里另写上限；超时实现见第 11 章未决。
- **7.4 注入路径同步纯读（软规则）**：prompt 组装期间只允许缓存项目根 + 一次文件读，不 await、不起子进程或网络请求；
  评审核对新增注入 provider 的读取面。
- **7.5 日志有界**：截断、轮转、保留量都是 `src/shared/error-log.ts:14-20` 的常量；不得绕过 `logError` 直接 append。
- **7.6 热路径不加无界 I/O（软规则）**：`turn/end`、`step/start` 上新增读要估成本，并写进该批 `CHANGELOG.md` 条目。

## 8 提交与发布

- **8.1 提交信息**：英文 Conventional Commits，scope 常用；一次提交一件事；只 stage 本任务路径。
- **8.2 版本号与变更记录**：版本在 `package.json:3`；未发布写 `CHANGELOG.md` 的 `### 未发布`；发版时整段搬进
  `docs/changelog/<version>.md`、在 `CHANGELOG.md` 的 `## 版本目录` 加一行、并重开空节；已发布的 tag 绝不重写。
- **8.3 发布物**：没有 GitHub Releases；发布走 [.agents/skills/dsh-project-context-release/SKILL.md](./.agents/skills/dsh-project-context-release/SKILL.md)，并按该技能第 3 步跑全门禁。
- **8.4 分支**：单人仓库只用 `main`；不使用长期分支。

## 9 兼容与弃用

- **9.1 破坏性改名**：配置键、命令、字段的改名须在同一次提交覆盖六个面（`src/shared/config.ts`、`src/shared/settings.ts`、
  `client/card-fields.ts`、`client/locales.ts`、每个读取点与 `settingPatch` 写回键）加 `test/settings-form.test.mjs`
  的每键断言；同时给出两个 profile 的改法清单（由用户按 9.2 执行），不留兼容别名。
- **9.2 迁移顺序**：先改 profile（用户执行）再发布代码；旧代码遇到新键会 apply 失败，属预期。
- **9.3 检测命令**：判据同 4.3（`Config` 唯一导出）加 `pnpm typecheck`；键集合以 `src/shared/settings.ts` 为唯一来源。
- **9.4 弃用期**：无兼容读取器机制；破坏性变更不设别名，迁移路径写进 `CHANGELOG.md` 未发布。

## 10 禁令

- **10.1** 禁止手改 `lib/`：只由 `pnpm build` 生成（替代做法：改 `src/` 后重建）。
- **10.2** 禁止绕过插件写路径编辑 `.agents/memory/{MEMORY,CONTEXT}.md`（替代做法：走插件写路径，并用 `loadMemory` + `isMemoryTruncated` 复验）。
- **10.3** 禁止 `git add -A`（替代做法：只 stage 本任务的路径）。
- **10.4** 禁止在未验证时声称宿主改动已生效（唯一正确做法：按宿主进程启动时刻验收）。
- **10.5** 禁止改名只改一半（替代做法：按 9.1 六面清单一次改完）。
- **10.6** 禁止按评审文字直接改代码（替代做法：先用探针或 API 读数复现）。
- **10.7** 禁止把会漂的数字（端口、行数、字节数、用例数）当现状陈述（替代做法：写读取命令或量级；快照须标日期且可现读）。
- **10.8** 禁止未获批准的运行时干预（唯一正确做法：重启宿主与 `/memory update` 由用户执行）。

## 11 未决

- **7.3 的超时**：`src/shared/model-call.ts` 目前只透传 `signal`，没有插件内 timeout。需裁定「由宿主网关保证」还是插件自加 `AbortSignal.timeout`；2026-12-31 复查。
- **3.2 的超限文件（已清空，2026-11-23）**：`src/project-memory/index.ts` 2026-11-22 从 1236 行拆到 301 行（报告层 → `report.ts`，整理 pass → `update.ts`）；`src/project-memory/consolidate.ts` 2026-11-23 从 1241 行拆到 617 行（提示词 → `prompt.ts`，回复解析/损失 → `reply.ts`，共享类型 → `consolidate-types.ts`）。最大的源文件现为 801 行（`src/project-memory/report.ts`），全仓无 >900 行文件；2026-12-31 复核是否有新文件越线。
- **3.7 的历史回改**：`6458173`、`06a5d12`、`f0ac43e` 在规则冻结前改过 evidence 正文，已记入 `CHANGELOG.md`
  未发布例外、不再回改；2026-12-31 复核规则是否需要「冻结前豁免」的明文。
