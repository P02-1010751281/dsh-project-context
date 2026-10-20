# Project Context

Last updated: 2026-10-20T10:35:59.691Z

## Summary

本会话接手时 dsh 已升到 **0.2.1-rc.2**（`dsh --version` 现读；宿主 2026-10-19 09:42 启动，Web GUI 在 33147），上一轮遗留的批次 S 见证仍在等用户。用户要求「新的更新已经出现，不能停滞」，本轮做的是**升级兼容审计 + 补一条回归**：复用 2026-10-03 的 `run-probe.sh` 对 0.2.1-rc.2 做编译探针，host/client 两半均 `exit=0 errors=0`（对照：仓库自身 `pnpm typecheck` 仍按 devDeps 0.1.7-rc.2 编译，0 错）；peer gate 三条带本插件的 profile 都无 skip/disabled（desktop 不能 `--dump-config`——宿主自己报 managed exclusively by the Electron application，改用运行中宿主的 inventory：`include:project-context` active、enabled-但非-active 0；web/ctxdev 的 dump 里我们四行 0 disabled）。0.2.x 唯一影响我们的**行为**变更是 `systemPrompt.context` 默认做 prompt 变量插值（`renderContextSections` 只在 `interpolate === false` 时跳过），散文文档里一个字面 `{{…}}` 会让整个 turn 在模型调用前抛 `malformed prompt variable reference` 而失败；`6109688` 为此给两份注入加了 `interpolate: false`。新探针 `interpolate-probe.mjs` 用**宿主自己的**渲染器决定四件事（默认开启插值、`{{ model }}` 确实抛错、opt-out 逐字保留、我们构建的 lib 两处都带该标志），并用 `--lib=` 指向去掉标志的副本证明判据能红。另新增 `test/literal-injection.test.mjs` 钉住我方契约（变异已杀，`src/` 已按 sha256 恢复）。**关键事实：`6109688` 不在运行进程里**——宿主 09:42 启动、该提交 10:15，宿主插件只在启动时加载，所以必须重启一次才生效；两份文档当前都不含 `{{`（现跑 0/0），因此现在没有正在失败的东西，风险是任何文档一旦写进占位符就会触发。期间把 CONTEXT.md 手改了两轮：第一轮把旧一轮 summarize 追加进 Summary 末尾，被 `measure.mjs` 判为**非 fixpoint**（追加文本被并进 Summary 的 bullet、下一段落标题因此丢失），已回退为「短 Summary + 标注 `**上一轮（10-11）存档**` 的旧块」并加入重启 Open task，现跑 `stored == rendered`、每段 ≤ 自身份额 90%。门禁现跑：`pnpm typecheck` 0、`pnpm test` 440/0（+1 用例）、`pnpm build` 0、`git diff --exit-code -- src lib` 干净。提交 `4ea6ee9` 已推送。球仍在用户手上：一次重启（让 `6109688` 上线）+ 批次 S 的端到端见证。

## Key points

