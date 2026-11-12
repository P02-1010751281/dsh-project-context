# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title memory cap headroom: MEMORY.md compressed to 44,170/45,000, Z8e verified live, 406-12 restart pending

## Summary

接 z8-acceptance 会话继续。本轮两件事：一是确认 Z8e 在真实宿主上验收通过，二是把顶到 cap 的 MEMORY.md 压出安全余量。 Z8e 验收：用户在已重启的宿主上触发 `/handoff threshold 400k`，回执为 `threshold 400000 tokens · fixed threshold 400000 tokens` —— 合并后的单键 `handoffThreshold` 真的接受了绝对 token 拼写，旧代码的 unknown-config-key 报错已成历史。只读复核：`dsh-desktop-restart.sh --verify-only` → RESULT: PASS、`enabled 但非 active: 0`；证据探针报 `the running host executes the code on disk`，磁盘归属 613cb9f，宿主今早 08:48:47 重启（pid 79211）。 记忆压缩：`MEMORY.md` 从 44,997/45,000（只剩 3 字符）压到 44,170（余 830），145 个条目一条不少（P17 / I66 / P45 / Ix17）。做法是 30 处整行替换的纯措辞压缩，脚本机械校验每行原文本的所有反引号 token 必须原样保留、所有数字必须以子串形式保留（唯一白名单是第 57 行 `handoffThresholdAuto: true` 的有意更正），行内重复片段检查 0 处。压缩后跑插件自身的 `renderMemoryDocument` 做 round-trip：44170 = 44170 逐字节相同，`sectionDropped 0`、`droppedItems 0`、`itemTruncated 0`、`isMemoryTruncated false`、`normalize` dropped 0；`pnpm test` 613/613；`lib/` 零漂移。已提交并推送 `13d37c7`，工作树干净，`HEAD = origin/main`。 同时修掉了第 57 行的假断言：`handoffPendingQuestion` 那条原写 `(with handoffThresholdAuto: true …)`，Z8e 之后该键不存在，改为 `(with handoffThreshold: auto …)`，现在 `grep handoffThresholdAuto` 全文件 0 命中。 关于用户预期的 1.5–2k：纯措辞压缩只挤出 827。原因是文档已高度密集，能删的只有连接词与重复修饰；再挤就得删已交付批次的整条 bullet（内容在 CHANGELOG 里），属于删事实，没有擅自做。830 的余量够用：下一次 pass 要把 145 个 id 全部盖章约需 432 字符，盖完仍余约 400。 风险提示已发给用户：本轮 context 400,625/1,048,576（38%）已越过刚设的 400,000 tokens 阈值，`handoffPendingQuestion: wait` 不挡，故本回合结束可能触发自动交接；406-12 的宿主重启仍挂在用户侧。

## Key points

- Z8e 真机验收通过：`/handoff threshold 400k` → `threshold 400000 tokens` + `fixed threshold 400000 tokens`，合并键 `handoffThreshold` 接受绝对 token 数。
- 本轮只读复核：`--verify-only` RESULT: PASS、`enabled 但非 active: 0`；探针报 `the running host executes the code on disk`，磁盘归属 613cb9f，宿主 08:48:47 重启 pid 79211。
- MEMORY.md 由 44,997/45,000 压到 44,170（余 830），145 条一条不少；`renderMemoryDocument` round-trip 逐字节相同，sectionDropped/droppedItems/itemTruncated 全 0。
- 压缩方式：30 处整行替换，脚本强制保留每行所有反引号 token 与数字，白名单仅 `handoffThresholdAuto: true` 这一处有意更正；行内重复片段 0 处。
- 第 57 行 `handoffPendingQuestion` 的旧断言改为 `(with handoffThreshold: auto …)`，`grep handoffThresholdAuto` 现为 0 命中。
- 纯措辞压缩只挤出 827 字符，未达 1.5–2k：文档已密集，再压只能删已交付批次条目（=删事实），留待用户决定。
- 余量测算：下一次 pass 给 145 个 id 全部盖章约需 432 字符，盖完仍余约 400。
- 落库 `13d37c7`（已推送），`pnpm test` 613/613、`lib/` 零漂移、工作树干净、HEAD=origin/main。
- 本轮 context 400,625/1,048,576（38%）已越过 400,000 阈值，回合结束可能触发自动交接。

## Open tasks

- 用户：重启 406-12 的 DSH 桌面宿主（pid 2727214 仍跑旧码），重启后新构建生效；本机 Windows 侧下次启动自动加载新包。
- 观察本回合结束时是否触发自动交接（context 已越 400,000 阈值），若交接则在新会话接着做：下一次 `/memory update` 加盖 145 个 id。
- 持续盯 cap 余量（44,170/45,000，余 830）；若用户要更多空间，需先征得同意再删已交付批次的整条条目。
- 观察 `context-injection.test.mjs` 偶发失败是否在无并发写入时复现（旧项，未定性）。
- 被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档（旧项）。
- 只读闭合复核 subagent 69845585（上一会话发起）若仍待回，报告到达后逐条复现其发现，阻塞项当场修。
- 方案 D（3-hex id）默认不做：A 已让 id 不再吞事实，D 只增余量且会重置现有年龄。

<!-- latest-session-title: memory cap headroom: MEMORY.md compressed to 44,170/45,000, Z8e verified live, 406-12 restart pending -->
