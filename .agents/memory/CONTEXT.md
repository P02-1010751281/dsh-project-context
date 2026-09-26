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

- 裁决 autolearn 候选 `dsh-session-log-user-correction-recovery.md`：只由 1 个会话（`session-8256f99d`）证实，未达 2 会话提升门槛；提升为 `.agents/skills/<name>/SKILL.md` 还是继续留在候选队列由用户决定。
- 裁决交付线题材的技能归属：`dsh-nix-desktop-launcher-artifact-verify` 的题材属于已撤出本仓的交付线，但被留在本仓跟踪（理由：技能是给本仓 agent 的操作规程，且技能机制只在本仓存在）；若要按题材搬到 `/etc/nixos`，需先定「搬到哪、由谁发现」。
- 每次提交前核对技能入库状态：`ls -d .agents/skills/*/` 与 `git ls-files '.agents/skills/**/SKILL.md'` 逐目录对比——当天已出现两次未跟踪的新技能，这是这条边界唯一会静默失效的方式。
- 留意记忆 cap 余量（现约 7.8K）；下次 consolidation 前以 `loadMemory(root, 32000)` + `isMemoryTruncated(loaded.text) === false` 与 `damaged`/`poisoned` 为准，记录轮次而非精确字节。
- 清理 `CONTEXT.md` 里 `docs/upstream-pi-triage.md` 那条已自我作废的过期措辞（已被自身划掉并注明早已入库 `01809c5`）——删除还是留作历史待定。
- Upstream（dsh core，不在本仓）：把 `discovery.ts` 的 `capacity()` 拆开，使「声明的总窗口」与「可用输入上限」成为两个字段；只有那之后 `qualityLimit` 的上游分支才能接线。

<!-- latest-session-title: dsh-project-context — 交付线撤出本仓、第二个未跟踪技能入库 -->
