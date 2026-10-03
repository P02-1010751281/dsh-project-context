# Project Context

Last updated: 2026-10-02T19:55:00+08:00

## Summary

把「插件怎么交付到本机」这条线从本仓记忆里整体撤出，只留一行指针：权威副本在 `/etc/nixos` 的 `scripts/dsh-plugin-patches/PINNING-RISK.md` 与 `log.md` 里那条交付线条目（条目头以「桌面端 pre-boot 补丁体检接线」开头）——**按条目头内容找、别信编号**（该编号曾与网络条撞号，被重编的是网络那条）。删副本前逐条 `git grep` 验证过指针覆盖齐全；删除后本仓不再保留那份**事实叙述**，其中一部分串仍留在**两份记忆文件自己的几行**里、**操作技能里也点名了若干**（**哪些仍在、各在哪，现查** `git grep -oF <string> -- .agents/`）。**这份文件刻意不写具体数字**：任何写死的值都只在一刻为真，要查就现查——记忆体量与节数用 `loadMemory(root, 32000)` 与 `isMemoryTruncated(loaded.text)` 现读，不写字符数或节数。同时把「本机验证环境」那段压短并指向 tracked 技能 `dsh-host-build-restart-verify`（**仍带细节，不是纯指针**），并修掉一处改名后的悬空交叉引用。过程里自身踩过一次坑：按前缀 replace 的行内改写把 `CONTEXT.md` 拼出重复残尾，读回确认后整行重写并加了「同一句出现两次」检查。

## Key points

- 交付线撤出：本仓只留指针，权威副本在 `/etc/nixos` 的 `PINNING-RISK.md` / `log.md`（交付线条目按条目头内容找，别信编号）；删前逐条 grep 验证覆盖；那些串仍留在记忆文件自身的几行与**操作技能的若干步**里（**不止** `DSH_PROFILES_ROOT`——`pre-boot`、`command -v` 也在），**不写次数、也别写「只有 X」，用 `git grep -oF` 现查**。只留一条与插件代码有关的：`dsh-client-auto-continue` 补丁本机自维护、客户端半已删（上游改用 `ctx.configForms`）。
- 记忆实测：**这里不写数字**（与 MEMORY.md 各写一份就必然分叉）；用 `loadMemory(root, 32000)` + `isMemoryTruncated` 现查，节数与量级见 MEMORY.md 的记忆 cap 节；插件侧不变量（`shapeRejection`、knee 公式、`SAFETY_MARGIN_TOKENS`、记忆 cap API、跟踪边界、`ctx.configForms`）逐条 grep 仍在。
- 门禁：**不写死数值**——现跑 `pnpm typecheck` / `pnpm build` / `pnpm test` 看通过数与用例数，`lib/` 的 mutant marker 应为 0，`lib/client.js` 大小现看 build 输出。**代码基线 = `git log -1 --oneline -- src/`；功能基线 = 最后一个改行为的 `src/` 提交（`git log --oneline -- src/` + `git show --stat` 现查）**——两者可能不是同一个提交。
- 委派闸门：`isTopLevel` 现在**四个插件**都过（memory/autolearn 的 `agent/status`+`agent/disposed`、handoff 的 `session/event`、project-context 的四个归档写入点），由 `test/top-level-gate.test.mjs` 覆盖（每个插件至少一条，负例 + 同 fixture 的正对照），变异体全杀——**调用点与用例数量别写死，现查** `git grep -c 'isTopLevel(' -- src/project-*/index.ts` 与 `grep -cE '^test\(' test/top-level-gate.test.mjs`。上游 `SessionHeader.origin` 是**闭合字面量** `'subagent'`、每个 session-format 编解码器都拒绝别的值，所以乐观默认不会静默失效，**不需要**收紧默认。注意 handoff 里 `retireIfPending` 在闸门**之前**是有意的。
- host/生效判据已由 tracked 技能 `dsh-host-build-restart-verify` 承载；记忆里那条 host 身份段已压短并指向该技能（**仍带细节，不是纯指针**），并修掉一处改名后的悬空交叉引用（**不写行号**，行号会随每次编辑过期）。
- 「新技能未经 stage」会反复出现：并发会话把技能直接写进 `.agents/skills/`，git 里只显示 `??`、不报错，只在 clone 时暴露；发现后核对 frontmatter / 章节结构 / 无密钥再入库。核对办法：`ls -d .agents/skills/*/` 对 `git ls-files '.agents/skills/**/SKILL.md'` 逐目录比对，**不记数字**。
- 教训（自身踩过）：按前缀 `replace` 的行内改写只换前半句，把 `CONTEXT.md` 那行拼出重复残尾——改写后必须读回该行并检查「同一句出现两次」，而不是只看替换「成功」。
- `/etc/nixos` 里另有文件（`hosts/.../services/dae.nix`、`dae/config.dae`、`easytier.nix`）属另一个会话正在改的网络线，本仓会话不应把它们混进来。

