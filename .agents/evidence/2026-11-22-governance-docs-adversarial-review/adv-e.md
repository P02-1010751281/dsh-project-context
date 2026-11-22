**结论：12 条修复中 8 条成立、3 条仍不精确、1 条不成立（§11「唯一自动改写」与代码相反）。全程只读，`git status` 与开始时逐行一致；未跑 `pnpm build`/`pnpm test`（会写 `lib/`），运行期行为未验。**

## 一、逐条验证

| # | 结论 | 证据 / 缺口 |
|---|---|---|
| 1 | 成立 | `RULES.md:17` 集合含 RULES/AGENTS/architecture/GLOSSARY/docs-README + CHANGELOG 未发布；`RULES.md:20` 2.4 已改为「规则单独提交、代码提交点名规则号」。判据缺口见 F5 |
| 2 | 成立 | `RULES.md:31-32` 判据两分句齐备。按文档自身目录解析全部 40 条链接：0 失败；全部 `path:line`：0 个文件缺失/行号越界。判据只查行存在，未查符号名（F6） |
| 3 | 成立 | `RULES.md:66-67`。node 二进制内嵌 `kPatterns = ['test','test/**/*','test-*','*[._-]test']`，`test/**/*` 会收 `fixtures/` 下文件；`fixtures/` 只有 `.ts/.json`，`test/session-views.mjs`、`test/context-fixtures.mjs` 同样会被收集——理由不穷尽，但方向成立 |
| 4 | 成立 | `RULES.md:91-93` 六面可数（config/settings/card-fields/locales/每个读取点/settingPatch 写回键），test 断言为附加，profile 清单由用户按 9.2 执行 |
| 5 | 成立 | `RULES.md:11,21` 已改；软规则恰为 `3.4(:29)`、`4.5(:44)`、`7.4(:76)`、`7.6(:78)`；`3.3(:27-28)` 判据改为 numstat（缺陷见 F4） |
| 6 | 成立 | `architecture.md:26-28,38` 唯一例外；`grep -rn 'from "\.\./project-' src/shared/` 仅 `conversation.ts:9`；`RULES.md:39` 点名同一例外 |
| 7 | **仍不精确** | `GLOSSARY.md:21` 条目锚点是 `retirement.ts:61（id 派生）`，**未写 `entryTid`**（该行正是 `export function entryTid`）；整理 `:23`、交接 `:27`、墓碑 `:37` 已带符号名；权威行 `:41` 已把 `INDEX.md` 移出事实源、仅留作派生投影 |
| 8 | 成立 | `RULES.md:111/112/114` 三项均带 `2026-12-31` |
| 9 | 成立 | `docs/README.md:66-67`；全链接按本文档目录解析 0 失败，无 `docs/...` 根相对写法 |
| 10 | **仍不精确** | `RULES.md:38-41` 与 `architecture.md:28-38` 都写 7 边/12 specifier/14 处，但表只有「边 + file:line」，**没有 specifier 字符串集合**，无法逐条比对；判据只能对计数（反例见 F3） |
| 11 | **不成立** | 8.2(`:84-86`)、9.3(`:95`)、§12(`:142`)、§8(`:91-95` 五个条目) 成立；但 §11「唯一自动改写」被代码推翻： |

```
$ grep -n 'reconcileSessionIndexOnce' src/project-context/index.ts
26:import { reconcileSessionIndexOnce, ... }
152:				await reconcileSessionIndexOnce(projectRoot);   # 注释 143-145: "it rewrites `INDEX.md`"
$ grep -n 'retireWithinBudget' src/project-memory/consolidate.ts
810:			plan = await retireWithinBudget(storedSectionsForPlan, ...)
$ grep -n 'retiresEntry' src/project-memory/retirement.ts
479:				if (!retiresEntry(entryStateOf(tid, facts).state)) continue;
```

`agent/created` 启动路径自动重写 `INDEX.md`，整理 pass 按条目状态自动把条目移出 `MEMORY.md`——两处都是「改写文件来消除不一致」。

| 12 | **仍不精确** | `RULES.md:62-63` 与 `architecture.md:134-136` 成立（`entry-state.ts:38` 的 `NON_RETIRING_STATES` 实测在 38 行；`grep SEVERITY src/` 只有 session/skill 两处）；但 `CHANGELOG.md:44` 只给「用例在 `test/memory-loss-repair.test.mjs` + 10 个变异名」，**没写用例名**：`grep -n '退休 id 过滤器失效' test/memory-loss-repair.test.mjs` 无命中，真实用例名是英文长句（如 `an entry batch Z2 retired is a replacement, not a loss`） |

