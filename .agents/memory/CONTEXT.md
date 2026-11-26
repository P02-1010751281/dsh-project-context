# Project Context

Last updated: 2026-11-25T09:59:12.900Z

## Summary

本会话从 session-95ba96da 交接续接，主线是核实用户在 406-12 上手改的 `github:P02-1010751281/dsh-project-context` pin 是否可行。结论：用户的写法可用且比我原先的 ssh 写法更好，唯一缺陷是缺 `#sha`。三点实测支撑：`github:<owner>/<repo>#<sha>` 在 `pnpm install --lockfile-only` 下精确锁到该提交（`6318547`）；不带 sha 时解析到默认分支当时的 HEAD（现恰好也是 `6318547`）；codeload 对 `28d2459`、`6318547` 与旧仓库名/新仓库名都匿名返回 HTTP 200，说明远端装不需要 ssh key。406-12 的 lockfile 已钉住 `28d2459`（0.5.0），所以现状安全，风险只在下次重装（删 lock、`--force`、换机）。我曾提议补 sha，改的是用户设的那一行，已明说不擅自动，等用户裁定。 仓库侧已确认：GitHub 仓库与包名都改成了 `dsh-project-context`，但远端路径、依赖键与 loader 条目名的字面量仍是旧形状；`require.resolve` 能解析到已装包，唯一失败的 patch 名 `dsh-client-auto-continue` 不是我们的包；依赖键、包内 name、已装包三者字节一致。 406-12 现状：装的是 0.5.0，`SettingsSchema` 5 处、`CARD_ROWS` 2 处在；lock 在 `28d2459`，它与 HEAD `6318547` 只差两个记忆文档（`src/`、`lib/`、`client/`、`test/` 零差异）；`cordis.patch.yml` 键归属正确。宿主进程仍是 11月21日 23:23 启动的那个，所以 0.5.0 还没生效，重启是唯一待办。 用户随后问「锁 tag 也行吧？」。已核实 `v0.5.0` 是 annotated tag `f6164c7`、peel 到 `28d2459`，且已推送到远端（`refs/tags/v0.5.0` 与 `refs/tags/v0.5.0^{}` 都在）。`github:` 简写能直接写 tag 名：`github:P02-1010751281/dsh-project-context#v0.5.0` 经 `pnpm install --lockfile-only` 解析到 `28d2459`（即 peel 后的提交），lock 的 specifier 保留 tag 名、integrity 与写 sha 的 lock 逐字节相同，所以锁 tag 与锁 sha 效果等同，区别只是 tag 可被移动。 记账 pass（会话早段）已合并三对重述条目、补回一处真丢字面量、消除新增悬空引用，提交 `3403737`、`6318547` 并推送，工作树干净、`lib/` 未动；文档当前 53997 字符、对 54000 只剩 3 字符。 过程陷阱：工具输出会把不同字面量渲染成同一文本（仓库名、依赖键、包名撞在一起），我一度据此判「仓库改名了」，最后靠字节长度、码点与 hex 前缀才钉住结论；这类判断一律比字节/码点。

## Key points

- `github:<owner>/<repo>#<sha>` 能精确锁定提交（实测锁到 `6318547`）；不带 `#sha` 时解析到默认分支当时的 HEAD，只有 lockfile 钉住提交时才安全。
- codeload 对 `28d2459`、`6318547` 都匿名返回 HTTP 200，所以 `github:` 源在远端机器上不需要 ssh key，比 `git+ssh://` 少一个故障源。
- GitHub 仓库与包名已改为 `dsh-project-context`，但远端路径仍是 `dsh-project-context.git`，依赖键与 loader 条目名是旧字面量；旧仓库名与新仓库名都用 `git ls-remote` 解析到同一 HEAD。
- 406-12 的 desktop 依赖键是用户手写的 `github:P02-1010751281/dsh-project-context`（无 sha），lockfile 已锁在 `28d2459`/0.5.0；依赖键、包内 name 与已装包字节一致，`require.resolve` 能解析。
- 唯一解析失败的 patch 名是 `dsh-client-auto-continue`，属第三方插件，不是我们的包；`node_modules` 里只有一份带 `exports[./handoff]` 的候选。
- 406-12 的 `cordis.patch.yml` 键归属正确：共用条目只留 `maxMemoryChars: 48000` 与 `taskMode: delegated`，`handoffPendingQuestion: wait` 在 `project-handoff` 条目。
- 406-12 宿主仍是 11月21日 23:23 启动的进程，所以 0.5.0 未生效；判生效读宿主 pid 启动时间，不看安装成功。
- `v0.5.0` 是 annotated tag `f6164c7`，peel 到 `28d2459`，两个 ref 都已在远端；tag 能直接写进 `github:` spec：`github:P02-1010751281/dsh-project-context#v0.5.0` 经 `pnpm install --lockfile-only` 解析到 `28d2459`（= peel 后的提交），lock 的 specifier 保留 tag 名、integrity 与写 sha 的 lock 完全相同（`BDLnHDhZ…`），所以锁 tag 与锁 sha 效果等同。
- 本机 desktop / web 仍钉在 `234c3f8`，其代码与 HEAD 相同，不影响功能；ctxdev 是 `link:`。
- 记账 pass 的提交 `3403737 docs(memory): record the v0.5.0 release and the 406-12 git pin` 与 `6318547 docs(memory): reclaim headroom the last pass spent` 已推送；只动 `.agents/memory/MEMORY.md`，`lib/` 未变。
- 工具输出会把不同字面量渲染成同一文本：判名字相等要比字节长度、码点或 hex 前缀，我因此差点误判「仓库改名」。
- 记忆文档现 53997 字符、对 54000 只剩 3 字符；探针的 500 阈值是经验值，真判据「加一条典型事实不丢条目」通过。

## Open tasks

- 等用户裁定是否给 406-12 的 pin 补 `#<sha>`；那是用户设的那一行，agent 不擅自改。
- tag 锁定已实测（解析到 peel 后的 `28d2459`）；残余只是「tag 日后被移动」这一理论风险，lockfile 已钉提交因而重装仍取旧提交，但未实测。
- 406-12 需重启一次才加载 0.5.0，重启后验四个命名空间都在、shared `maxMemoryChars: 48000` 生效——读 loader 条目 config，不看 `--verify-only` 的整体 RESULT。
- 406-12 上的三个 `.bak-20261124-*`（`package.json` / `pnpm-lock.yaml` / `cordis.patch.yml`）与 `/tmp/vendor-0.4.3-backup.tgz` 待用户确认后可清理。
- 记忆余量只剩 3 字符（53997/54000）：下一次记账 pass 必须先合并重述条目再新增事实，否则会按段落顺序丢别段的真实条目。
- SH-10 接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- `RULES.md` 第 11 章：`src/project-memory/consolidate.ts` 仍超 400 行线，属用户裁定项。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更（「原因」改「码 + 参数」）。
- 接第二个宿主前的三件缺口（`docs/host-context-2c-design.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动；`overview-cache.v3` 里指向已删探针路径的失效键待在重启窗口决定是否清。

<!-- latest-session-title: 核实 406-12 的 github: pin 写法，并判定锁 tag 是否可行 -->
