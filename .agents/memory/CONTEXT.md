# Project Context

Last updated: 2026-10-11T12:18:48.437Z

## Summary

本会话从 `session-39f6d504` 自动交接续接，接手时确认父会话最后那步并未失败：`check.mjs` 正常返回后该轮以最终回答 + `turn/end`（10:00:52.562Z）收尾，故只做状态核对、未重跑。工作区当时干净，HEAD = origin = `ef15553`，加载判据 POSITIVE（六批 N/O/Q/R/Q2/S 全部在线），`lib/` 与 `src/` 自 `0bf0b31` 起未变，[share-fit.mjs](.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs) 三计数全 0 且逐字节往返一致，`errors.log` 的 `MissingSessionID` 行数未增。 本轮唯一的落地改动是补上父会话漏掉的机械判据：批次 S 的见证规则要求「必须走 opencode 路由」，但没有说怎么**证明**那一次真走的是该路由——而在默认 `command-code` 上跑同一个命令必然不报错（该路线拿不到 `withOpenCodeSessionHeader` 包装），那是假通过。新增的可执行核对是折叠会话日志里最后一条 `request/header`：`zstd -dc ~/.dsh/sessions/<slug>/<session>/session.v4.jsonl.zstd | grep '^{"type":"request/header"' | tail -1` → `data.header.config.provider` 必须等于目标路由。正负对照现跑：`session-b2a9894b` 折出 `opencode-go`、`session-d435cad7` 折出 `command-code`，与 forensics 探针从同一批事件得出的结论一致，证明探针非空跑。 该核对写入两条：`.agents/skills/dsh-post-restart-acceptance-probe/SKILL.md`（那条 route pitfall 旁）与 `.agents/memory/CONTEXT.md` 的批次 S 见证 Open task（补命令 + 对照）。提交 `1219d13` 已推送 origin/main；只动 docs/skill，`git diff 0bf0b31..HEAD -- src lib` 空，故加载判据不受影响；改后 [measure.mjs](.agents/evidence/2026-10-07-context-section-balance/measure.mjs) 现跑仍 fixpoint、无 clip、每段 ≤ 自身份额 90%（Open tasks 29.1%）。 `MEMORY.md` 刻意未碰：其压缩属于「下次写入前」的事，而任何手改都会在用户那次 pass 里触发 `adopted an externally edited MEMORY.md` 归因噪音——正是见证要读的日志。 球现在在用户手上：批次 S 的端到端见证。除此之外本会话没有待我推进的项。

## Key points

- 父会话末步无失败：`check.mjs` 正常返回 → 最终回答 → `turn/end` 10:00:52.562Z；本轮只核对状态，未重跑 `check.mjs`。
- 接手核对（现跑，不写死）：工作区 `git status --short` 空、HEAD = origin = `ef15553`；`git diff 0bf0b31..HEAD -- src lib` 空 ⇒ 加载判据不受本轮 docs/skill 改动影响。
- 加载判据 POSITIVE：`check.mjs` 逐批打印 `IN the holder (live)`，六批 N/O/Q/R/Q2/S 全部在线；不记录持有者 pid 或启动时刻。
- `MEMORY.md` 本轮未动；[share-fit.mjs](.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs) 现跑 `sectionDropped 0 / droppedItems 0 / itemTruncated 0`、逐字节往返一致（字符数当场现读）。
- `errors.log` 的 `MissingSessionID` 行数本轮未增，仍全在修法前的构建里（父会话已结案）。
- 见证可行性核对：`~/.dsh/profiles/desktop/cordis.patch.yml` 里 `opencode-go` 的 `deepseek-v4.1-flash` 仍在（`contextWindow` 1000000、`maxTokens` 384000），默认仍是 `command-code`/`deepseek/deepseek-v4.1-flash` ⇒ 见证可执行。
- 新增机械判据（本会话唯一落地）：折叠会话日志最后一条 `request/header` → `data.header.config.provider` 必须等于目标路由，否则是假通过。命令：`zstd -dc ~/.dsh/sessions/<slug>/<session>/session.v4.jsonl.zstd | grep '^{"type":"request/header"' | tail -1`。
- 正负对照现跑（同一命令）：`session-b2a9894b` → `opencode-go`、`session-d435cad7` → `command-code`，与 `2026-10-11-aux-route-resolve-forensics/probe.mjs` B 半段从同一批事件得出的结论一致 ⇒ 该命令不是空跑。
- 该核对落地两处：`.agents/skills/dsh-post-restart-acceptance-probe/SKILL.md` 的 route pitfall（line 29），与 `.agents/memory/CONTEXT.md` 的批次 S 见证 Open task（补命令 + 对照）。
- 提交 `1219d13`（`docs(acceptance): confirm the witness route after the run, not just the absent error`）已推送 origin/main；2 files changed, 2 insertions, 1 deletion，只动 docs/skill。
- 改后 [measure.mjs](.agents/evidence/2026-10-07-context-section-balance/measure.mjs) 现跑仍 fixpoint、无 clip、每段 ≤ 自身份额 90%（Open tasks 29.1%）——份额判据未因这次编辑漂移。

