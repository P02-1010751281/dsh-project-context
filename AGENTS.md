# Repository Guidelines

> 事实快照：2026-11-12。带计数的条目都是当天的快照，引用前现读（`git ls-files lib | wc -l`、`ls .agents/skills | wc -l`、`ls docs/changelog/*.md | wc -l`、`ls docs/archive/*.md | wc -l`、`pnpm test` 的 `ℹ tests` 行）。

## 项目概览

- 这是一个 **dsh（DeepSeek Harness）插件包**：一个 npm 包里并置 4 个 cordis 插件加 1 个浏览器设置卡片，共同做「项目级持久上下文」——会话归档 → 记忆整理 → 技能沉淀 → 上下文交接。
- 四个插件由 `cordis.patch.yml:8-16` 的 `insert` 层插进宿主，宿主里的 id 与包路径的映射是：`project-context` → `dsh-project-context`、`project-memory` → `dsh-project-context/memory`、`project-autolearn` → `…/autolearn`、`project-handoff` → `…/handoff`；`package.json:8-30` 是这些子路径的导出声明。
- 当前版本 `0.4.3`（`package.json:3`）。**没有 GitHub Releases**：未发布写在 `CHANGELOG.md` 的 `### 未发布`，已发布正文一个版本一份 `docs/changelog/v<version>.md`。
- 代码的 API 基线是 **dsh 0.1.7-rc.2**：devDependencies 精确钉在该版本（`package.json:80-107`），peer 下限写 `>=0.1.7-rc.2`（`package.json:108-116`）。本机跑的宿主会更新（2026-11-06 时为 0.2.2-rc.1），升级宿主前先读 `docs/harness/integration.md` 与 `dsh-runtime-line-delta-audit` 技能。
- ESM + NodeNext（`package.json:5`，`tsconfig.json:3-19`）；Node 要求 `^22.19.0 || >=24.0.0`（`package.json:77-79`）。host 半边对 `@deepseek-ai/*` 只做 type-only import，唯一的运行时值依赖是 `schemastery`（peer，`package.json:116`）。

## 架构与数据流

四个插件组成一条流水线：**① 归档 → ② 记忆整理 → ③ 技能沉淀 → ④ 交接**。段与段之间只通过 `.agents/memory/` 下的文件交接，没有跨插件的函数调用。

- 每个插件都是 `name` / `inject` / `apply(ctx, rawConfig)` 三个导出（`src/project-context/index.ts:56-66`、`src/project-memory/index.ts:437`、`src/project-autolearn/index.ts:65`、`src/project-handoff/index.ts:102`）；`rawConfig` 在每次 `apply` 时重新解析。
- 只有 `project-context` 导出 `Config`，并发布那一个设置命名空间（`src/project-context/index.ts:64`、`src/shared/settings.ts:97`）；其余三个用 `effectivePluginConfig(entry)` 读同一份配置（`src/shared/settings.ts:118`）。
- 事件面：① 在 `agent/created`（只暖缓存，不写盘）、`session/event` 的 `turn/end`、`agent/status = idle`、`agent/disposed`、`session/flush`、`session/disposed` 上工作（`src/project-context/index.ts:72-140`）；② 有两条 `systemPrompt.context` 注入（order 190/210、`interpolate: false`，`src/project-memory/index.ts:455-466`）；④ 有一条 `handoff-pressure` 注入（order 200，`src/project-handoff/index.ts:197-206`），它同时承载越线与「路由无法解析」两种状态。
- **`isTopLevel` 闸**：写盘的自动路径都先判会话不是 `origin: "subagent"`（`src/project-context/index.ts:107`、`:116`、`:122`；`src/project-handoff/index.ts:174`），否则每个子代理都会整理同一个 `MEMORY.md`、把自己也归档、并试图交接。显式命令（如 `/session-log write`）不受这道闸限制。
- 本包**不注册工具、不用 `tools/pre-execute`**：对模型暴露的唯一工具面是辅助调用的 `tools` 数组（`src/shared/model-call.ts:197`），`record_memory` 的定义在 `src/project-memory/sections.ts:636`。

### 代表性数据流：`/memory update`

