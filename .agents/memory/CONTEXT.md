# Project Context

Last updated: 2026-11-26T06:14:37.954Z

## Summary

本会话从 session-2f004655 交接续接，主题是「文档里的断言是否与源码一致」。前一轮修了 README、`docs/settings.md`、`docs/GLOSSARY.md` 的九处过期说法，并查明 `pnpm docs:check` 只验链接/锚点/符号窗口、不验语义，所以与源码相反的散文可以长期全绿。用户追问「项目全覆盖了吗」后，本轮把范围扩到全部 25 份现行文档，逐份枚举可核对断言并写实测命令，又抓出 12 处问题：`docs/harness/dsh.md` 事件表仍列 63 个而实测 67（补 `workspace/session-archived`、`workspace/session-unarchiving`、`web/providers-changed`、`worktree/cleanup`）；`docs/harness/README.md` §4 的复核命令仍 grep `ctx.on`，而注册已改走 `host.on`，照跑会得出「一个事件都没注册」；`docs/development.md` 同页一处说 desktop 监听 19387、一处说 19387 永不被监听；`docs/README.md` 把已落地的批次 AC 与 2c-1 标成「尚未动 `src/`」、把 5 条规则写成「四条（五条检查）」；`docs/development.md:32` 重复了 schemastery 的错说法；`docs/batch-v-memory-staleness-spec.md`、`docs/memory-rewrite-loss-gate-spec.md`、`docs/handoff-candidates-b-c.md` 三份 spec 的状态行仍写「`src/` 未改」而实现早已在树上（`staleness-source.ts`、`missing-literals.ts`、`relabel.ts`）；`docs/changelog/<version>.md` 这个错写法又出现在两处现状声明里。也确认了一批准确断言：`sibling-repos.md` 三个远端地址、分支名、codex 的 370 B 入口与 93424 B 主文件；`pi.md` 的 41 事件 / 33 方法；`codex.md` 的 7 个 hook；`compaction-vs-handoff.md` 引用的上游 0.8 / 0.16 与 `resolveCompactSpec`；`vocabulary-conventions.md` 引用的两个测试与 23=23 键集；`host-context-2c-design.md` 的四个 `start(host, entry)` 与核心零 cordis 类型。验证：`pnpm docs:check` 135 项 0 失败、`pnpm boundary:check` 127 文件 0 失败、docgate 36 份文档失败项 0。提交两笔：`4148192 docs(rules): make the doc index match what shipped`、`93ff955 docs: check all 25 current docs against the code they describe`。工作树只剩插件自己写回的 `MEMORY.md`/`CONTEXT.md`；待推提交累计 14 笔，推送仍卡在代理出口节点。未覆盖：`.agents/skills/` 47 篇只做 grep 级扫描，`docs/archive/`、`docs/changelog/`、`docs/research/` 与 `.agents/evidence/` 按豁免未动；冷读独立性仍未达成，所有结论都是 lead 自己逐条取证。

## Key points

- 2026-11-26 全覆盖审计范围是 25 份现行文档，逐份枚举可核对断言并写实测命令，又抓出 12 处过期说法。
- `docs/harness/dsh.md` 事件表由 63 改为实测 67，补 `workspace/session-archived`、`workspace/session-unarchiving`、`web/providers-changed`、`worktree/cleanup`。
- `docs/harness/README.md` §4 的复核命令由 `ctx.on` 改为 `host.on`；核心目录零 `ctx.*` 由 `pnpm boundary:check` 的 service-access/wiring 规则保证。
- `docs/development.md` 的 19387 自相矛盾已修：alpha.2 起宿主用 `--port 0`，19387 不会被监听，本机真实口是 GUI 35687 与 Inspector 9230。
- 三份 spec 的状态行改为已落地：`batch-v-memory-staleness-spec.md`（`staleness-source.ts`）、`memory-rewrite-loss-gate-spec.md`（`missing-literals.ts`）、`handoff-candidates-b-c.md`（`relabel.ts`）。
- `docs/README.md` 把批次 AC 与 2c-1 从「尚未动 `src/`」改为已落地，并把规则数从「四条（五条检查）」改为 5 条。
- 确认准确：`sibling-repos.md` 三远端/分支、codex 370 B 与 93424 B、`pi.md` 41 事件/33 方法、`codex.md` 7 hook、上游 0.8/0.16 与 `resolveCompactSpec`、两个测试与 23=23 键集、四个 `start(host, entry)`。
- `pnpm docs:check` 仍只验链接/锚点/符号窗口，不验语义；本轮过期说法全部靠人工逐条对源码抓出。
- 门禁全绿：`pnpm docs:check` 135 项 0 失败、`pnpm boundary:check` 127 文件 0 失败、docgate 36 份文档失败项 0。
- 两笔提交：`4148192`（docs(rules)，只动 `docs/README.md`）与 `93ff955`（其余文档与 CHANGELOG）；待推累计 14 笔。
- 冷读独立性未达成：4 个子代理全部失败，所有结论均由 lead 自己取证。
- `.agents/skills/` 47 篇只做了 grep 级扫描，没有逐条对源码核断言。

## Open tasks

- [todo] (in progress) 步 1-2：确定审查对象与领域，跑文档门禁（docgate.py + pnpm docs:check）
- [todo] 声称核对：枚举 README/AGENTS/RULES 里所有可核对的声称并逐条实测
- [todo] 冷读：派无上下文 subagent 做「声称核对 + 照做受阻」两轮
- [todo] 设计审问：逐节问「还缺什么、为什么在这份文件」
- [todo] 阴性对照：证明文档门禁真会红
- [todo] 步 3 深度判定 + 按报告骨架交付
- 推送阻塞：等用户恢复 mihomo 节点后 `git push origin main`，14 笔提交待推（最新 `93ff955`）。
- 把 `.agents/skills/` 47 篇逐条对源码核断言；目前只做了 grep 级扫描并改了 3 篇路径引用。
- 回答/执行「项目全覆盖」的剩余范围：`docs/archive/`、`docs/changelog/`、`docs/research/` 与 `.agents/evidence/` 按豁免不动，但需在交付里明确。
- 冷读独立性仍未达成（4 个子代理全部失败）；若要第二双眼睛需换手段。
- 406-12 需用户重启一次才加载 0.5.0；重启后读 loader 条目 config 验四个命名空间与 shared `maxMemoryChars: 48000`，不看 `--verify-only` 整体 RESULT。
- 406-12 的 pin 保持用户手写的 `github:P02-1010751281/dsh-project-context` 不变（用户已裁定，agent 不动）；其上三个 `.bak-20261124-*` 与 `/tmp/vendor-0.4.3-tgz` 待用户确认后清理。
- SH-10 接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- `RULES.md` 第 11 章：`src/project-memory/consolidate.ts` 仍超 400 行线，属用户裁定项。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更（「原因」改「码 + 参数」）。
- 接第二个宿主前的三件缺口（`docs/host-context-2c-design.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动；`overview-cache.v3` 里指向已删探针路径的失效键待在重启窗口决定是否清。
- 记忆余量仅约数十字符：下次记账先合并同义重述；要补字面量正解是指针化到负责该流程的技能。

<!-- latest-session-title: 文档全覆盖审计完成；25 份现行文档对源码核过，14 笔待推 -->