## Open tasks

- **批次 S 的端到端见证（用户操作，只在 `opencode-go` 路由上有诊断力）**：先切模型到 `opencode-go`/`deepseek-v4.1-flash`；**再让该会话跑完一个普通轮次**（不可省：切模型只写 `model/selection`，`resolveTarget` 读 `request/header`）；然后跑 `/memory update`。验收需两条同时满足：①`grep -c MissingSessionID .agents/memory/errors.log` 不增（现为 4）；②折叠该会话最后一条 `request/header` 得到的 provider 是 `opencode-go`（命令见上 Key points）。只满足前半在 `command-code` 上必然成立，是假通过。结果发我，我判定并落档。
- **`MEMORY.md` 余量薄（下次写入前先压缩，不要靠删条目腾位）**：余量、分区占目标比与整篇是否到达 cap 一律现跑（`wc -m .agents/memory/MEMORY.md`、[share-fit.mjs](.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs)），不写死数字；自批次 N 起分区配额是目标值、只有整篇到达 cap 才丢条目，但再长一点下一次 pass 就会被 tier C 拒（`lossy-refused`）。可压缩的是已落地批次的叙事（权威副本在 `CHANGELOG.md` 与 `docs/batch-*-brief.md`）。本会话刻意未碰 `MEMORY.md`：任何手改都会在用户那次 pass 里触发 `adopted an externally edited MEMORY.md` 归因噪音，而那正是见证要读的日志。
- **已裁定、不要重开**：批次 S 的 B2 已随 §6 被否（用户 2026-10-11 多选里 B2 标注「备用兜底」，此后确认口径为「B1 首选形状、B2 只在 B1 不可行时兜底」）；批次 P（dispose 逃生）已裁定不端口；通知半边（无宿主侧通道）已裁定按残留收档。
- **记录在案但不做**：固定阈值模式忽略自适应 `usable` headroom（F8/Q5）；`tool-ask-user` 的定时晚回复以 `user-question-reply` 到达而不被读（两 profile 都不设 `mode: timed`）；嵌套在代码运行时（PTC）的询问只记 `tool/ptc-dispatch`、对 `deriveMessages` 不可见；`handoffBudgetRecentTokens > 0` 时最新输入也会出现在携带尾部（仅重复，两 profile 都用 0）。
- **仍未离线可证的合规项**：批次 I 的合规（模型是否真的对索引段发 `read`）与批次 J 的 `MIN_DROP_TOKENS` 在真实上下文里的行为；批次 M 的「模型是否总是转述注入行」同类。不要为这些重新论证加载问题。
- **交接子会话标题的两条未采用档**：档 2（丢自动切会话判据）与档 4/6 未采用，三条取舍 (a)/(b)/(c) 的现状见 `docs/handoff-candidates-b-c.md`；档 1/3 与档 5 已在线。
- Standing guard：不经用户点名，不改 profile、不重启宿主、不动 `/etc/nixos`；桌面重启脚本与 `/memory update` 始终由用户运行。

<!-- latest-session-title: Batch S witness: route-confirmation rule landed (1219d13) -->
