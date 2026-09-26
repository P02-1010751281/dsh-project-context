# Project Context

Last updated: 2026-09-26T15:16:49.221Z

## Summary

把「插件怎么交付到本机」这条线从本仓记忆里整体撤出，只留一行指针（权威副本在 `/etc/nixos` 的 `scripts/dsh-plugin-patches/PINNING-RISK.md` 与 `log.md` §1.10-**67** —— 交付线条目（条目头以「桌面端 pre-boot 补丁体检接线」开头）；该编号曾与网络条撞号，重编的是**网络那条**（67→68，`d47bd4d`），交付线仍在 67（本轮曾把它改反成 68，被独立审核证伪）——**按条目头内容找、别信编号**）。删副本前逐条 grep 验证过指针覆盖齐全（`save-exact`、检查项 5、`command -v` 自证、`set -euo pipefail` 守卫、`pre-boot`、`patch-check.log`、`DSH_DESKTOP_PATCH_CHECK`、`DSH_PROFILES_ROOT`、每日 06:20 单元、`0.11.9` 全在）；删除后本仓不再保留那份**事实叙述**；那些串仍留在**这两份记忆文件自己的几行**里，**操作技能里也点名了若干**（`dsh-nix-desktop-launcher-artifact-verify/SKILL.md` 至少含 `pre-boot`、`command -v`、`DSH_PROFILES_ROOT`）——**别写「只有 X」**，现查 `git grep -oF <string> -- .agents/skills/`。**这里刻意不写次数**：「0 命中」与随后的「出现两次」都被独立审核用 `git grep -oF` 当场证伪——要查就现查。同时把「本机验证环境」1.1KB 的 host 身份段压成指向 tracked 技能 `dsh-host-build-restart-verify` 的指针，并修掉一处改名后的悬空交叉引用。记忆体量**只在 MEMORY.md 的记忆 cap 节记一份**（本轮曾在两处各写一个数字，结果同一提交里两处互相矛盾——所以这里不写数字，`loadMemory(root, 32000)` 现查），`truncated:false` / `damaged:0` / `poisoned:false`，12 节结构与全部插件侧不变量仍在。当时门禁重跑 0/0/**226**（本文件更新时现查 0/0/**229**，见 Key points）。另外抓到当天又一批「并发会话直接写进 `.agents/skills/`、没有任何东西 stage」的新技能，核对 frontmatter/结构/无密钥后入库；盘与跟踪一致（现查 `ls -d .agents/skills/*/` 对 `git ls-files '.agents/skills/**/SKILL.md'`）。过程里自身踩过一次坑：按前缀 replace 的行内改写把 `CONTEXT.md` 拼出重复残尾，读回确认后整行重写并加了「同一句出现两次」检查。

## Key points

- 交付线撤出：本仓只留指针，权威副本在 `/etc/nixos` 的 `PINNING-RISK.md` / `log.md` §1.10-67（交付线条目；重编的是网络那条 67→68，交付线仍在 67——按内容找）；删前逐条 grep 验证覆盖；删后**事实叙述**只剩一份指针，那些串仍留在记忆文件自身的几行与**操作技能的若干步**里（**不止** `DSH_PROFILES_ROOT`——`pre-boot`、`command -v` 也在），**不写次数、也别写「只有 X」，用 `git grep -oF` 现查**。只留一条与插件代码有关的：`dsh-client-auto-continue` 补丁本机自维护、0.11.8、客户端半已删（上游改用 `ctx.configForms`）。
- 记忆实测：**这里不写数字**（与 MEMORY.md 各写一份就必然分叉——本轮就是这么被抓到的）；用 `loadMemory(root, 32000)` + `isMemoryTruncated` 现查，量级与 12 节结构见 MEMORY.md 的记忆 cap 节；插件侧不变量（`shapeRejection`、knee 公式、`SAFETY_MARGIN_TOKENS`、记忆 cap API、跟踪边界、`ctx.configForms`）逐条 grep 仍在。**记录值已被独立审核证伪两次（任何写死的具体数字都只在某一刻为真）——只记量级，每次现查。**
- 门禁（2026-09-26 现查）：typecheck 0、build 0、**229/229** tests、`lib/` mutant markers 0、`lib/client.js` 28380 B；**代码基线 = 最后一个碰 `src/` 的提交（现 `cf5b61c`，只改注释）；功能基线 = `a627eb5`（approve 路径描述上限）——两者不是同一个提交，用 `git log -1 --oneline -- src/` + `git show --stat` 现查**；本轮只新增 `test/`（未动 `src/`）。
- 委派闸门：三个插件的 `isTopLevel`（memory/autolearn 的 `agent/status`+`agent/disposed`、handoff 的 `session/event`）此前**没有任何测试钉住**，现由 `test/top-level-gate.test.mjs` 覆盖（每个插件一条，负例 + 同 fixture 的正对照），六个变异体全杀。同时更正上一轮那条过度告警：上游 `SessionHeader.origin` 是**闭合字面量** `'subagent'`、每个 session-format 编解码器都拒绝别的值，所以乐观默认不会静默失效，**不需要**收紧默认。注意 handoff 里 `retireIfPending` 在闸门**之前**是有意的。
- host/生效判据已由 tracked 技能 `dsh-host-build-restart-verify` 承载；记忆里那条 1.1KB 的 host 身份段被压成指针，第 7 行的悬空交叉引用一并修掉。
- 「新技能未经 stage」在当天反复出现（`dsh-artifact-claim-verification`、`dsh-nix-desktop-launcher-artifact-verify`、`dsh-doc-claim-closure-review`）：并发会话把技能直接写进 `.agents/skills/`，git 里只显示 `??`、不报错，只在 clone 时暴露；每个都核对 frontmatter/章节结构/无密钥后入库，盘与跟踪一致（现查 `ls -d .agents/skills/*/` 对 `git ls-files '.agents/skills/**/SKILL.md'`）。
- 教训（自身踩过）：按前缀 `replace` 的行内改写只换前半句，把 `CONTEXT.md` 那行拼出重复残尾——改写后必须读回该行并检查「同一句出现两次」，而不是只看替换「成功」。
- `/etc/nixos` 有 3 个文件（`hosts/.../services/dae.nix`、`dae/config.dae`、`easytier.nix`）是另一个会话正在改的网络线，本会话未触碰，也不应混入本轮去重提交。

