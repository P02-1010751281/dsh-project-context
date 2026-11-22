# 收口版：两张表

时间已到，我未再运行任何新命令。以下内容全部来自本轮已执行的命令与文件读取；未测项标「未覆盖」并写明原因。三份文档共 **140 行**：`RULES.md` 33 行、`AGENTS.md` 79 行、`docs/architecture.md` 28 行。

运行期证据：`node --test 'test/**/*.test.mjs'` → exit 0，`ℹ tests 787 / pass 787 / fail 0`（9.4 s，只写 `/tmp`）；`pnpm typecheck` → exit 0。`pnpm build` / `pnpm test` 按委托禁止（写 `lib/`），未跑。

## A. RULES.md（33 行）

| # | 声称与位置 | 实测 | 一致或具体差异 |
|---|---|---|---|
| R1 | L3 三份引用：AGENTS.md / README.md / docs/README.md | 三文件均存在；RULES.md 6 个相对链接从仓库根全部 resolve | 一致 |
| R2 | L7 4 个 cordis 插件 + 1 张 web 卡片 | `ls -d src/*/` = 4 插件 + shared；`client/settings-card.tsx` 存在 | 一致 |
| R3 | L8 没有人工 review、没有 CI | `.github/`、`.gitlab-ci.yml` 均不存在 | 一致 |
| R4 | L10 基线取自 README / development.md / MEMORY.md / skills | 四者均存在 | 一致 |
| R5 | L14 2.1 判据 `git show --stat` 无 src/client/test | 唯一 `docs(rules)` 提交 80dd969 的 stat = `RULES.md \| 6 +++---` | 一致（样本仅 1 个） |
| R6 | L23 3.2 ≤900 行、判据无输出 | 同命令输出 2 行：`1242 src/project-memory/consolidate.ts`、`1246 src/project-memory/index.ts` | **不一致**：规则被现状违反 |
| R7 | L24 3.3 >400 行净增长须在 CHANGELOG 说明 | 未覆盖：仓库无逐批净增长台账，「本次」的基线未定义，无法判定 | 未覆盖 |
| R8 | L25 3.4 logic.test.mjs 是最大测试文件 | `wc -l test/*.mjs` 最大 = 6520 | 一致 |
| R9 | L26 3.5 新文档在 docs/README.md 登记 | `docs/batch-ac-settings-split-spec.md`、`docs/batch-z-six-problems-spec.md` 未出现 | **不一致** |
| R10 | L27 3.6 引用从仓库根 resolve | RULES.md 6 链接可 resolve；docs/architecture.md 用 `../README.md`、`./behavior.md` 从根 resolve 失败 | **不一致**（同仓文档违反） |
| R11 | L28 3.7 evidence 只新建、不回改 | `git log --diff-filter=M -- .agents/evidence`：6458173 把 `2026-11-21-batch-aa2-staleness/README.md` 36→57 行 | **不一致** |
| R12 | L32 4.1 4 插件 + shared | 5 个目录，恰为 4 插件 + shared | 一致 |
| R13 | L33 4.2 允许方向 + 判据 grep ≤1 | 判据 = 1（conversation.ts:9）✓；同一 grep 在 `src/` 给 13 条跨插件 import，含 `project-context → project-memory`（index.ts:22-23 等）与 `project-handoff → project-memory/project-context`（binding.ts:25-26）不在枚举内 | **不一致**：判据过、枚举缺项 |
| R14 | L34 4.3 `grep -c 'export const Config'` 仅 project-context 命中 1 | 1 / 0 / 0 / 0 | 一致 |
| R15 | L35 4.4 exports 恰好 7 个 key | `.`、`./cordis.patch.yml`、`./memory`、`./handoff`、`./autolearn`、`./client`、`./package.json` | 一致 |
| R16 | L36 4.5 shared 只放原语 | 22 个 .ts 为通用件；唯一跨插件引用已在 4.2 列为例外 | 一致 |
| R17 | L40 5.1 判据 grep 无输出 + typecheck | grep 无输出；typecheck exit=0 | 一致 |
| R18 | L42 5.3 命令处理器返回 `{kind,text}` | project-context 的 findReply/exportReply（83、100） | 一致 |
| R19 | L43 5.4 `logError` 永不抛、写前脱敏 | error-log.ts:65/77 调 `redactSecrets`；写盘 try/catch | 一致 |
| R20 | L44 5.5 枚举分支 `assertNever` | auto.ts:141 调用、:153 定义 | 一致 |
| R21 | L45 5.6 中文只在用户文案 | 19 个 src/.ts 含 CJK；注释中至少 paths.ts:183、missing-literals.ts:83、child.ts:43、sections.ts:352 | **不一致** |
| R22 | L49 6.1 三命令 exit 0、读 `ℹ tests` | typecheck exit=0 ✓；runner 直跑 exit=0、`ℹ tests 787` ✓；`pnpm build`/`pnpm test` | 未覆盖（禁止写 lib/） |
| R23 | L50 6.2 build 后 `git diff --exit-code -- lib` 为空 | 未覆盖：需跑 `pnpm build`（禁止）；当前 `git status --short lib` 干净不构成证据 | 未覆盖 |
| R24 | L52 6.4 card-render 是唯一真渲染 | card-render.test.mjs:253 用 `renderToStaticMarkup`；settings-form 只 import | 一致 |
| R25 | L53 6.5 测的是 `lib/` | logic.test.mjs:17-43 全从 `../lib/…` 导入 | 一致 |
| R26 | L54 6.6 裸 `node --test` 出幽灵用例 | /tmp 复现：裸目录 → 伪用例 `nt1/test` 失败；glob → pass 1 | 一致 |
| R27 | L58 7.1 `redactSecrets` 在 redact.ts | redact.ts:6 导出，error-log.ts:11 导入 | 一致 |
| R28 | L59 7.2 只有 writeAtomic/withMemoryLock | `grep 'writeFile('` 仅 files.ts:73 与 lock.ts:43/107 | 一致 |
| R29 | L60 7.3 辅助调用必须有超时 + 重试 + `maxOutputTokens` | 重试 ✓（consolidate.ts:411/416）、预算 ✓（:829）、超时 ✗（model-call/consolidate/gate/pass 均无 timeout） | **不一致** |
| R30 | L62 7.5 常量在 error-log.ts | 1_000_000 / 64_000 / 8_000 | 一致 |
| R31 | L70 8.4 判据是宿主进程启动时刻 | 未覆盖：规范项，仓库内无可判对象，需宿主进程现场 | 未覆盖 |
| R32 | L71 8.5 改名覆盖六个面 | 六个具名面均存在；「每个读者」集合 | 部分：六面一致，「每个读者」未覆盖（无权威清单） |
| R33 | L73 8.7 快照须标日期且能现读 | 标了 2026-11-21、5 条现读命令可执行；现读值与文档不符（见 A1） | 部分一致 |

## B. AGENTS.md（79 行）

| # | 声称与位置 | 实测 | 一致或
[...truncated...]
