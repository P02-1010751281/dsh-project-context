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
- autolearn 候选 `dsh-session-log-user-correction-recovery.md` **维持候选**（证据会话数未达本仓 2 会话门槛——**不写死数字，现读该候选文件的 `evidence:` 行**；文件在本地未跟踪的 `.agents/memory/skill-candidates/`）。**再评估触发**：出现第二个可复现该流程的归档会话，把它加进候选的 `evidence:` 行。
- **Residual（不在本仓，用户已明确不处理）**：upstream dsh core 把 `discovery.ts` 的 `capacity()` 拆成「声明总窗口」+「可用输入上限」，`qualityLimit` 的上游分支才能接线；pi 侧 `resolveThreshold` 的 `!model || usage.tokens === null` 与截断重试守卫的覆盖。
- 已闭合项（不再逐条占位；历史提交用 `git log --oneline` 现查，不在此写 hash）：交付线事实撤出留指针；未跟踪技能入库；技能核对写进 guard 技能；准入分支补钉；描述上限在 approve 路径可达；独立审核抓到的顺序 / 解析器钉与文档诚实性问题。
- 2026-10-02 收尾：写侧 seed 自带 kind（`dsh-project-context`）+ 读侧跳过 handoff 横幅已落地并经**运行时验证**（本机一次真实交接的子会话首条 seed 即 `{kind:"dsh-project-context"}` 且无 `rpcId`）；MEMORY.md 压掉闭合审计叙述以恢复 cap 余量。细节见 `CHANGELOG.md` 未发布段与 MEMORY.md。


<!-- latest-session-title: dsh-project-context — 交付线撤出本仓、第二个未跟踪技能入库 -->