1. 命令 → `consolidateProject(..., {force: true})`，回执由 `memoryUpdateReply` 渲染（`src/project-memory/index.ts:521-529`）。
2. 串行化 + 节流：同一项目根**单飞**（`src/project-memory/consolidate.ts:533-534`）、轮次/间隔节流（`:554`）、版本与 cap 去重（`src/project-memory/index.ts:420-422`、`src/project-memory/consolidate.ts:553-556`）。
3. 读入：`loadMemory(root, maxMemoryChars)` 折叠 journal、优先较新的 render；上下文那半边读会话绑定的 `tasks/<slug>.md`，未绑定则读 `CONTEXT.md`，先被 `MAX_CONTEXT_CHARS`（32000）截；两份再经 `fitMemoryInput` 按输出预算裁一次（`src/shared/conversation.ts`）。
4. 模型调用：固定规则 + 每次的预算规则 + `<existing-memory>` / `<existing-context>` / `<recent-conversation>`（`src/project-memory/consolidate.ts:580-601`）→ `requestPluginTextWithMeta`（`src/shared/model-call.ts:180`）→ `ctx.llm.stream`（`:207`）；`tools` 参数被拒时换一次无工具重试（`:288`）。
5. 解析回复：优先 `record_memory` 工具调用，其次四节 Markdown，最后是不透明文本（`src/project-memory/consolidate.ts:373`）；部分文档先过 `applyPartialGuard`（`:457`）。
6. **有损闸（tier C）**：会丢整条目的回复先做一次定向重试，仍丢就整次拒绝、一个字节都不写（`src/project-memory/consolidate.ts:691-734`）。
7. 渲染：`renderMemoryDocument` 只在文档到 cap 时才丢整条目，并返回 `sectionDropped` / `droppedItems` / `itemTruncated`（`src/project-memory/sections.ts:173`）。
8. 落盘：`withMemoryLock`（`src/shared/lock.ts:213`）→ 备份（`src/project-memory/backup.ts:33`）→ `recordMemoryDocument`（`src/project-memory/record.ts:97`：采纳外部编辑 `:110`、基线变了就拒绝 `:116-119`、追加 journal `:136`、`writeAtomic` `:139`）→ `CONTEXT.md`（`src/project-memory/index.ts:349-351`）。
9. 回执：只报真正落地的那部分（`src/project-memory/index.ts:313-328`、`:391-416`）；每次拒绝或裁剪另写一行到 `errors.log`。

### 对照：交接（④）

- 触发面更窄：只有 `turn/end` 评估交接（`src/project-handoff/index.ts:208-232`），`step/start` 只重算压力线（`:224`）。
- **不调模型、不写 journal**：尾料与文件索引来自 `handoffSplit`（`src/project-handoff/conversation.ts:527`），产物由 `handoffArtifacts` 组装（`src/project-handoff/perform.ts:34`）。
- 写序是反的：先记录子会话的 `parentId`/`task`（`src/project-handoff/perform.ts:163`）再创建并播种新会话（`src/project-handoff/perform.ts:151`，走 `followup(pluginUserMessage(...))` 而不是 `controller.prompt`，`src/project-handoff/perform.ts:189`），最后才写 `HANDOFF.md`（`src/project-handoff/perform.ts:196`）；中途失败先取回绑定、再用 `abandonChild` 撤销（`src/project-handoff/perform.ts:201`）。
- 触发状态全在进程内存（`src/project-handoff/state.ts:13-50`），不落盘；宿主重启后重新计数。

## 关键目录

