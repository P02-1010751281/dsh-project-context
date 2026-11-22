## 结论

四份文档的方向与主体结构成立（RULES 1–11 章齐、禁令在 §10；4.2 的 7 边/12 specifier/14 处实测可复现；3.2、4.3、5.1 的判据命令真能跑）。但存在 8 处实质矛盾/不可判定，14 处会造成误读或无法核对的缺陷。

未覆盖：`pnpm test` 内部先跑 `tsc` 会写 `lib/`（package.json:56），按只读纪律未执行 6.1/6.2 两条门禁，只做静态核对。

**已验证通过**：`grep -rho 'from "\.\./project-[^"]*"' src/ | sort | uniq -c` 输出 12 行合计 14，与 architecture:26 表逐条对上；3.2 判据只输出 1246/1242 两个文件；4.3 判据仅 `project-context` 命中 1；5.1 判据无输出；脚本 `typecheck/build/test/build:client` 与全部被引用的 9 个技能、2 个 test helper 均存在；`docs/README.md` 已登记全部 `docs/*.md`（含新增 GLOSSARY）；architecture 的入口行锚（126/127/136、62/63/711、30/31/91、93/95/103）与数据流锚全部命中；交接门序（阈值→question→subagents→nothing-to-drop）与 `decide.ts:85-130` 一致；「交接无模型调用」与 `summary.ts:1-7` 自述一致；GLOSSARY:45-51 之外的禁止异名在四份文档中零命中。

## 发现表（按严重度）

