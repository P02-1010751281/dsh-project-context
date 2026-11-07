# Project Context

Last updated: 2026-11-07T01:27:11.842Z

## Summary

2026-11-07 上午接续记忆预算决策：用户选了「抬 maxMemoryChars」，已从 40000 抬到 45000（desktop + web 对齐，备份 cordis.patch.yml.bak-20261107-0900-maxmemory45000），依据是按日志签名重建的 43016 字符回复在 40000 下丢 11 条跨 3 节、在 45000 下 0 丢、breakeven 43500。随后用户对两个未决行为问题选「两个都修」，本会话已实现：(a) 输出预算造成的裁剪视图不再写回（新状态 fit-capped-refused，模型调用前拒绝；截断重试的 fit 会隐藏内容时不发送该重试）；(b) 骨架回复不再发布 context 半边（contextRefused 增加第三个条件臂）。两个缺陷都有离线实测与变异校验过的回归测试。现在卡在重启与推送：宿主 pid 5455 启动于 2026-11-06 23:02:04，早于本轮所有 src/ 提交；git push 因整机出网故障（dae fake-ip 198.18.0.179，SSH 被关闭、TLS EOF、github 与 example.com 均 000）在 09:07 起持续失败，两个本地提交尚未推到 origin。

## Key points

- maxMemoryChars 现为 45000（desktop + web 同日对齐，2026-11-07 09:00；回退 .bak-20261107-0900-maxmemory45000）；配置与 5efaef8 都要重启才生效。
- 23:14 / 23:21 两次拒绝签名相同（11 whole entry(ies) from 3 section(s)）；重建回复 43016 字符：cap 40000 丢 11 条 / 3 节（与日志逐字对上），cap 45000 丢 0，breakeven 43500，43000 仍差 500。
- 新门禁 fit-capped-refused：首次 fit 命中裁剪即在模型调用前拒绝，杠杆是 maxOutputTokens 或压小文档，回执明确不提 maxMemoryChars；该拒绝只设节流、不写 lastOutcome（那个缓存按 maxMemoryChars 记，会变成死杠杆）。
- 截断重试的 fit 若会隐藏内容则不发送，失败文案改成真实成因；重试只能靠抬高请求 cap 腾地方，不能靠少发内容。实测默认 maxOutputTokens 32768 下即可命中（memory 42199+ctx 16048 隐藏 4232，45247+8164 隐藏 3218，均在读上限内）。
- 骨架回复半写已堵：memoryChanged 排除 semanticEmpty 使 memoryKeptStale 恒 false，导致 contextRefused 看不到该拒绝；现增加 memoryKeptUnderSkeleton（用 basisKey 判据，空库不拦，新项目仍能拿到第一份 CONTEXT.md）。22:28 的现场是 CONTEXT.md 11439 → 3160 且无一行记录。
- 残差（已登记，未收口）：写入路径现在只产出 updated，status 记成 clipped 与落地隐藏计数结构性不可达；移除要连带删回执分支与约 10 条手搓 report 单测，属独立清理批次。
- 门禁（现跑）：typecheck 0、build 0（lib/client.js 37270 不变）、pnpm test 497 通过 / 0 失败、lib 内变异标记 0；变异轮 3 个变异体全部被杀，第一版 M2/M3 因 TS 收窄编译失败已判为无效并改形状重跑。
- 拒绝的日志措辞可分流：whole entry/ies 或 section 超预算 → budget 半边；cut off by the model output limit → output 半边；fit-capped-refused → 输出预算装不下两份文档（降 maxMemoryChars 无用）。
- maxMemoryChars 是读写同一把尺：注入侧与整理读入同用这个 cap，顺序只能是先写小文档再降 cap。
- 小窗口结论：窗口是声明值不是硬限；本插件没有窗口设置项，读宿主解析的 contextWindow；≤64K 时交接余量与宿主 compaction 的 headroomTokens 65536 都不够。
- 已知噪声：context-injection.test.mjs 偶发失败，是并发写入读仓库自身 memory 文档所致，复跑即绿，未记成已修。

## Open tasks

- 重启（仅用户可执行）：/etc/nixos/scripts/dsh-desktop-restart.sh；重启前不要在设置卡片里保存记忆 cap，卡片若仍显示 40000，一点保存就写回 40000。
- 重启后验收（只看新 pid 启动时刻之后的行）：新 pid 启动时刻晚于本轮最后一个 src/ 提交；git diff --exit-code -- lib 为空；MEMORY.md 出现新 mtime（超过 40000 是 cap 生效的硬证据）；errors.log 在重启后没有新的 would have been stored lossily 行。
- 推送待办：git push 有两个本地提交未推（docs-only 与本次行为修复），09:07 起因出网故障持续失败；恢复后先推，再核对 origin/main。
- 下批候选：移除结构性不可达的 clipped 状态与落地隐藏计数，连带回执分支与约 10 条用手搓 report 测回执的单测。
- 验证 handoffRetireReplaced 关掉后的效果（用户侧：关闭→保存→/handoff now）；已归档的 c35a7f0f / 3a51f066 需手动取消归档。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: 记忆上限 45000、两个写入缺陷收口与重启前状态 -->
