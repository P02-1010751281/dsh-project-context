# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-11 · title z8-acceptance: proved the host runs a stale build; answered the threshold token-vs-ratio question

## Summary

本会话（session-4c23d245 交接，任务 z8-acceptance）接着 Z8 收尾。① 复核交接里“只差重启”的判断：宿主进程 10:41:56 启动，却在 14:21 写出了部分盖章，与新代码矛盾。用宿主已开的 inspector（127.0.0.1:9230）读运行中 isolate 常驻的 `lib/project-memory/retirement.js` 源码，与 `git show <commit>:lib/…` blob 逐字节比哈希：常驻 sha `658a6c81…` = 9864d05（13:54 部分盖章版），磁盘 sha `7dc2c223…` = e9c4214（14:31 近上限边界版）→ 判定 STALE，需重启；关键教训是“进程启动时刻晚于最后 src 提交”这条旧判据在本环境并不成立（插件代码能在不重启的情况下被换掉一次），已落成只读探针 `.agents/evidence/2026-11-11-z8d-live-module-version/probe.mjs` 并提交 9225b56，HEAD=origin/main、工作树干净。这解释了 entries.json 只有 131 个 carried id 而非 140（9864d05 无 keepIds）。② 用户问 `/handoff threshold 400k` 为何非法：`threshold` 只存窗口比例（handoffThresholdRatio 0.1–0.95）或 auto，`400k` 连比例都解析不出（Number("400k")=NaN；"400000" 折成 4000 越界），报错文案却只说范围未说“要的是窗口比例”，属误报原因；已给 400k≈0.3815 的等价写法与两种修法（只改文案 / 让 400k 可用），等用户拍板。Z8d 代码本身已落地 fe5dfed+287888b，另有 e9c4214（近上限盖章边界）与 c4274c2（MEMORY.md pass 重写）。

## Key points

- Z8d 已落地：fe5dfed（代码/测试）+ 287888b（docs），追加 e9c4214（正文+6 超 800 单条上限时跳过盖章只推迟自己）与 c4274c2（MEMORY.md pass 重写、去掉易变 id 计数）；HEAD=origin/main。
- 活体判据（哈希为准）：宿主常驻 retirement.js = 9864d05（13:54 部分盖章版），磁盘 = e9c4214（14:31 近上限版）→ STALE，需重启；旧“进程启动时刻”判据失效——插件代码可不重启被换一次但之后不重载。
- 只读探针 `.agents/evidence/2026-11-11-z8d-live-module-version/probe.mjs`：Debugger.enable→getScriptSource→disable，打印常驻 vs 磁盘哈希 + 归属 commit + STALE/一致；已提交 9225b56。
- entries.json 只有 131 个 carried id 不是 140 个 keepIds，正好符合 9864d05（无 keepIds），与 STALE 判定自洽。
- `/handoff threshold` 只接受 auto 或窗口比例（`handoffThresholdRatio` 0.1–0.95）：`400k` 失败（Number("400k")=NaN，"400000"→4000 越界）；绝对 token 旋钮是 `/handoff budget summary|recent <tokens>`。
- 本会话窗口 1,048,576：400k ≈ `threshold 0.3815`（→400,032），0.38→398,459，0.4→419,430；上限被 W−4000 截，floor=overhead+recent(20000)+8000。
- threshold 报错文案误报原因（只报 0.1–0.95 未说“窗口比例”），两种修法待用户选：①只改文案（低风险，保留 `/threshold needs auto or a ratio/` 前缀即可不动 test/logic.test.mjs:2976）；②让 400k 折成比例（破 E 批一事实一名，换模型会重定基，需明确点头）。
- 重启后对照基线（当前构建、只读）：stamped:true、140 个 id、44,825→44,879 字符、0 丢弃/0 截断、keepIds 140。
- 上一轮门禁基线：typecheck 0、pnpm test 609/609、build lib/client.js 38274、0 变异标记；本轮只动文档/证据未改 src/test，lib/ 零漂移。

## Open tasks

- 用户：重启桌面宿主 → 触发一次 `/memory update` → 验收：probe 报 executes the code on disk（归属 e9c4214+）；entries.json=140 个 id；MEMORY.md 140 id 且渲染 0 丢弃；errors.log 无新 `memory regression:`。
- 用户拍板 threshold 报错修法：选项①只改文案（可立即做）或选项②让 `400k` 折成比例（需明确同意）。
- 方案 D（3-hex id）：A 已让 id 不再吞事实，D 只增余量并会重置现有年龄——默认不做。
- 观察 `context-injection.test.mjs` 偶发失败是否在无并发写入时复现（旧项，未定性）。
- 被误留的旧会话 session-88ada514 需在客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档（旧项）。
- 只读闭合复核 subagent 69845585（上一会话发起）若仍待回，报告到达后逐条复现其发现、阻塞项当场修。

<!-- latest-session-title: z8-acceptance: proved the host runs a stale build; answered the threshold token-vs-ratio question -->