| 路径 | 是什么 |
|---|---|
| `src/project-context/` | ① 会话归档 + `session-logs/INDEX.md`，无模型调用；`/session-log tree` 把 `meta.json` 的 `parentId` 读成缩进树（`src/project-context/session-tree.ts`）；入口 `src/project-context/index.ts:56-66` |
| `src/project-memory/` | ② 整理成 `MEMORY.md` / `CONTEXT.md`（绑定了任务的会话写 `tasks/<slug>.md`）并每轮注入；状态派生与绑定在 `src/project-memory/tasks.ts`；`turn/end` 把 todo 未完成项机械写进 Open tasks（`src/project-memory/todo.ts`）；清洗通道（tar → 删 → `purge.log`）在 `src/project-memory/prune.ts`；入口 `src/project-memory/index.ts` 的 `apply` |
| `src/project-autolearn/` | ③ 低频把材料沉淀成项目技能；入口 `src/project-autolearn/index.ts:65` |
| `src/project-handoff/` | ④ 上下文越线时交接进新会话；路由无法解析的失败在 `src/project-handoff/route-failure.ts` 具名并进注入行；入口 `src/project-handoff/index.ts:102`（本包最大的一支） |
| `src/shared/` | 四个插件共用：配置、设置 schema、项目根/路径、跨进程锁、原子写、生命周期 helper |
| `client/` | 浏览器半边 5 个文件；`client/card-fields.ts` 是设置卡字段表的唯一来源，`client/styles.ts` 是纯几何样式 |
| `lib/` | **入库的构建产物**（161 个受跟踪文件）：tsc 的 `*.js`/`*.d.ts` 加 esbuild 的 `client.js` |
| `test/` | 40 个 `.mjs`：39 个 `*.test.mjs`（被包脚本的 glob 选中）+ 1 个共享 fixture helper（`session-views.mjs`），另有 `fixtures/projection-typing/` 3 个夹具文件，见「测试与 QA」 |
| `docs/` | 索引是 `docs/README.md`；机制文档 4 篇；`docs/changelog/`（8 个版本）；`docs/archive/`（18 个收口批次档案） |
| `scripts/` | `build-client.mjs`（唯一产出 `lib/client.js` 的地方）、`import-archives.mjs`（回填历史会话） |
| `.agents/` | `memory/`（MEMORY.md、CONTEXT.md、`tasks/<slug>.md`、`purge.log`、`trash/` 与本地状态）、`skills/`（35 个程序性技能，含手写的入口技能）、`evidence/`（冻结证据） |

## 开发命令

```bash
pnpm typecheck     # host + client 两半都 --noEmit（package.json:55）
pnpm build         # tsc → lib/**/*.js|d.ts，再 esbuild → lib/client.js（package.json:53）
pnpm test          # tsc 后再跑 node --test 'test/**/*.test.mjs'（package.json:56）
pnpm build:client  # 只重建 lib/client.js（package.json:54）
```

- **`pnpm test` 不会重建 `lib/client.js`**：它只 `tsc` 出 host 半边。改过 `client/` 必须 `pnpm build`（或 `build:client`），否则服务端继续分发旧 bundle（`docs/development.md`）。
- 改 `src/` 或 `client/` 的提交必须带重建的 `lib/`；`pnpm build` 是确定性的——构建后 `git diff --exit-code -- lib` 必须为空。
- **没有 CI**：`.github/`、`.gitlab-ci.yml` 都不存在，没人替你在推送时跑门禁。合并/推送前手工跑上面三条，发布时再按发布技能的第 3 步跑一遍。
- Node 在 Nix store 里且每次重建都轮换：现读 `node -v`，脚本找不到 node 时用 `PATH="$(dirname "$(command -v node)"):$PATH" pnpm build`，不要把 store 路径写进脚本或文档。
- `node --test test/`（裸目录）会跑出一个名为 `test` 的伪用例然后失败——用包脚本，永远别手拼 runner。
- `pnpm-workspace.yaml` 不是 workspace 列表：它只批准 esbuild 的 build script、给 `@deepseek-ai/dsh-*@0.1.7-rc.2` 预发行包开 release-age 例外，并设 `verifyDepsBeforeRun: false`。

## 代码约定与模式

