# Project Context

Last updated: 2026-11-18T01:59:48.533Z

## Summary

本会话在同一天先交付了同类系统调研（报告 `docs/research/2026-11-18-similar-projects.md` 547 行 + 证据包 `.agents/evidence/2026-11-18-similar-projects-research/` 76 文件 18 MB，一次提交 `3b6f9d6`，152 文件），用户同意后追问「同会话压缩会不会更好」。 针对该问题直接读了 dsh 源码（`packages/compaction/*`，`packages/boot`、`packages/client` 中的引用面）与本仓库 `src/project-handoff/conversation.ts`、`docs/handoff-candidates-b-c.md`，用实测/源码核对得出三层结论：①dsh 宿主自带 `@deepseek-ai/dsh-compaction`，`compaction-basic` 默认 `thresholdRatio 0.8`（再与剩余容量取小）、`retainRatio 0.16`、自动触发在 `agent/pre-step`、溢出在 `agent/request-error` 重试、手动 `/compact` 走 `compactNow`（要求 agent 空闲），改写是 durable surface replace（`compaction/start|summary|end` 遮蔽旧节点，工具配对保持），因此自建压缩器是重复实现且会与宿主抢同一 waterfall；②我们的 handoff 解决的是会话边界问题，且 `conversation.ts` 明确从 append-origin 日志取尾料，压缩遮蔽不影响种子完整性，两者可共存；③用默认策略估算的交叉点约 436K（128K/200K/400K 窗口压缩先到，500K/1M 窗口膝线先到），所以 1M 窗口上「157K 交接 vs 800K 压缩」是目标函数选择而非机制优劣。 给出的建议是分层而非二选一：压缩归宿主、交接归我们、补一个压缩感知的只读观测（`compaction/start|summary|end` 是 session event，可在 `/handoff status` 与注入行报「已压缩 N 次、压缩后仍高于膝线」）、handoff 被 `defer` 或子代理挡住时作为兜底（但插件能否调用 `ctx.compaction.compactNow` 未证，须先探针）、以及告诉用户已有杠杆（把 `handoffThreshold` 设到 0.8 / 800k 即可让 handoff 退化为兜底）。末轮已提议把这些落成 `docs/compaction-vs-handoff.md`（只写规格不动 `src/`），用户尚未答复。

## Key points

- dsh 自带同会话压缩：`packages/compaction/compaction-basic/src/config.ts` 的 `thresholdRatio 0.8`、`retainRatio 0.16`，压力再与「窗口 − 预留 − 65536」取小；自动触发 `agent/pre-step`，溢出 `agent/request-error` 重试，手动 `/compact` → `compactNow`（需空闲 agent、需 `agent.runMaintenance`）。
- 压缩是 durable surface replace：`compaction/start|summary|end` 事件 + 遮蔽被压缩 span，不是删消息；工具调用与结果保持配对（`compaction/src/tool-pairing.ts`），客户端有 `CompactionNodeView` 渲染。
- 本项目 handoff 与压缩不是同一问题：压缩缓解窗口压力（摘要替换历史、保留最近约 16%），handoff 换会话边界（原文尾料 + 文件清单 + 未答问题 + 门控 + 退休旧会话、批次 J 起零模型调用）。
- `src/project-handoff/conversation.ts` 从 append-origin 日志读取尾料与文件索引，明确注释「不能依赖压缩后模型可见的 surface」，因此压缩遮蔽任何 span 都不影响交接种子的完整性。
- 按默认策略估算的分界点约 436K：≤400K 窗口压缩先发生（handoff 常到不了膝线），500K/1M 窗口膝线先到（我们在压缩线之前交接）。
- 1M 窗口两种取向：157K 交接 = 每轮质量优先但切会话多；800K 压缩 = 连续性与成本优先但需承认 160K→800K 区间的质量衰减，且反复压缩会遇 ACE 的 context collapse。
- 已有用户杠杆、无需新键：把 `handoffThreshold` 设成 `0.8` 或 `800k` 即可让 handoff 退化为兜底，文档需写明代价。
- 压缩感知属于纯观测（监听本来就是 session event 的三类压缩事件），不改触发时机，是最便宜的补强；插件侧兜底调用 `compactNow` 未探针验证，不得先承诺。
- `docs/handoff-candidates-b-c.md` 的既有判定仍成立：用户 2026-10-07 的约束「不能丢东西」把触发点钉回 `turn/end`，`step/end` 与 `agent/pre-step` 触发都必须停掉在飞的那一轮、丢掉它的答案，故不做。
- 上一批调研的交付与复验已收尾：`manifest=76` 无哈希不匹配、CSV 数据行 36、链接 6 条无坏链、密钥扫描干净，证据包 18 MB 随 `3b6f9d6` 进入 Git。

## Open tasks

- 用户是否要把分层建议落成 `docs/compaction-vs-handoff.md`（只写规格：交叉点计算、`/handoff status` 压缩行规格、`compactNow` 可调用性探针清单，不动 `src/`）——已提议，待拍板。
- 若推进压缩感知：先用探针证明插件能否在空闲 agent 上调用 `ctx.compaction.compactNow`，再谈兜底；未证不得写入承诺。
- P0 补强（只读检索面、`/memory status` 类状态面板、交接回执可视化）仍未拍板，需用户定范围。
- Z8d 部分盖章需宿主重启后才生效（用户执行），重启后触发一次整理 pass 并确认 `errors.log` 无新的 `memory regression:` 行。
- 方案 D（3-hex 条目 id）仍默认不做，等用户在看到调研结论后再定。
- `context-injection.test.mjs` 偶发失败未定性（旧项，需在无并发写入时复现）。
- 调研报告标注的站点漂移项（Cursor memories、Windsurf→Devin、Codex 文档迁移）未闭合，若要对外发布需补一轮复核。

<!-- latest-session-title: 同会话压缩 vs handoff：宿主压缩机制核对与分工建议 -->
