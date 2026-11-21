# Project Context

Last updated: 2026-11-21T12:11:04.450Z

## Summary

本会话从 session-ce640169 交接，收尾批次 AA。已推送：AA3 会话日志核（`9a5062d`）、AA4 技能核（`b758772`）、`anchors.ts` 迁到 `src/shared/`、`db357b1` 收口 `abandoned`/`moved`/受管技能分母三条残余，`450de13` 把 expiry 折进唯一状态裁定者。用户在 20:02:28 重启 desktop 宿主后按序跑了四条命令并全部成功：`/session-log status` 报 212 会话、209 healthy（11 live、198 settled）、3 abandoned；`/autolearn status` 报 18 of 40（22 手写）全 unbaselined；`/autolearn bind` 记 12 个技能、30 个引用文件；`/memory reconcile` 报 9 of 195 需复核。用只读探针复算 bind 后状态：1 intact、11 orphan、6 仍 unbaselined，`drifted`/`moved`/`expired` 全 0，说明基线记下后无代码漂移。由此抓到一个真缺口：`bindableAnchors` 故意跳过 `lib/`、`.agents/memory/` 与项目根外绝对路径，那 6 个技能引用的恰好只有这些，所以永远绑不上，而 `status` 印「no fingerprint was recorded when it was promoted」，与「bind 从没跑过」无法区分。`errors.log` 重启后只多 5 行旧实例 dispose 噪声。三件等用户拍板：AA5 是否现在做、工作区里那版中文记忆文档怎么提交、9 条 content-stale 怎么处理。

## Key points

- `/session-log status` 实读：212 session(s) — 209 healthy (11 live, 198 settled), 3 needing a repair；3 条 `abandoned` 都是 10 天前零人类回合的交接子会话，与设计一致。
- `/autolearn bind` 实读：recorded a baseline for 12 skill(s) (30 cited file(s))；bind 后 `counts {"unbaselined":6,"expired":0,"moved":0,"drifted":0,"orphan":11,"intact":1} total 40 unmanaged 22`。
- 11 条 `orphan` 不是翻译损失：逐条比过 HEAD（英文版）与工作区，这 12 个已补基线的技能在英文版里同样是 0 处 MEMORY.md/CONTEXT.md 路径引用。
- `/memory reconcile` 实读：9 of 195 entries have a reason to re-verify；上一轮是 6，多出的 `fa5`、`528`、`f89` 引用的正是本批改过的文件，属「条目写在提交之前」的正常过期。
- 真缺口：`bindableAnchors`（`src/project-autolearn/skill-state-source.ts:77-93`）跳过 `lib/`、`.agents/memory/`、项目根外绝对路径；6 个技能（dsh-batch-landing-acceptance-audit、dsh-memory-budget-fit-offline-verify、dsh-project-context-pre-restart-turn、dsh-core-mechanism-liveness-verify、dsh-subagent-codex-model-pin、-verify）引用的恰好只有这些，永远绑不上。
- 缺口在报告不在规则：跳过 `lib/` 是对的（下次构建就全变 drifted），错的是 bind 只说「记了 12 条」不说「6 条没有可绑路径」，status 也把两者印成同一句。
- 拟修法（AA5，未开工）：`bindSkills` 返回 `skipped: [{name, reason}]` 并让回执第二行点名，`SkillFacts` 加 `bindable` 计数，让 status 把那 6 条印成「没有可绑锚点」；要动 `src/` + 测试 + 变异 + 重建 + 抬 pin + 再重启。
- 验收证据：四条命令是在 20:02:28 启动的新宿主上跑的（事件日志里 `command/run|done` 成对），回执只可能来自 `db357b1`，无需再证明加载。
- `errors.log` 重启后只多 5 行 `cannot get required service "llm" in inactive context`（12:02:25Z，旧实例 dispose 噪声），无新缺陷签名。
- 工作区还余插件自己写的 `.agents/memory/{MEMORY.md,CONTEXT.md,.gitignore,retired.md}`；那版 `MEMORY.md` 是 19:44 pass 把 HEAD 的英文版（50,925 字符 / 195 条）翻回中文（33,322 字符）的结果，翻译过程掉了约 10 个代码标识符。
- 宿主注入的上下文已过 400,000 阈值；自动交接只在 `turn/end` 评估，所以本会话的结论全部落在 `db357b1` 与 spec 里，新会话可直接接上。

## Open tasks

- 用户侧决策：AA5 是否现在做——修 `bindableAnchors` 的报告缺口（`bindSkills` 返回 `skipped`、`SkillFacts` 加 `bindable`），要动 `src/` + 测试 + 变异 + 重建 `lib/` + 抬 profile pin + 再重启一次。
- 用户侧决策：工作区那版中文 `MEMORY.md`（33,322 字符 / 195 条，掉了约 10 个标识符）怎么处理——(a) 原样提交、(b) 补回标识符再提交（助手倾向）、(c) 不提交。
- 用户侧决策：9 条 content-stale（如 `dc5`、`af0`、`ef8`）逐条 `/memory reconcile --accept <id>` 确认，或等整理 pass 改写正文；`--accept` 只记录基线，不改写正文。
- 用户侧：重启后若要看状态，按序跑 `/session-log status`、`/autolearn status`、`/memory reconcile`；期望与上表读数一致（会话数会因归档本会话而增长）。
- SH-10 剩余未知：交接时刻插件能否拿到空闲 agent 句柄以调 `ctx.compaction.compactNow`；未验证前不得写成承诺。
- `context-injection.test.mjs` 偶发失败仍未定性，需在无并发写入时复现。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）未拍板，需用户定范围；可选的 `dsh-code-index` 兼容性试验未开始。
- AOCI 可选动作 A（`/tmp` 克隆里只读试用，scope 到 `src/project-handoff/`）与 B（接入为可选插件）均未启动，需用户决定；AA5/AA6 除上述缺口外未排期。
- 每次改 profile 设置或重启前复读 `cordis.patch.yml` 的 `maxMemoryChars`（当前 52000）与 `subagent-codex` 的 `model` 一行，防设置卡整份回写冲掉手改值。

<!-- latest-session-title: 批次 AA 收尾：四个状态核上线并在新宿主上验收，抓到技能基线绑不上的报告缺口 -->