## Open tasks

- 留意记忆 cap 余量（**用 API 现查，不写死数字**）；下次 consolidation 前以 `loadMemory(root, 32000)` 与 `isMemoryTruncated(loaded.text) === false`、`damaged`/`poisoned` 为准。**只记轮次与量级——本轮两次拿文件字节数顶替 API 值，两次都过期。**
- autolearn 候选 `dsh-session-log-user-correction-recovery.md` **维持候选**（只 1 个会话证实，未达本仓 2 会话门槛）。**再评估触发**：出现第二个可复现该流程的归档会话，把它加进候选的 `evidence:` 行。
- **Residual（不在本仓，用户已明确不处理）**：upstream dsh core 把 `discovery.ts` 的 `capacity()` 拆成「声明总窗口」+「可用输入上限」，`qualityLimit` 的上游分支才能接线；pi 侧 `resolveThreshold` 的 `!model || usage.tokens === null` 与截断重试守卫的覆盖。
- 本轮已闭合（一行备查，不再逐条占位）：交付线事实撤出留指针（`ee3f632`）、第二个未跟踪技能入库（`f4fb825`）、技能核对写进 guard 技能（`188f5a4`）、准入分支补钉（`9bd452c`）、描述上限在 approve 路径可达（`a627eb5`）、独立审核抓到的顺序/解析器钉与文档诚实性问题（`cf5b61c` 起的提交）。


<!-- latest-session-title: dsh-project-context — 交付线撤出本仓、第二个未跟踪技能入库 -->
