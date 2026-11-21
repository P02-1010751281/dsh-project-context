# Project Context

Last updated: 2026-11-21T12:48:42.577Z

## Summary

本会话从 session-ce640169 交接，把批次 AA 收尾并完成两项用户请求。已推送：`450de13` 把 expiry 折进唯一状态裁定者（七态、一个裁定者、`retiresEntry` 决定哪三态由退役引擎移出、`--accept` 只对其余状态写确认）；`dee5db8` 落地 AA6（`sessionSettledDays` 默认 7 范围 1–365 作为 live/settled 分界、abandoned 判据与扫描门槛的唯一来源；`autolearnExpireSkills` 默认 true，把过期移出与沉淀解耦；`bindSkills` 返回 `{bound, skipped}` 并让回执第二行点名无锚点技能，`SkillFacts.bindable` 让 status 把「没人跑过 bind」与「没有可绑锚点」分开）；随后用户要求设置页向上游靠齐，`bfea9cd` 用上游 `SegmentedTabs` 把卡片分成记忆/技能/交接三个页签；`b36743e` 恢复 20:40 pass 删掉的记忆并提交。记忆在本会话发生两次措辞级丢失（19:44 中文翻译丢约 10 个标识符，`032d4a2` 补回 19 个字面量；20:40 pass 又删一条 pitfall，`b36743e` 恢复），两次都经 `renderMemoryDocument` 渲染 + 字节相同往返 + `sectionDropped/droppedItems/itemTruncated` 全 0 证明。最新 `pnpm test` 772/772，typecheck 干净，`lib` 两次构建字节相同；profile pin 已抬到 `b36743e`，受跟踪 `lib/` 215 个文件对 `git show b36743e:lib/…` 逐个 sha256 零不一致，等你重启宿主与硬刷新标签页后可见。

## Key points

