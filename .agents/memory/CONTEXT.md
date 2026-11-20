# Project Context

Last updated: 2026-11-20T03:07:21.531Z

## Summary

从 session-e24b9d97 交接继续。上一批（`8ffb70f`→`f247e77`）在交接前已全部落地并推送：`8ffb70f` 让 `/memory` 回执不再把「历史截断标记」冒充本次读取被裁（有真丢弃才 `Warning:`，否则 `Note:`），并把度量放进首行；`fbe88a8` 让记忆整理在 `record_memory` 参数 JSON 非法时消耗一次无工具重试（`ToolsFallbackOptions.extraCodes` + `onRetry`，只对记忆开启，autolearn 策略不变；695→697 测试，变异轮两条新用例各自变红、还原后 0 marker）；`17866b4` 把自动沉淀的技能 `dsh-command-receipt-render-verify` 按跟踪边界入库；`7b429a8` 把损失闸规格的三处准入门槛写进 `docs/memory-rewrite-loss-gate-spec.md` §9（抽取器会错配反引号、文档级集合量不了逐条存活、tier C 量不到「模型在渲染前就省略条目」）；`f247e77` 收尾记忆与 CONTEXT。随后 desktop pin 从 `8ffb70f` 升到 `f247e77`，用 store 内 pnpm 安装并 sha256 校验 `model-call.js` / `consolidate.js` / `status-report.js` / `client.js` 与仓库全等，`origin/main..HEAD` 为 0、工作区干净。宿主在 11:03:08 重启（安装副本 10:58:26），运行中模块探针判定这两个模块「the running host executes the code on disk」⇒ 上一批在线。之后用户给出新指令：subagent-codex 里钉的 `gpt-5.6-luna` 要换成其他模型，且 luna 属老弱模型、绝不能作为答案，并明确要「agent team」。于是开两条团队任务：task-1（model-scout）真跑候选模型做冒烟，task-2（acceptance）做重启后的行为验收。主线同时确认了改动点：`subagent-codex` 的 `config.model` 是必填字符串、省略则继承 `~/.codex/config.toml`（默认 `opendesign/deepseek-v4.1-flash`），网关目录在 `~/.codex/magpie-models.json`（109 个 id，luna 只在 `opendesign/gpt-6-luna` / `auto/gpt-6-luna`），强候选包括 `apikeyfan/claude-opus-5-5`、`auto/claude-opus-5-5`、`apikeyfan/gpt-6.2-astra`、`apikeyfan/gpt-6.2-sol`、`auto/gemini-4-carbon`、`apikeyfan/kimi-k3.1-pro`；最终取值等 model-scout 的实测结果，不按名字猜。本轮记忆文档 49,989 字符（cap 52,000）。

## Key points

- 上一批已在线：宿主 11:03:08 启动、安装副本 10:58:26，运行中模块探针（`lib/shared/model-call.js`、`lib/project-memory/status-report.js`）判定「执行的就是磁盘上的代码」。
- `fbe88a8`：`callWithToolsFallback` 新增可选 `ToolsFallbackOptions{extraCodes, onRetry}`，仅记忆整理对 `MALFORMED_RESPONSE` 花一次无工具重试；日志一行且不回显 message（message 里是模型生成的整段记忆参数）；共享允许集 `REQUEST_SHAPE_CODES` 未改；测试 695→697。
- `8ffb70f`：`/memory` 回执首行是度量行，历史截断标记降为 `Note:`，只有本次真丢弃才出 `Warning:`；与 Batch V 的 `stale N` 一起生效。
- `7b429a8`：损失闸规格 §9 三条准入门槛——§8 抽取器会错配反引号（61 vs 先配对后 57）、§3 是文档级集合量不了逐条存活（正名 `missing literals`）、§0 前提错（tier C 量不到模型在渲染前省略条目）；落地顺序是先用 `memory.jsonl` 历史离线校准、只报不拒、写入成功之后才报。
- `subagent-codex`：`config.model` 为 `z.string().min(1)`，省略则继承 `~/.codex/config.toml`（当前 `opendesign/deepseek-v4.1-flash`，对「强模型」不够）；desktop profile 钉的 `gpt-5.6-luna` 不在网关目录里 ⇒ 线程启动即失败。
- 用户裁定：luna 属老弱模型，即使网关里有该 id 也不采用；要换就用其他强模型，并开 agent team 并行推进。
- 团队：task-1 `model-scout`（列 109 个 id、挑强候选、逐个 `codex exec --sandbox read-only -m <id>` 冒烟并测 reasoning effort），task-2 `acceptance`（只对已安装副本与仓库 `lib/` 做行为验收：回执布局、cap 两态、malformed 重试；禁止跑 `/memory update`）。
- desktop profile 的 `cordis.patch.yml` 正被平台设置面持续回写（本轮新增 `auto/hy4-flash-free`、`opencode-zen-free/*` 等条目并上调若干 `maxTokens`），`maxMemoryChars: 52000` 目前仍在，但保存设置后须复读。
- 本会话已越过 40 万 token 阈值，自动交接只在轮次结束评估；有队友在跑时不得交接或结束轮次。

## Open tasks

- 收 task-1 与 task-2 的报告：模型冒烟结果与行为验收结论，未到齐前不改 profile、不宣布验收通过。
- 按 model-scout 实测挑一个强模型（luna 排除），改 desktop profile 里 `subagent-codex` 的 `model` 一行，随 pin 一起生效后重启宿主，并确认 `subagent_codex` 能正常起线程。
- 重启后按三条验：`/memory` 首行度量行 + 可展开 5 行；历史截断标记只出 `Note:`；真丢弃才出 `Warning:`。
- 确认 malformed 重试真的被触发：`errors.log` 出现 `the model's record_memory reply was unusable (MALFORMED_RESPONSE); the pass was retried once without tools`，且该次 pass 不再整次丢盘。
- 跑几次真实 pass 后复核 Batch V 的 `stale` 计数与回执四态，据此给 V-2（把 stale 数量写进整理提示词）排期。
- 按 `docs/memory-rewrite-loss-gate-spec.md` §9 落地损失闸：先用 `memory.jsonl` 历史离线校准，只报不拒，且只在写入成功后报；先改 `src/` 一个判定点 + 回执，再动 `lib/`。
- 每次改动 profile 设置后复读 `cordis.patch.yml` 的 `maxMemoryChars`，防止设置卡整份回写冲回 45,000；若被冲回，从 `/tmp/head-mem-20261120-100945.md` 恢复并重新校验。
- 「调研一下 AOCI」仍未确认所指：仓库已有 `01bed31`/`7384eee`/`31619a9` 三份 AOCI 调研提交与 evidence 目录，需问清是要文档还是要源码核对。
- SH-10：插件能否在空闲 agent 上调用 `ctx.compaction.compactNow` 仍未探针验证，未证不得写入承诺。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）仍未拍板，需用户定范围；可选的 `dsh-code-index` 兼容性试验尚未开始。
- `context-injection.test.mjs` 偶发失败未定性（旧项，需在无并发写入时复现）。

<!-- latest-session-title: 选 subagent-codex 新模型并做重启后验收（团队并行） -->