- **dsh 0.2.1-rc.2 已在线**：2026-10-20 的兼容审计证据在 [`.agents/evidence/2026-10-20-dsh-021rc2-api-compat/`](.agents/evidence/2026-10-20-dsh-021rc2-api-compat/README.md)——`compile-probe.txt`（host/client 均 0 错）、`peer-gate.txt`（三 profile 无 skip；desktop 用运行中 inventory 代替 dump）、`interpolate-probe.txt`（四 claim 全过）、`interpolate-probe-control.txt`（`--lib=` 伪件使 claim D 红、exit 1）与 `mutant-test.log`。
- **0.2.x 的 prompt 插值（新行为，必须 opt-out）**：`systemPrompt.context` 默认 `interpolate: true`，`renderContextSections` 只在 `interpolate === false` 时逐字保留；我们注入的 MEMORY.md/CONTEXT.md 是散文，所以设为 false（提交 `6109688`；`src/project-memory/index.ts` 里的本地类型加宽是因为 pinned 0.1.7 类型没有该字段）。回归用例 `test/literal-injection.test.mjs` 钉住两处注册，并以注册名单做正向对照；不要因为 devDeps 升级后「字段看起来多余」就删掉它。
- **加载态（现跑判据，不写死）**：`6109688` **不在运行进程里**（`check.mjs --port 33147` 现跑 `VERDICT: NEGATIVE`：宿主启动早于该提交）。宿主插件只在 boot 时加载，改 `lib/` 不会热生效 ⇒ 需要一次用户重启。此前六批 N/O/Q/R/Q2/S 全部 `IN the holder (live)`。
- 门禁（现跑，不引用旧数）：`pnpm typecheck` 0；`pnpm test` **440 pass / 0 fail**；`pnpm build` 0（`built ./lib/client.js (28575 bytes)`）；`git diff --exit-code -- src lib` 干净；`lib/` 0 变异标记。
- 提交 `4ea6ee9`（`test(project-memory): pin the literal-text opt-out, and audit the 0.2.1-rc.2 line`）已推送 origin/main：10 files, +404/-1，只动 test/evidence/CONTEXT.md，`src`/`lib` 未改。
- `MEMORY.md` 本轮未动（现读 38055 字符），[share-fit.mjs](.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs) 现跑 `sectionDropped 0 / droppedItems 0 / itemTruncated 0`、逐字节往返一致；Invariants 与 Pitfalls 均已在硬份额 97% 以上，余量薄。
- **CONTEXT.md 手改的教训（本轮实证）**：在某一 section 末尾直接追加文本会被并入该 section 最后一个 bullet，并使下一段标题被吞 ⇒ `measure.mjs` 判非 fixpoint（`stored` 与 `rendered` 在追加处长文分歧）；`renderContextDocument` 缺 `options.updatedAt` 会抛 `TypeError`。现文档 6102 字符、fixpoint、Summary 20.6% / Key points 24.7% / Open tasks 24.4%。
- **仍被记录的对照事实**：`errors.log` 的 `MissingSessionID` 现为 4 行，全在修法前的构建里；`~/.dsh/profiles/desktop/cordis.patch.yml` 里 `opencode-go` 的 `deepseek-v4.1-flash` 仍在（`contextWindow` 1000000、`maxTokens` 384000），默认仍是 `command-code`/`deepseek/deepseek-v4.1-flash` ⇒ 见证可执行。
- **批次 S 见证的机械判据**：折叠会话日志最后一条 `request/header` → `data.header.config.provider` 必须等于目标路由，否则是假通过。命令：`zstd -dc ~/.dsh/sessions/<slug>/<session>/session.v4.jsonl.zstd | grep '^{\"type\":\"request/header\"' | tail -1`。正负对照（同一命令）：`session-b2a9894b` → `opencode-go`、`session-d435cad7` → `command-code`，与 `2026-10-11-aux-route-resolve-forensics/probe.mjs` B 半段一致 ⇒ 该命令不是空跑。该规则落在 `.agents/skills/dsh-post-restart-acceptance-probe/SKILL.md` 的 route pitfall 与 CONTEXT.md 的见证 Open task（`1219d13`）。
- **故意未做**：没有把 devDependencies 从 0.1.7-rc.2 抬到 0.2.1-rc.2（抬 pin 要重生成 lockfile 并重建 `lib/`，当前 pin 语义是「声明支持的最低 peer 线」，候选线由编译探针覆盖）；已向用户说明，等其点名再做这一批。

## Open tasks