| 级 | 文件:行 | 问题 | 证据 | 建议最小改法 |
|---|---|---|---|---|
| 错误 | RULES.md:17 / :20 | 2.1「改规则…一次只动 RULES.md（可附 CHANGELOG）」与 2.4「代码与规则必须同时改时，提交消息点名规则号」互斥：同一提交既要只含 RULES 又要含代码 | 两条正文直接对撞，无豁免句 | 2.4 改为「规则先单独提交，代码提交在消息里引用规则号」；或 2.1 放宽为「规则提交可含配套代码，须点名规则号」 |
| 错误 | RULES.md:30 | 3.6 判据「文档门禁坏链 0（见 docs/development.md）」不存在该检查 | `grep -n '坏链\|链接\|link' docs/development.md` 无输出；development.md 46 行只有 typecheck/build/test、lib 纪律、card-render | 写实际可跑命令（如 `~/.agents/skills/gated-review/scripts/docgate.py RULES.md AGENTS.md docs/architecture.md docs/GLOSSARY.md`），或删该判据只留引用写法 |
| 错误 | RULES.md:57（vs package.json:56、AGENTS.md:4） | 6.6 禁裸 `node --test`，但唯一门禁 `pnpm test` 的内容就是 `node --test 'test/**/*.test.mjs'`；AGENTS 的计数命令与包脚本逐字相同 | package.json:56 `"test": "tsc && tsc -p tsconfig.client.json --noEmit && node --test 'test/**/*.test.mjs'"`；AGENTS:4 同形 | 点名真正的坏形态（不带 glob 的 `node --test`、或用单文件代替整轮），或删 6.6 保留 6.1/6.5 |
| 错误 | RULES.md:79（vs :12、:80） | 9.1 要求「同步两个 profile」，但 §1 把 profile 划出范围（只读、改动由用户执行），9.2 又说先改 profile（用户执行）再发布代码 | :12 范围句、:80 排序句 | 9.1 改为「给出两个 profile 的改法清单，由用户执行」，与 9.2 对齐 |
| 错误 | RULES.md:21、:11 | 2.5 要求无法机械判定的规则标「软规则」，但 53 条编号规则只有 2.1/3.2/3.6/4.2/4.3/5.1/9.3 给判据命令；2.3、3.4、4.5、5.3、5.4、7.4、7.6、9.2、9.4 等十余条无判据也未标软规则；唯一软规则 3.3 反而可 `git diff --numstat` 判 | 逐条清点；3.3 有明确阈值 400 与对象 | 给缺判据的条补命令或补「（软规则）」；3.3 去掉软标并写「本次=本提交，`git diff --numstat` 净增即需 CHANGELOG 条目」；删 §1「每条规则须能一条命令判定」的绝对句 |
| 错误 | architecture.md:25 / :36（+ RULES.md:36） | 称「`src/shared/` 在最底层」，白名单却含 `shared → project-handoff/language`（底层依赖插件模块），RULES 4.2 还称之为「跨插件 import」 | `src/shared/conversation.ts:9` 实证该边；architecture:36 表行 | 把 `language.ts` 移入 shared，或改写层序句并注明这条是唯一例外、不叫跨插件边 |
| 错误 | GLOSSARY.md:41 / architecture.md:93 | 权威定义把 `INDEX.md` 列为「唯一事实源」，架构却说 INDEX 由目录重建（派生） | architecture:93「`INDEX.md` 由 `reconcileSessionIndexOnce` 按目录重建」 | GLOSSARY 权威定义删 `INDEX.md`，改列「目录 + `session.jsonl`」 |
| 错误 | RULES.md:99、CHANGELOG.md:25-26 | 第 11 章第三条无复查日期且已裁定（「不再回改」），属残留不是未决；2.2 要求例外带「何时复查」，3.7 例外无日期 | 2.2 正文；11 章另两条均有 2026-12-31 | 把 3.7 条移出未决（历史由 CHANGELOG 承载），或在条目与例外两处补「2026-12-31 复查」 |
| 警告 | RULES.md:30 / docs/README.md:66 | 3.6 说 Markdown 按文档自身目录解析；docs/README 说跨文件引用写仓库相对路径、不写本文件相对路径；architecture:3 的 `../README.md` 正违反 docs/README:66 | 两处正文 + architecture:3 | 二选一并全局执行；建议保留 3.6，改 docs/README:66 |
| 警告 | RULES.md:17 / 当前工作树 | 未提交改动同时动 RULES、AGENTS、architecture、docs/README、CHANGELOG 并新增 GLOSSARY；若按 CHANGELOG「批次 AD」一次提交即违反「一次只动 RULES.md」 | `git status --short` 六项治理文件 + 新 GLOSSARY | 拆「RULES 规则」与「AGENTS/架构/术语表」两类提交，或把 2.1 的范围明确写成治理文档集合 |
| 警告 | AGENTS.md:30-32、38、43-47 | 复述 RULES 规则正文（6.2、6.3、8.1、10.1、10.2、10.3、10.4、10.6），应只链接 | 与 RULES 对应条逐字比对 | 改成「何时跑哪条门禁」+ 链接 `RULES.md` 条号 |
| 警告 | RULES.md:30、AGENTS.md:36 / GLOSSARY 代码锚点、AGENTS:13、architecture:42/48/54 | 「`path:line` 证据必须带符号名」，但 GLOSSARY 25 处锚点全为裸 `path:line`，AGENTS:13、architecture:42/48/54 亦然 | GLOSSARY:10-41 代码锚点列；AGENTS:13 `package.json:8-30` | 锚点补符号名，或把 3.6 限定为「证据引用」，术语表锚点不受此限 |
| 警告 | RULES.md:36 | 4.2 判据只比行数与合计：删一条边再加一条仍 12 行/14 处即通过，发现不了「表外 specifier」；且只匹配双引号 `from`，`import("../project-…")` 不计 | 判据命令只输出计数，无清单比对 | 改为与固定 specifier 清单 diff（如 `comm -13`），或输出排序后文件与表逐行比 |
| 警告 | RULES.md:73 / CHANGELOG.md:8、docs/README.md:65 | 8.2 的发版步骤只有「搬段 + 重开空节」，漏「版本目录加一行」；CHANGELOG 称版本目录是唯一索引 | CHANGELOG:8、926；docs/README:65「目录加一行」 | 8.2 补「并在 `## 版本目录` 加一行」 |
| 警告 | RULES.md:35 / architecture.md:130 | 新增插件清单：RULES 列 4 项（不含 RULES 自身），architecture 列 5 项（含 RULES 4.1） | 两处正文 | 合并为一处清单，另一处只链接 |
| 警告 | RULES.md:54 / CHANGELOG.md:28-45 | 6.3 要求把变红用例名写进未发布条目；AC 修复条目只有变异描述（「10 个变异具名打红」），无任何 `*.test.mjs` 用例名 | 该段 grep `test/\|用例\|\.test\.mjs` 零命中 | 补用例名，或把 6.3 判据改成「变异描述 + 用例文件」并写明 |
| 警告 | RULES.md:28 | 3.4「`test/logic.test.mjs` 只收跨主题纯逻辑（行数用 `wc -l` 现读）」：给了命令却不给阈值/对象，整条无判据 | 3.4 全文 | 删括号句，或补行数上限并标软规则 |
| 警告 | RULES.md:81 | 9.3 重复 4.3 的 `grep -c 'export const Config'`，且「grep 必须通过」不是通过/失败语义（任一文件命中即 exit 0） | 4.3 与 9.3 正文 | 删重复命令，只留「键集合以 `settings.ts` 为唯一来源」并链到 4.3 |
| 警告 | GLOSSARY.md:23 / :37 | 整理锚点 `consolidate.ts:296` 是注释行；架构说 `consolidateProject` 在 `index.ts:296`。墓碑锚点指向 `retirement.ts`，而写 `retired.md` 的是 `retired.ts` | `sed -n 296p consolidate.ts` = ` *`；architecture:103；`retired.ts:2` 自述 tombstone channel | 改为 `src/project-memory/index.ts:296` 与 `src/project-memory/retired.ts` |
| 警告 | architecture.md:125 | 「三套…绝不自动改写文件」不成立：技能 `expired` 会自动移出并改写绑定 | `src/project-autolearn/index.ts:102,114` 的 `runSkillExpiry` → `skill-state-source.ts:227` rename、`:232` 写 `skill-bindings.json` | 限定为「不靠改写文件消除状态」，另写一句过期自动移出 |
| 警告 | architecture.md:76-90 | §8 自称覆盖「磁盘上每个文件的用途」，漏 `retired.md`（GLOSSARY:37）、`skill-bindings.json`、`expired-skills/`、`purge.log`/`trash/` | `src/shared/gitignore.ts:25` 列出后四项；§8 树里没有 | 补齐，或把 §8 标题收窄为「主要文件」 |
| 警告 | RULES.md:52-56 / docs/development.md:8-17 | 门禁命令与产物纪律在两处正文重复（3 条命令、`git diff --exit-code -- lib`、card-render 唯一真渲染），而 RULES:13 又说门禁在 development.md | 两处逐条同义 | RULES 只留阈值/判据并链接，或删 development.md 的重复段 |

检查 98 条（交叉事实 14、RULES 编号规则 53、术语 19、重复与空洞 8、结构 4），错误 8，警告 14。
