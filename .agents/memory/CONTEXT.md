# Project Context

Last updated: 2026-09-26T09:23:52.997Z

## Summary

把「插件怎么交付到本机」这条线从本仓记忆里整体撤出，只留一行指针（权威副本在 `/etc/nixos` 的 `scripts/dsh-plugin-patches/PINNING-RISK.md` 与 `log.md` §1.10-67）。删副本前逐条 grep 验证过指针覆盖齐全（`save-exact`、检查项 5、`command -v` 自证、`set -euo pipefail` 守卫、`pre-boot`、`patch-check.log`、`DSH_DESKTOP_PATCH_CHECK`、`DSH_PROFILES_ROOT`、每日 06:20 单元、`0.11.9` 全在），删除后本仓 0 命中；同时把「本机验证环境」1.1KB 的 host 身份段压成指向 tracked 技能 `dsh-host-build-restart-verify` 的指针，并修掉一处改名后的悬空交叉引用。`MEMORY.md` 28,329 → 24,180 字符（余量 3,671 → 7,820），`truncated:false` / `damaged:0` / `poisoned:false`，12 节结构与全部插件侧不变量仍在。门禁重跑 0/0/225。另外抓到当天第二例「并发会话直接写进 `.agents/skills/`、没有任何东西 stage」的新技能，核对 frontmatter/结构/无密钥后入库；盘与跟踪现为 12 = 12。过程里自身踩过一次坑：按前缀 replace 的行内改写把 `CONTEXT.md` 拼出重复残尾，读回确认后整行重写并加了「同一句出现两次」检查。

## Key points

- 交付线撤出：本仓只留指针，权威副本在 `/etc/nixos` 的 `PINNING-RISK.md` / `log.md` §1.10-67；删前逐条 grep 验证覆盖、删后那些串在本仓 0 命中。只留一条与插件代码有关的：`dsh-client-auto-continue` 补丁本机自维护、0.11.8、客户端半已删（上游改用 `ctx.configForms`）。
- 记忆实测（API 现查）：24,180 字符、余量 7,820、`truncated:false` / `damaged:0` / `poisoned:false`、12 节完整；插件侧不变量（`shapeRejection`、knee 公式、`SAFETY_MARGIN_TOKENS`、记忆 cap API、跟踪边界、`ctx.configForms`）逐条 grep 仍在。
- 门禁（2026-09-26 重跑）：typecheck 0、build 0、225/225 tests、`lib/` mutant markers 0、`lib/client.js` 28380 B；代码基线仍是 `b2c9402`，本轮提交只动 docs/记忆/技能。
- host/生效判据已由 tracked 技能 `dsh-host-build-restart-verify` 承载；记忆里那条 1.1KB 的 host 身份段被压成指针，第 7 行的悬空交叉引用一并修掉。
- 当天出现**两次**「新技能未经 stage」：`dsh-artifact-claim-verification`（16:32）与 `dsh-nix-desktop-launcher-artifact-verify`（17:17），都由并发会话直接写进 `.agents/skills/`，git 里只显示 `??`、不报错；后者核对 frontmatter/章节结构/无密钥后已提交，盘与跟踪现 12 = 12。
- 教训（自身踩过）：按前缀 `replace` 的行内改写只换前半句，把 `CONTEXT.md` 那行拼出重复残尾——改写后必须读回该行并检查「同一句出现两次」，而不是只看替换「成功」。
- `/etc/nixos` 有 3 个文件（`hosts/.../services/dae.nix`、`dae/config.dae`、`easytier.nix`）是另一个会话正在改的网络线，本会话未触碰，也不应混入本轮去重提交。

## Open tasks

- **已裁决（2026-09-26）：autolearn 候选 `dsh-session-log-user-correction-recovery.md` 维持候选。** 它只由 1 个会话（`session-8256f99d`）证实，未达本仓写入的提升门槛（`MIN_SKILL_SESSIONS = 2` / `MIN_CANDIDATE_SESSIONS = 1`），按机制自身的规则不提升。**再评估触发**：出现第二个可验证复现该流程的归档会话（判据是在 `session-logs/` 里找到「用户自称此前纠正过、且靠 `user/message` 与 `source.kind == "user"` 恢复」的第二个 session id），把它加进候选的 `evidence:` 注释行。不提升不等于遗忘：它仍在候选队列，autolearn 每次 pass 都会读到它。
- **已裁决：交付线题材的技能留在本仓**（用户 2026-09-26 明确「非本仓不用管」）。`dsh-nix-desktop-launcher-artifact-verify` 与 `dsh-host-build-restart-verify` 的题材属于 `/etc/nixos` 的交付链，但技能机制只在本仓存在（`/etc/nixos` 没有 `.agents/skills/`），技能又是给**本仓** agent 的操作规程，故不搬迁；交付线的**事实**仍只在 `/etc/nixos`（见 Commits 里那条指针）。
- **已落地：把「新技能未 stage」的核对写进技能本身（2026-09-26）。** `dsh-project-context-concurrent-writer-guard` 第 6 步现在区分**瞬态**未跟踪项（`session-logs/`、`skill-candidates/`、`memory.jsonl`、`thinking-effort-loaded.json`）与**非瞬态的未跟踪技能**，并要求每次提交前对比盘上技能目录与 `git ls-files` 的技能清单、读完新文件（frontmatter / 章节 / 密钥样式）再入库。当天两次漏掉（16:32、17:17）正是这条的失败模式。
- **已关闭：`rejectionReason` 的覆盖缺口**（2026-09-26）。审计口径过期一半：`runHandoff` 已不存在、`statusText` 早有直接断言；真正缺的「非法名字 / 候选无归档证据 / 候选已存在」三个分支已通过 pass 路径钉住（`9bd452c`，三个有效变异体）。同时纠正了源码里「名字由调用方校验」的错误注释——`parseAutolearn` 只要求 `typeof name === "string"`。
- 留意记忆 cap 余量（约 6K）；下次 consolidation 前以 `loadMemory(root, 32000)` 与 `isMemoryTruncated(loaded.text) === false`、`damaged`/`poisoned` 为准，记录轮次而非精确字节。
- ~~清理 `CONTEXT.md` 里 `docs/upstream-pi-triage.md` 那条已自我作废的过期措辞~~ **已消解：那句话已不在文件里**（本会话重写 CONTEXT 时删掉，全库 grep 0 命中），这条待办本身是空转，删除。
- **Residual（不在本仓，用户已明确不处理）**：upstream dsh core 把 `discovery.ts` 的 `capacity()` 拆成「声明总窗口」+「可用输入上限」，`qualityLimit` 的上游分支才能接线；pi 侧 `resolveThreshold` 的 `!model || usage.tokens === null` 与截断重试守卫的覆盖。

<!-- latest-session-title: dsh-project-context — 交付线撤出本仓、第二个未跟踪技能入库 -->