- **第十次 pi 上游三查（2026-10-20，`d25ecab..e631c99`，v0.4.10–v0.4.14）**：96 个提交已逐条归类，见 [`docs/upstream-pi-triage.md`](docs/upstream-pi-triage.md) 的 Tenth pass。**T1 已落地（`2fc8957`）**：读一致性判据 `renderChangedUnderRead` 加上 `ctimeMs`，同尺寸保留 mtime 的替换不再隐形（残留只剩 ctime 粒度内那次）。未开工的两项：**T2** 被拒回复不得发布其 context 段（`src/project-memory/index.ts` 写半段），需要一条裁决 —— fresh 项目的 `fallbackUpdate` 是否仍落盘；**U1** handoff 与自动 compaction 的先后无 dsh 钩子可取消，且 desktop profile 已停用 `compaction-basic`。T1 之后 `src/` 已动 ⇒ 与 `6109688` 同一次重启上线。
- **重启桌面宿主让 `6109688` 上线（用户操作）**：现跑 `node .agents/evidence/2026-10-11-pre-restart-readiness/check.mjs --port <GUI 端口>` 得 `VERDICT: NEGATIVE`；重启后同一判据应 POSITIVE，且 inventory 里 `include:project-context` 仍 active。宿主插件只在 boot 加载，这一条没有替代路径。⚠️ `dsh-desktop-restart.sh --verify-only` 在第二台 store（DSH-AV 的 19388）活着时会独立报 FAIL，判据只认 `check.mjs`；重启脚本始终由用户运行。
- **批次 S 的端到端见证（用户操作，只在 `opencode-go` 路由上有诊断力）**：先切模型到 `opencode-go`/`deepseek-v4.1-flash`；**再让该会话跑完一个普通轮次**（不可省：切模型只写 `model/selection`，`resolveTarget` 读 `request/header`）；然后跑 `/memory update`。验收需两条同时满足：①`grep -c MissingSessionID .agents/memory/errors.log` 不增（现为 4）；②折叠该会话最后一条 `request/header` 得到的 provider 是 `opencode-go`（命令见 Key points）。只满足前半在 `command-code` 上必然成立，是假通过。结果发我，我判定并落档。
- **可选的下一批（等用户点名）**：把 devDependencies 从 0.1.7-rc.2 抬到 0.2.1-rc.2，需重生成 lockfile 并重建 `lib/`，并在 `test/literal-injection.test.mjs` 旁复核本地类型加宽是否可去掉。
- **`MEMORY.md` 余量薄（下次写入前先压缩，不要靠删条目腾位）**：余量、分区占目标比与整篇是否到达 cap 一律现跑（`wc -m .agents/memory/MEMORY.md`、[share-fit.mjs](.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs)），不写死数字；自批次 N 起分区配额是目标值、只有整篇到达 cap 才丢条目，但再长一点下一次 pass 就会被 tier C 拒（`lossy-refused`）。可压缩的是已落地批次的叙事（权威副本在 `CHANGELOG.md` 与 `docs/batch-*-brief.md`）。
- **已裁定、不要重开**：批次 S 的 B2 已随 §6 被否（用户 2026-10-11 多选里 B2 标注「备用兜底」，此后确认口径为「B1 首选形状、B2 只在 B1 不可行时兜底」）；批次 P（dispose 逃生）已裁定不端口；通知半边（无宿主侧通道）已裁定按残留收档。
- **记录在案但不做**：固定阈值模式忽略自适应 `usable` headroom（F8/Q5）；`tool-ask-user` 的定时晚回复以 `user-question-reply` 到达而不被读（两 profile 都不设 `mode: timed`）；嵌套在代码运行时（PTC）的询问只记 `tool/ptc-dispatch`、对 `deriveMessages` 不可见；`handoffBudgetRecentTokens > 0` 时最新输入也会出现在携带尾部（仅重复，两 profile 都用 0）。
- **仍未离线可证的合规项**：批次 I 的合规（模型是否真的对索引段发 `read`）与批次 J 的 `MIN_DROP_TOKENS` 在真实上下文里的行为；批次 M 的「模型是否总是转述注入行」同类。不要为这些重新论证加载问题。
- **交接子会话标题的两条未采用档**：档 2（丢自动切会话判据）与档 4/6 未采用，三条取舍 (a)/(b)/(c) 的现状见 `docs/handoff-candidates-b-c.md`；档 1/3 与档 5 已在线。
- Standing guard：不经用户点名，不改 profile、不重启宿主、不动 `/etc/nixos`；桌面重启脚本与 `/memory update` 始终由用户运行。

<!-- latest-session-title: 0.2.1-rc.2 compat audit: prompt-interpolation opt-out pinned, restart still pending -->