- 提交序列：`450de13` 七态裁定者收口 → `dee5db8` AA6 两个设置项 + bind 报告缺口 → `bfea9cd` 卡片三页签 → `b36743e` 记忆恢复。
- `entryStateOf(tid, facts)` 只读调用方给的事实、不探测，顺序 `superseded → anchor-drift → task-closed → version-shipped → age-unconfirmed → content-stale → healthy`；事实来自 `retirement.ts`（三态）、`expiry-source.ts`（两态）、`staleness-source.ts`（content-stale），聚合在 `entry-states.ts`。
- AA6 验证：`pnpm test` 771/771 时点、typecheck 干净、`lib` 两次构建字节相同；6 个变异具名打红（删过期门、删沉淀关闭时的只移出路径、核心忽略配置天数、命令硬编码 7、`skipped` 不入报告、`bindable` 恒 0），其中「命令硬编码 7」首版不编译、改成字面量后才算证据。
- 卡片页签：上游 `SegmentedTabs`（`packages/client/ui-primitives/src/SegmentedTabs.tsx`，插件页导航也用它），三个面板都留 DOM 只切 `hidden`，so 切换不丢暂存编辑、底部仍一次保存一次原子写；`size` 属性是 0.2.x 才声明，客户端按钉住的 0.1.7-rc.2 编译所以不传（传了 `tsc -p tsconfig.client.json` 直接报 `Property 'size' does not exist`）。
- `card-render` 新增断言：一个 tablist、每段一个 tab 与面板、只有一个面板可见；变异「所有面板都可见」具名打红；`settings-form.test.mjs` 三条断言（每键一行、每字段 `volatile`、bounds 与 schema 一致）随 23 行扩了。
- 「放到对应子功能下」被否并说明了原因：要让 memory/autolearn/handoff 各自导出 `Config` 出三张独立卡，得拆掉共享 `project-context` 命名空间，意味着四份 schema、四张卡、两个 profile 已有值要迁移、一次保存一个 revision 变成四次——属单独一批，先出拆分 spec。
- 上游设置表单是一项一块竖排：`ConfigField.tsx` 的 `.field` 为 `flex-direction: column; gap: 6px`，label/控件/错误各占行，没有 hint 位、没有网格或折叠；我们的 `.dshPcRow` 更密，所以 23 行的真实成本是每行一条 hint，最便宜的是布尔项去掉 hint 或 hint 只在覆盖/非法时出现。
- 记忆丢失两次：19:44 中文翻译 pass 掉 27 个反引号 token（19 处仍成立，`032d4a2` 经渲染器补回，并纠正过期名 `fixedRatioAdvice` → `fixedFloorAdvice`，`src/project-handoff/threshold.ts:122`）；20:40 pass 删掉「重启脚本 `--verify-only` 会印无关 FAIL」的 pitfall，`b36743e` 恢复，损失闸当时记 5 个字面量、2 条条目。
- 没有自动修复路径：`missing-literals.ts` 只报告（写成功后比模型看到的文档与落盘字节，进 `errors.log` 与 `/memory update` 首行），tier C 只拒结构丢失（丢整条/段落超预算），所以换措辞级丢失报零、状态 `updated`。要自动补得新增「按上一版 token 差异回填」通道，是新决策。
- 手工恢复后的宿主日志会印 `adopted an externally edited MEMORY.md into the memory journal` 与 `memory regression: N … entry(ies) are no longer present`（按条目精确文本比），这是发现外部改写的方式。
- 本轮记忆统计（恢复后）：渲染 35,832 字符、`sectionDropped/droppedItems/itemTruncated` 全 0、读回相等且二次渲染稳定；条目数 head 198 / work 203 的差异来自当轮新增条目。
- 安装：desktop profile pin → `b36743e`，store 内 pnpm 11.27.0；受跟踪 `lib/` 215 个文件对 `git show b36743e:lib/…` sha256 零不一致；安装副本 `lib/client.js` 里页签代码在位、schema 里 `sessionSettledDays` 与 `autolearnExpireSkills` 都在。
- 本会话上下文 400,054 / 1,048,576（38%）已越 400,000 阈值；自动交接只在 `turn/end` 评估，所以结论都落在 `b36743e` 与 `CHANGELOG.md` / `docs/batch-aa-state-machines-spec.md` 里，新会话可直接接上。

## Open tasks

- 用户侧：重启 desktop 宿主加载 `b36743e`，再对设置页做一次标签页硬刷新，确认三个页签与两个新选项（记忆页「归档判定天数」、技能页「过期技能自动移出」）在位。
- 用户侧决策：是否为措辞级记忆丢失加一道修复闸——把上一版里未被退休/取代却消失的条目自动回填，或在整理提示里要求逐条保留；两轮内已发生两次，未排期。
- 用户侧决策：是否另起一批把设置拆成 memory / autolearn / handoff 三张独立卡（需四份 schema、迁移两个 profile 已有值、改一次保存语义），要求先出拆分 spec。
- content-stale 条目（本会话读到 9 条中除被改文件外仍有若干，如 `dc5`、`af0`、`ef8`）逐条 `/memory reconcile --accept <id>` 确认，或等整理 pass 改写正文；`--accept` 只记基线、不改改写。
- SH-10 剩余未知：交接时刻插件能否拿到空闲 agent 句柄以调 `ctx.compaction.compactNow`；未验证前不得写成承诺。
- `context-injection.test.mjs` 偶发失败仍未定性，需在无并发写入时复现。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）未拍板，需用户定范围；可选的 `dsh-code-index` 兼容性试验未开始。
- AOCI 可选动作 A（`/tmp` 克隆里只读试用，scope 到 `src/project-handoff/`）与 B（接入为可选插件）均未启动，需用户决定。
- 每次改 profile 设置或重启前复读 `cordis.patch.yml` 的 `maxMemoryChars`（当前 52000）与 `subagent-codex` 的 `model` 一行，防设置卡整份回写冲掉手改值。

<!-- latest-session-title: 批次 AA 收尾 + 设置卡片页签化 + 两次措辞级记忆丢失与恢复 -->
