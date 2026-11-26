# Project Context

Last updated: 2026-11-26T02:04:05.879Z

## Summary

本会话从 session-17f125e2 交接续接，两件主线。其一：用户对 README 反复不满（“文档拉屎”），前两轮我都改错对象——先修 121 行的压缩说明，再只删那 11 行里的一句话。这次定位正确：README 第 8–18 行整段“文档分工”是元描述，说明的是文档自己该怎么分工，不是使用说明。已整段删除（166→154 行），逐条核过 11 行的信息归宿：四个 docs 职责在 `docs/README.md` 第 10/13/14/15 行（更详细）、逐版本变更在第 4 行、archive 索引在第 37 行、手册定位在第 3 行；唯一真正的价值是它同时是 `AGENTS.md` / `RULES.md` 的入口，已移到 `docs/README.md` 头部承担。`RULES.md` 第 1 章“文档分工在 README.md”随之改指 `docs/README.md`。提交 `c8bdabd docs: drop the doc-map preamble from the README`，`pnpm docs:check` 135 项 0 失败，`src/`/`client/`/`test/`/`lib/` 零改动。其二：核实用户手写的 `github:P02-1010751281/dsh-project-context` pin。已实测 `#sha` 精确锁提交、tag 名 `#v0.5.0` 解析到 peel 后的 `28d2459` 且 lock 的 specifier 留 tag 名而 integrity 与写 sha 完全相同，故锁 tag 与锁 sha 等效、差别只是 tag 可被移动；用户裁定不改那一行，agent 不擅自动。 推送受阻：远端 `ssh://…:443` 报 `Connection closed by 198.18.0.179`，HTTPS 直连与两个代理口都 TLS 失败，而直连国内站点 200；mihomo 日志显示出口节点 `dy.22qk.cn:30648` 报 EOF，是代理节点故障、与本仓库无关。累计 5 笔提交待推送（`c8bdabd`、`2cd220b`、`ebaec53`、`45da10a`、`20939c1`），工作树已干净。 记账：本轮按“合并重述而非删条目”腾出空间，写入 README 手册定位、tag pin 等效性、代理故障判据，并把 e11 并入 8b6、b41 并入 a4a、8ac 指针化。

## Key points

- README 第 8–18 行的整段「文档分工」是元描述而非使用说明，已整段删除；README 从 166 行到 154 行，头部直接从标题进正文。
- 删掉的 11 行逐条有归宿：四个 docs 职责在 `docs/README.md` 第 10/13/14/15 行、逐版本变更第 4 行、archive 索引第 37 行、手册定位第 3 行；只有 `AGENTS.md`/`RULES.md` 入口是独有信息，已移到 `docs/README.md` 头部。
- `RULES.md` 第 1 章「基线来源」原写「文档分工在 README.md」，删除后改指 `docs/README.md`，否则是悬空引用。
- 提交 `c8bdabd docs: drop the doc-map preamble from the README`，`pnpm docs:check` 输出 135 项 0 失败；`src/`、`client/`、`test/`、`lib/` 零改动。
- 标题 `## 它在项目里写什么` 的「它」指代不明、与邻近名词短语标题不一致，改为 `## 写入的文件`；同笔补上树里漏掉的 `tasks/<slug>.md`——正文两处与 `docs/architecture.md` §8 都把它列为每轮注入，缺它等于自相矛盾。提交 `00ee5c0`。
- `github:<owner>/<repo>#v0.5.0` 经 `pnpm install --lockfile-only` 解析到 peel 后的 `28d2459`；lock 的 specifier 保留 tag 名，integrity 与写 sha 的 lock 相同，所以锁 tag 与锁 sha 等效，差别只是 tag 日后可被移动。
- 用户裁定 406-12 的 pin 那行不动；agent 不改用户手写的 profile 依赖行。
- 推送失败原因是代理出口节点故障：mihomo 日志 `dy.22qk.cn:30648 connect error: EOF`；直连国内站点 200，DNS 解析到 fake-IP `198.18.0.179` / `fdfe:dcba:9876::b`，说明劫持正常、只是节点线路断。
- 踩坑：经 1080 代理访问 GitHub 曾偶发返回一次 200，随后同一路径仍 TLS 失败，所以单次 200 不能判通；HTTPS 通过代理与 SSH 443 都不通。
- 累计 6 笔提交待推送：`00ee5c0`（标题与 tasks 树项）、`c8bdabd`、`2cd220b`（技能记录 tag pin 形态）、`ebaec53`（关闭 tag 问题并记真实余量）、`45da10a`、`20939c1`；工作树干净。
- 记忆文档仍贴着 54000 上限，本轮靠合并 e11→8b6、b41→a4a、8ac 指针化腾空间，未删任何仍成立的事实。
- `docs/README.md` 自身并不严格折行（中位 103 显示列、最宽 285），所以补的入口行折成两行已足够，不必按 README 的 100 列习惯强改。

## Open tasks

- 推送阻塞：等用户换好 mihomo 节点（或网络恢复）后 `git push origin main`，6 笔提交待推。
- 406-12 需用户重启一次才加载 0.5.0；重启后验四个命名空间都在、shared `maxMemoryChars: 48000` 生效——读 loader 条目 config，不看 `--verify-only` 整体 RESULT。
- 406-12 的 pin 保持用户手写的 `github:P02-1010751281/dsh-project-context` 不变（用户已裁定，agent 不动）。
- 406-12 上的三个 `.bak-20261124-*` 与 `/tmp/vendor-0.4.3-backup.tgz` 待用户确认后清理。
- 记忆余量仍紧：下次记账 pass 仍要先合并重述条目再新增事实。
- SH-10 接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- `RULES.md` 第 11 章：`src/project-memory/consolidate.ts` 仍超 400 行线，属用户裁定项。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更（「原因」改「码 + 参数」）。
- 接第二个宿主前的三件缺口（`docs/host-context-2c-design.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动；`overview-cache.v3` 里指向已删探针路径的失效键待在重启窗口决定是否清。

<!-- latest-session-title: README 摘掉文档分工元描述；核实 406-12 的 github: pin 与 tag 写法；推送被代理故障阻塞 -->
