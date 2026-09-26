# Project Context

Last updated: 2026-09-26T09:23:52.997Z

## Summary

把「插件怎么交付到本机」这条线从本仓记忆里整体撤出，只留一行指针（权威副本在 `/etc/nixos` 的 `scripts/dsh-plugin-patches/PINNING-RISK.md` 与 `log.md` §1.10-**67** —— 交付线条目（条目头「桌面端 pre-boot 补丁体检接线」）；该编号曾与网络条撞号，重编的是**网络那条**（67→68，`d47bd4d`），交付线仍在 67（本轮曾把它改反成 68，被独立审核证伪）——**按条目头内容找、别信编号**）。删副本前逐条 grep 验证过指针覆盖齐全（`save-exact`、检查项 5、`command -v` 自证、`set -euo pipefail` 守卫、`pre-boot`、`patch-check.log`、`DSH_DESKTOP_PATCH_CHECK`、`DSH_PROFILES_ROOT`、每日 06:20 单元、`0.11.9` 全在）；删除后本仓不再保留那份**事实叙述**；那些串仍留在**这两份记忆文件自己的几行**里，**只有 `DSH_PROFILES_ROOT` 另在操作技能的一步中出现**。**这里刻意不写次数**：「0 命中」与随后的「出现两次」都被独立审核用 `git grep -oF` 当场证伪——要查就现查。同时把「本机验证环境」1.1KB 的 host 身份段压成指向 tracked 技能 `dsh-host-build-restart-verify` 的指针，并修掉一处改名后的悬空交叉引用。记忆体量**只在 MEMORY.md 的记忆 cap 节记一份**（本轮曾在两处各写一个数字，结果同一提交里两处互相矛盾——所以这里不写数字，`loadMemory(root, 32000)` 现查），`truncated:false` / `damaged:0` / `poisoned:false`，12 节结构与全部插件侧不变量仍在。门禁重跑 0/0/**226**。另外抓到当天第二例「并发会话直接写进 `.agents/skills/`、没有任何东西 stage」的新技能，核对 frontmatter/结构/无密钥后入库；盘与跟踪现为 12 = 12。过程里自身踩过一次坑：按前缀 replace 的行内改写把 `CONTEXT.md` 拼出重复残尾，读回确认后整行重写并加了「同一句出现两次」检查。

## Key points

- 交付线撤出：本仓只留指针，权威副本在 `/etc/nixos` 的 `PINNING-RISK.md` / `log.md` §1.10-67（交付线条目；重编的是网络那条 67→68，交付线仍在 67——按内容找）；删前逐条 grep 验证覆盖；删后**事实叙述**只剩一份指针，那些串仍留在记忆文件自身的几行与技能的一步里（只有 `DSH_PROFILES_ROOT` 在技能里），**不写次数，用 `git grep -oF` 现查**。只留一条与插件代码有关的：`dsh-client-auto-continue` 补丁本机自维护、0.11.8、客户端半已删（上游改用 `ctx.configForms`）。
- 记忆实测：**这里不写数字**（与 MEMORY.md 各写一份就必然分叉——本轮就是这么被抓到的）；用 `loadMemory(root, 32000)` + `isMemoryTruncated` 现查，量级与 12 节结构见 MEMORY.md 的记忆 cap 节；插件侧不变量（`shapeRejection`、knee 公式、`SAFETY_MARGIN_TOKENS`、记忆 cap API、跟踪边界、`ctx.configForms`）逐条 grep 仍在。**记录值已被独立审核证伪两次（任何写死的具体数字都只在某一刻为真）——只记量级，每次现查。**
- 门禁（2026-09-26 重跑）：typecheck 0、build 0、**226/226** tests、`lib/` mutant markers 0、`lib/client.js` 28380 B；**代码基线 = 最后一个碰 `src/` 的提交（现 `cf5b61c`，只改注释）；功能基线 = `a627eb5`（approve 路径描述上限）——两者不是同一个提交，用 `git log -1 --oneline -- src/` + `git show --stat` 现查**；本轮提交确实动过 `src/` 与 `test/`，先前「只动 docs/记忆/技能」的说法自 `9bd452c` 起就不成立。
- host/生效判据已由 tracked 技能 `dsh-host-build-restart-verify` 承载；记忆里那条 1.1KB 的 host 身份段被压成指针，第 7 行的悬空交叉引用一并修掉。
- 当天出现**两次**「新技能未经 stage」：`dsh-artifact-claim-verification`（16:32）与 `dsh-nix-desktop-launcher-artifact-verify`（17:17），都由并发会话直接写进 `.agents/skills/`，git 里只显示 `??`、不报错；后者核对 frontmatter/章节结构/无密钥后已提交，盘与跟踪现 12 = 12。
- 教训（自身踩过）：按前缀 `replace` 的行内改写只换前半句，把 `CONTEXT.md` 那行拼出重复残尾——改写后必须读回该行并检查「同一句出现两次」，而不是只看替换「成功」。
- `/etc/nixos` 有 3 个文件（`hosts/.../services/dae.nix`、`dae/config.dae`、`easytier.nix`）是另一个会话正在改的网络线，本会话未触碰，也不应混入本轮去重提交。

## Open tasks

- 留意记忆 cap 余量（**用 API 现查，不写死数字**）；下次 consolidation 前以 `loadMemory(root, 32000)` 与 `isMemoryTruncated(loaded.text) === false`、`damaged`/`poisoned` 为准。**只记轮次与量级——本轮两次拿文件字节数顶替 API 值，两次都过期。**
- autolearn 候选 `dsh-session-log-user-correction-recovery.md` **维持候选**（只 1 个会话证实，未达本仓 2 会话门槛）。**再评估触发**：出现第二个可复现该流程的归档会话，把它加进候选的 `evidence:` 行。
- **Residual（不在本仓，用户已明确不处理）**：upstream dsh core 把 `discovery.ts` 的 `capacity()` 拆成「声明总窗口」+「可用输入上限」，`qualityLimit` 的上游分支才能接线；pi 侧 `resolveThreshold` 的 `!model || usage.tokens === null` 与截断重试守卫的覆盖。
- 本轮已闭合（一行备查，不再逐条占位）：交付线事实撤出留指针（`ee3f632`）、第二个未跟踪技能入库（`f4fb825`）、技能核对写进 guard 技能（`188f5a4`）、准入分支补钉（`9bd452c`）、描述上限在 approve 路径可达（`a627eb5`）、独立审核抓到的顺序/解析器钉与文档诚实性问题（`cf5b61c` 起的提交）。


<!-- latest-session-title: dsh-project-context — 交付线撤出本仓、第二个未跟踪技能入库 -->