- **模块风格**：ESM + NodeNext；相对 import 一律带 `.js`；类型导入用 `import type`；`import type {} from "@deepseek-ai/dsh-commands"` 这种空导入用来拉 Context 合并而不引运行时依赖（`src/project-context/index.ts:15`）。
- **命名**：文件 kebab-case；一个包一个 `index.ts` 作为插件模块；函数 camelCase、类型 PascalCase、常量 UPPER_SNAKE（`src/shared/limits.ts:7`、`:12`、`:14`）。
- **大核旁边放窄模块**：一份义务一个小文件，别往大文件里塞——`src/project-memory/consolidate.ts` 809 行、`src/project-memory/sections.ts` 677 行，而 `src/project-handoff/measure.ts` 27 行、`src/project-handoff/state.ts` 50 行。
- **命令处理器不抛**：返回 `{kind: "success" | "error", text}`（`src/project-context/index.ts:146-159`）。
- **fire-and-forget**：`void … .catch(() => undefined)`，但吞掉的异常必须进 `errors.log`，且写日志的函数自己永不抛（`src/shared/error-log.ts:57`）。
- **状态归属**：持久状态只在文件里，布局写在 `src/shared/project-state.ts:3-12` 的注释块；其余都在进程内存（每会话 tracker、每项目根 map、交接触发状态），宿主重启即失效。
- **读上游服务**：`inject` 声明过的用 `ctx.x`；未声明的用 `ctx.get("x")`，它返回 `undefined` 而不是抛——handoff 在 `inject` 里声明 `llm`（`src/project-handoff/index.ts:94`），自动路径失败写一行 `warn`（`:138`）并记录断掉的路由（`:131`），只有可选能力才静默降级。
- **对称的失败处理**：枚举分支用 `assertNever` 收尾（`src/project-handoff/auto.ts:141`、`:153`）；抛出的错误保留 harness 的 `code`（`src/shared/model-call.ts:240`）。
- **注释规则**：JSDoc 与行内注释用英文，写「为什么」和被否决的替代方案；中文只出现在面向用户的文案里（`src/project-handoff/language.ts:158`、`src/shared/setting-labels.ts`）。模型提示词一律英文。

## 重要文件

- 配置唯一来源是 `src/shared/config.ts`（接口 + 默认值 + 校验）；设置 schema 在 `src/shared/settings.ts`，**每个字段必须带 `volatile` 标记**，否则整张设置卡会无错误、无日志地消失。
- 设置卡片不手写控件：字段表 `client/card-fields.ts` 是 spec / 投影 / 渲染行三者共同的来源，控件与保存语义都来自平台的 `SettingsForm`。
- 记忆的 schema 只在 `src/project-memory/memory-schema.ts`（四节 + 预算），上下文渲染只在 `src/project-memory/context-doc.ts`；不要把它们的数字抄进别处。
- 交接的判定核心是 `src/project-handoff/decide.ts`（纯函数），`auto.ts` 是适配器；两者的缝由 `docs/batch-w-decision-seam-spec.md` 规定，那份规格仍被 `src/` 与测试引用，所以它留在 `docs/` 而不是 `docs/archive/`。
- 文档入口：`docs/README.md`（索引与引用规则）、`docs/development.md`（门禁与依赖边界）、`docs/harness/integration.md`（各宿主接口的采用决定）。
- 发布流程的权威是 `.agents/skills/dsh-project-context-release/SKILL.md`，不是记忆里的转述。

## 运行时 / 工具偏好

- 本机通过两个 dsh profile 以 `link:` 方式安装本包：**host 侧改动**要重启承载宿主的进程，并按进程的**启动时刻**判定生效，不能只看提交时间或构建时间；**客户端改动**在 `pnpm build` 后一次硬刷新即可（宿主挂着 client-hmr，轮询 bundle 的 `rev`）。
- GUI 端口每次重启都变（2026-11-06 时为 38961）：探针必须现读端口，不要相信文档里写死的旧端口。
- 宿主派发的 bundle 比磁盘 `lib/client.js` 多一行 `//# sourceMappingURL=…` 尾部（实测 76 字节），字节比对要按前缀比，否则会把「已生效」误判成「未生效」。
- **不要手改 `lib/`**：从 `src/` 还原不会还原 `lib/`，每轮结束都要重建到 0 个变异体残留。
- `.agents/memory/MEMORY.md` 与 `CONTEXT.md` **只能走插件的写路径**：手工编辑会绕过预算与去重，下一次插件写入会把超出的部分静默丢掉；写入后必须用 `loadMemory` + `isMemoryTruncated` 复验，而不是 grep 截断标记。
- 提交用英文 Conventional Commits（近 150 条实测：`docs` 114、`fix` 24、`feat` 4、`chore` 4、`test` 2、`refactor` 2），带 scope 很常见。多会话并发时只 `git add` 本任务的路径，永不 `git add -A`。