## 二、新发现

| # | 位置 | 问题与证据 |
|---|---|---|
| F1 | `RULES.md:48` | 绝对断言「唯一值依赖 `schemastery`，声明在 peer」不成立：`lib/client.js` 实际 `require("react")`、`require("react/jsx-runtime")`、`require("@deepseek-ai/dsh-client-ui-primitives")`；`package.json:108-117` 的 peer 只有 cordis/dsh/schemastery，react 与 ui-primitives 只在 devDependencies（`client/settings-card.tsx:29` 直接 import react） |
| F2 | `architecture.md:134-137` | 「三套…没有改写文件来消除不一致的通道／唯一自动改写是技能 `expired` 移出」与同句的 `retiresEntry`、`index.ts:152`、`consolidate.ts:810` 矛盾（高） |
| F3 | `RULES.md:38-41` vs `architecture.md:28-38` | 同一依赖事实两处正文（rules-doc 冲突审计 #2 错层、#7 重复定义，且 rules-doc 要求依赖方向「只写违反时的检查命令」）。判据也抓不到其自称的失败：把 `src/project-autolearn/pass.ts:16` 的 `../project-memory/memory-store.js` 移到 `src/shared/conversation.ts` 后 grep 输出仍 12 行/14 处，却新增白名单外的 `shared → project-memory` 边（高） |
| F4 | `RULES.md:27-28` | `git diff --numstat` 只比索引↔工作树：已暂存的净增不可见；提交后输出为空，「本提交净增长」永久无法复核（应 `git diff HEAD --numstat` 或 `git show --numstat`） |
| F5 | `RULES.md:17` | 判据只排除 `src/`、`client/`、`test/`：动 `docs/behavior.md`（`test -e` 成立）、根 `README.md` 或 `lib/` 仍判通过，与「一次只动治理文档」不对应 |
| F6 | `AGENTS.md:40` vs `RULES.md:31-32` | 同一引用规则两种说法：AGENTS 无条件「`path:line` 必须带符号名」，RULES 只限证据引用且豁免术语锚点；AGENTS 自身 `:13` 的 `package.json:8-30`、`cordis.patch.yml:8-16` 就无符号名 |
| F7 | `RULES.md:54` | 53 条逐条清点：4 条已标软规则；其余 48 条有命令或可核对对象；**`5.6` 既无判据也未标软**（「注释写为什么」纯判断）。`5.2` 的 `*Like`、`7.1` 的「不进日志」有对象、无判据语句，属边缘 |
| F8 | `CHANGELOG.md:44` | 违反 `RULES.md:62-63` 与 `AGENTS.md:34` 的「用例名」要求（同验证 12） |
| F9 | `GLOSSARY.md:21` | 条目锚点未写 `entryTid`，与声称的改法不符（低危，3.6 豁免术语锚点） |
| F10 | `docs/README.md:19`（旁及，指定段之外） | 「会话日志七态」「`pnpm test` 756」与 `architecture.md:130` 的 8 态（`session-state.ts:27` 实为 `live/settled/stale/orphan/missing/abandoned/dangling/unbaselined`）及现读 787 不符；属状态集合与计数两种说法 |
| F11 | `RULES.md:74` | 「写盘只有两条路」与 `appendFile` 反例冲突：`src/project-context/session-log.ts:194/234`、`src/shared/error-log.ts:79`、`src/project-memory/prune.ts:294`；条文实际只禁裸 `writeFile` 覆盖（低危） |

## 三、11 章结构 / 禁令 / 未决

- 章节 1–11 与 rules-doc 固定顺序一致，无跳节；§10 禁令 8 条均带「替代做法」或「唯一正确做法」，符合误伤检查。
- §11 三项未决均有 `2026-12-31` 复查日期；但 §4 写现状计数（F3）、§3/§4 的判据含会漂数字，与 rules-doc「第 3、4 节写约束，不写现状」相抵。

**统计：验证 12 条，成立 8、仍不精确 3、不成立 1；新发现 11 条（高 2 / 中 6 / 低 3）。**