## Open tasks

- 留意记忆 cap 余量（**用 API 现查，不写死数字**）；以 `loadMemory(root, 32000)` 与 `isMemoryTruncated(loaded.text) === false`、`damaged` / `poisoned` 为准。**只记轮次与量级。**
- **技能集整理（2026-10-03 已做）**：候选队列现已清空——`dsh-session-log-user-correction-recovery` 的**第二起独立事件**成立（09-27 用户贴出上下文面板 → 提交 `3837cc1` 反着记 → 10-02 用户纠正 → 提交 `e3aea8d` 替换；旧的「无第二起」是关键词扫描的假象），已**提升为 tracked 技能**；`dsh-memory-context-consolidation` 与 `dsh-tracked-memory-consolidation-edit` 是同一套流程的两个名字，已并入 `dsh-project-memory-cap-guard` 并删除（无规则丢失）。技能集审计（用途表 / 重叠矩阵 / 陈旧引用）在 `.agents/evidence/2026-10-03-skill-corpus-audit/audit.md`；**后续轮已执行 M3**——scoped-commit 规则单一归属 `dsh-project-context-concurrent-writer-guard` 第 5 步、其余 6 份改成同一句指针（`/etc/nixos` 的 launcher 那份故意保留），并修掉该轮漏查的两处残余——但第三处（`pi-to-dsh-feature-port` frontmatter）只是提交信息声称修了、diff 里没落地，本轮补上并更正 §7；**M5/M6 已执行**：共享验证句归 `dsh-artifact-claim-verification` §9、session-event 不变量归 `dsh-session-store-maintenance`，其余为同一句指针，规则 token 仍内联。
- `0.2.0-rc.2` 升级：**判据已备，等用户决定 `home-manager switch` 的时机与桌面端重启归属**。证据 + 复跑脚本在 `.agents/evidence/2026-10-03-dsh-020rc2-api-compat/`（四个插件两半对 0.2.0 类型 0 错且控制线绿；desktop/web 声明 bundle 全过 peer 闸；**web 本就已钉 `0.2.0-rc.2`**，而 ctxdev/headless 的 `dsh-experimental-agent-team*@0.1.6-alpha.1` 会在新线被 disabled）。`dsh-rewind-plugin` 只在真正切到新线之后再谈装回。ctxdev/headless 的清理**方案已写**（同目录 `agent-team-pin-cleanup.md`：推荐删掉那份本地依赖、让装在 dsh 里的同名包生效，**只写方案未执行**），等用户决定时机。
- **第三方技能语料（不在本仓）**：`~/.agents/skills` 是另一个 git 仓库（remote 在 Forgejo，branch `master`），现查 **51 个技能目录** = 41 个 lock 管理（`.skill-lock.json`，16 个上游 GitHub 仓）+ 2 个 tracked 但不在 lock（`academic-paper-writing`、`llm-wiki-skill`）+ 8 个本机技能（**2026-10-03 已本地入库、未推送**，含 `dsh-pi-ai-guard-nix-patch` 的一处死路径修正）；审计在 `.agents/evidence/2026-10-03-third-party-skill-corpus-audit/audit.md`。**计数按顶层目录名比对，别数 SKILL.md**（`llm-wiki-skill/` 内嵌 3 个，文件数会多于目录数）。**别手改 vendored 技能**：lock 的 `skillFolderHash` 是上游来源标识、不是本地完整性检查。
- **Residual（不在本仓，用户已明确不处理）**：upstream dsh core 把 `discovery.ts` 的 `capacity()` 拆成「声明总窗口」+「可用输入上限」，`qualityLimit` 的上游分支才能接线；pi 侧 `resolveThreshold` 的 `!model || usage.tokens === null` 与截断重试守卫的覆盖。
- 已闭合项（不再逐条占位；历史提交用 `git log --oneline` 现查，不在此写 hash）：交付线事实撤出留指针；未跟踪技能入库；技能核对写进 guard 技能；准入分支补钉；描述上限在 approve 路径可达；独立审核抓到的顺序 / 解析器钉与文档诚实性问题。
- 2026-10-02 收尾：写侧 seed 自带 kind（`dsh-project-context`）+ 读侧跳过 handoff 横幅已落地并经**运行时验证**（本机一次真实交接的子会话首条 seed 即 `{kind:"dsh-project-context"}` 且无 `rpcId`）；MEMORY.md 压掉闭合审计叙述以恢复 cap 余量。细节见 `CHANGELOG.md` 未发布段与 MEMORY.md。


<!-- latest-session-title: dsh-project-context — 交付线撤出本仓、第二个未跟踪技能入库 -->
