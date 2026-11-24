# Project Context

Last updated: 2026-11-24T14:28:39.925Z

## Summary

本会话续接批次 AC（设置拆分）+ SH-10 取证，本轮完成三件事：切版本发布 v0.5.0、把 406-12 从 `file:` tgz 改装 git pin 并迁移其错卡键、以及本机重启后的四卡验收。 发布：拆分是破坏性变更，两个 `package.json` 都还是 `0.4.3`，按发布流程切 `v0.5.0`。未发布正文整段搬进 `docs/changelog/v0.5.0.md`（逐行比对 1379/1379 完全相同），版本目录加一行，重开空 `### 未发布（v0.5.0 之后）`，`package.json` → 0.5.0。搬移过程中我把 `CHANGELOG.md` 弄坏过两次——`## 版本目录` 在正文里也出现一次，我的标题/表头查找命中了假位置，一次删掉 1132 行；每次都从 `git show HEAD:CHANGELOG.md` 恢复重做，最后按内容锚点定位并逐行验证。提交 `28d2459 chore(release): v0.5.0`，tag 对象 `f6164c7` 指向它，已推送，`HEAD = origin/main = 28d2459`。该提交只动 changelog / `package.json` / 技能 / 记忆，`lib/` 与 `234c3f8` 相同，所以 desktop/web 的 pin 不必抬。 406-12：我最初走「传 0.5.0 tgz、手改 lockfile integrity」，用户一句「用git好吗？」纠正——406-12 能直接 `git ls-remote` 到远端，git pin 更好（无磁盘副本、无需手算 integrity、版本不绑文件名）。已把那套改动完整回滚，改为 pin `git+ssh://git@ssh.github.com:443/P02-1010751281/dsh-project-context.git#28d2459`，用该机 PATH 上的 pnpm 12.4.1 安装成功，逐文件 sha256 比对 255/255 一致，`SettingsSchema` 5 处与 `CARD_ROWS` 都在，旧 tgz 引用清零。随后发现更重要的一件事：它的 `cordis.patch.yml` 里 `handoffPendingQuestion` 仍挂在 `project-context` 下，升级后不迁移就重启那张卡会消失；已新建 `project-handoff` 条目把它搬过去，用新解析器验证 PASS，负控制（把该键放回共用条目）得 rc=1。 本机验收：宿主 21:52:16 已重启，四个命名空间（`project-context` / `-memory` / `-autolearn` / `-handoff`）都在服务库里，每个条目只持有自己卡片的键，`maxMemoryChars` 已是 54000、`maxOutputTokens` 49152。`settings.current()` 经 9230 Inspector 桥返回 `undefined`，我改读 loader 条目 config 才拿到真实值，没有把读不到当通过。 门禁现跑：typecheck 0、boundary 127 文件 0 失败、docs 138 项 0 失败、test 832/832（exit 0）、build 后 `lib/` 无差异。新增 autolearn 技能 `.agents/skills/dsh-plugin-settings-card-key-wiring/`（随发布一并提交）。 仍然悬着的只有 406-12 重启后的验收，以及若干长期登记项（SH-10 接线、`consolidate.ts` 400 行线、`/autolearn` admission 原因句中文化、第二宿主缺口、AOCI A/B）。

## Key points

- HEAD = origin/main = `28d2459 chore(release): v0.5.0`；tag 对象 `f6164c7` 指向 `28d2459`，已推送；`v0.5.0` 之后未发布段为空。
- `28d2459` 只动 `CHANGELOG.md` / `docs/changelog/v0.5.0.md` / `package.json` / 新技能 / 记忆文档，`lib/` 与 `234c3f8` 完全相同，所以 desktop/web 的 pin 不用抬。
- v0.5.0 的未发布正文搬移逐行比对 1379/1379 完全一致；`docs/changelog/v0.5.0.md` 头部为 `# v0.5.0（2026-11-24）` + 回链 blockquote，版本目录新增 `v0.5.0` 行。
- `CHANGELOG.md` 正文里也有一处以 `## 版本目录` 开头的行内引用，按行首/index 查找会命中假位置；正确做法是只在最后一个索引标题之后定位分隔表头，并按内容锚点定位而非硬编码行号。
- 406-12 已从 `file:./vendor/dsh-project-context-0.4.3.tgz` 改为 git pin `#28d2459`（`git ls-remote` 直连可达），安装后 255/255 文件与 `git show 28d2459:lib/…` 逐字节一致，lockfile 里旧 tgz 引用清零。
- 406-12 的 pnpm 是 PATH 上的 12.4.1（没有 store 版 pnpm），lockfileVersion 9.0 兼容，安装成功；备份留了 `package.json.bak-20261124-2219-v050`、`pnpm-lock.yaml.bak-…`、`cordis.patch.yml.bak-…` 与 `/tmp/vendor-0.4.3-backup.tgz`。
- 406-12 的 `cordis.patch.yml` 已迁移为：`project-context` 只留 `maxMemoryChars: 48000` 与 `taskMode: delegated`，新建 `project-handoff` 条目只带 `handoffPendingQuestion: wait`；用新解析器验证 PASS，负控制（键放回共用条目）rc=1。
- 本机宿主 21:52:16 重启后四个设置命名空间都在，每条目只持有自己卡片的键；`maxMemoryChars` 生效为 54000、`maxOutputTokens` 49152。
- 经 9230 Inspector 桥读运行期设置时 `settings.current()` 返回 `undefined`，必须改读 loader 条目 config；把读不到当通过是错的。
- 新增受跟踪 autolearn 技能 `.agents/skills/dsh-plugin-settings-card-key-wiring/`，拥有把配置键新增/搬移/拆分到四张卡的流程。
- 门禁现跑：typecheck 0、boundary 127 文件 0 失败、docs 138 项 0 失败、`pnpm test` 832/832（exit 0）、build 后 `lib/` 无差异。

## Open tasks

- 406-12 需重启一次才加载 0.5.0；重启后验证四个命名空间都在、shared `maxMemoryChars: 48000` 生效——读 loader 条目 config，不靠 `settings.current()`，也不看 `--verify-only` 的整体 RESULT。
- 406-12 上的三个 `.bak-20261124-*`（`package.json` / `pnpm-lock.yaml` / `cordis.patch.yml`）与 `/tmp/vendor-0.4.3-backup.tgz` 待用户确认后可清理。
- SH-10 接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- `RULES.md` 第 11 章：`src/project-memory/consolidate.ts` 仍超 400 行线，属用户裁定项。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更（「原因」改「码 + 参数」）。
- 接第二个宿主前的三件缺口（`docs/host-context-2c-design.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动；`overview-cache.v3` 里指向已删探针路径的失效键待在重启窗口决定是否清。

<!-- latest-session-title: 发布 v0.5.0、406-12 改 git pin 并迁移设置键归属；本机四卡验收通过 -->