## 测试与 QA

- 规模：`test/` 40 个 `.mjs`（39 个 `*.test.mjs`）加 3 个夹具文件共 18,018 行，注册 **617** 个用例；`test/session-views.mjs` 只是共享 fixture helper，`test/fixtures/` 放类型夹具。数量会变，判据是现跑 `pnpm test` 读 exit code 与行数。
- 运行器是内置 `node:test`：`import test from "node:test"`，没有 `describe`/`it`/`vitest`。包脚本的 glob 是单引号包起来的 `'test/**/*.test.mjs'`（`package.json:56`），只选测试文件——裸 `node --test` 会把 fixture 也算成一个永远绿的幽灵用例。
- **测试跑的是编译后的 `lib/`，不是 `src/`**（`test/logic.test.mjs:17-40` 从 `../lib/…` 导入）：`pnpm test` 先 `tsc`，所以类型错误会在任何用例报告之前终止整轮；忘了构建就测到旧产物。
- 单文件跑 `node --test test/handoff-relabel.test.mjs` 会绕过 `tsc` 前缀，改过 `src/` 时先 `pnpm build`。
- stdout 不是 TTY 时 node 打印 TAP（`# pass N`）而不是 `ℹ pass`：**看退出码**，不要 grep reporter 字样。
- 真实接线 vs 文本扫描：`top-level-gate.test.mjs` 每个用例把插件真 `apply()` 两次（子会话不干活 / 顶层干同样的活，正控制就在同一用例里）；`handoff-relabel`、`literal-injection`、`autolearn`、`logic` 也各有真 `apply` 的接线用例。另一半是纯函数测试与**源码字符串扫描**（`config-vocabulary`、`client-inject`、`client-styles`、`project-root`）——扫描只能证明某个字符串不在，不能证明控件进了 DOM。
- `test/card-render.test.mjs` 是唯一**真正渲染**卡片的测试：用 esbuild 把 `client/settings-card.tsx` 和平台的 `SettingsForm`/`Switch`/`Pill` 打成一个包，写进 `mkdtemp` 再 import，按字段表断言「每行各一次、布尔是开关、枚举每选项一个胶囊、整页只有一个保存控件」。它必须自带 `react`/`react-dom`/`clsx`/`zustand`/`immer`，并给平台 mega-index 的未声明依赖（shiki/katex/micromark/simple-icons）做惰性 passthrough。
- `test/settings-form.test.mjs` 不落盘：esbuild `write: false` 后从 `data:text/javascript;base64,…` 直接 import。
- `test/projection-typing.test.mjs` 把 `tsc` 当判官：一对正/负夹具，要求恰好一条诊断，且落在那个近似拼错的键上。
- 值得知道的夹具技巧：几乎所有用例在 `mkdtemp` 里建临时项目；跨进程锁用 4 个真子进程 + barrier 文件（`test/logic.test.mjs:399`，60 s 预算）；FIFO 守卫 15 s 且 `mkfifo` 不可用时 `t.skip`；`session.jsonl` 的追加路径会验证「外部改写后重建、并把更长的外来字节存成 `session.jsonl.broken-*`」。
- 曾经的噪声，已定性并修掉：`test/context-injection.test.mjs` 读仓库自己的 `.agents/memory/MEMORY.md` / `CONTEXT.md`；历史红是「按子串数指针」把散文里引用的 `` `## Summary` `` 当成第二条指针（2026-10-06 实测），`e61b481` 改成整行计数并加了一条引用用例。2026-11-12 复核：100 次单文件运行、12 次在并发原子改写（临时文件 + `rename`）下运行、5 次全量套件全绿。残留两种红法：某条条目行本身从行首写 `` - `## <heading>` ``（会被数成指针），或外部非原子改写把文件截断——插件的写路径是原子 rename，不会触发。
- **没有覆盖率工具、没有 CI**：devDependencies 里没有 c8/nyc/istanbul，仓库里没有 `--experimental-test-coverage`，也没有 `.github/`。门禁就是手工跑 `pnpm typecheck` / `pnpm build` / `pnpm test` 三条。
