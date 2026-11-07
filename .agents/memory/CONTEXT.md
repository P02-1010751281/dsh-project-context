# Project Context

Last updated: 2026-11-07T01:37:51.605Z

## Summary

2026-11-07 上午接续记忆预算决策：用户选了「抬 maxMemoryChars」，已从 40000 抬到 45000（desktop + web 对齐，备份 cordis.patch.yml.bak-20261107-0900-maxmemory45000），依据是按日志签名重建的 43016 字符回复在 40000 下丢 11 条跨 3 节、在 45000 下 0 丢、breakeven 43500。随后用户对两个未决行为问题选「两个都修」，已实现并提交 44b70d4：(a) 输出预算造成的裁剪视图不再写回（新状态 fit-capped-refused，模型调用前拒绝；截断重试的 fit 会隐藏内容时不发送该重试）；(b) 骨架回复不再发布 context 半边（contextRefused 增加第三个条件臂）。两个缺陷都有离线实测与变异校验过的回归测试。09:29 接续会话复核了落地状态并重跑门禁（497 通过 / 0 失败，lib/ 在 tsc 重新 emit 后仍与 HEAD 一致），同时证伪了上一轮对推送失败归因：不是整机出网故障，直连出站正常、只有经代理的路径全死，故障在代理栈数据面。用户 09:30 选择「先重启验证已落地的 4 个提交，回来再做 clipped 清理批次」。现在卡在两件事，都要用户动手：宿主 pid 5455 启动于 2026-11-06 23:02:04，早于全部待生效提交；git push 仍失败，两个本地提交未推。

## Key points

- 判据（09:29 现读）：最后一个 src/ 提交 44b70d4 @ 2026-11-07T09:27:32+08:00；宿主 pid 5455 启动于 2026-11-06 23:02:04，早于全部待生效提交。需要加载的只有 2 个行为提交：5efaef8 23:11（读上限门禁）、44b70d4 09:27（两个写入修复）；另两个是 docs（874ca18 changelog、324dcb7 记录），不需要进程加载；外加 09:00 的 maxMemoryChars 45000 配置改动。验收看新 pid 启动时刻晚于 2026-11-07T09:27:32+08:00。
- 推送阻塞的真实原因（09:29 实测，取代上一轮的「整机出网故障」）：国内直连正常（baidu 200 / tuna 200），经代理一律 000（google / api.open-meteo），mihomo 对 ✈️Final、GitHub、Google 三个组的 dial 全部 context deadline exceeded，EasyTier overlay 健康（中继 10.126.126.1 3ms、0% 丢包、p2p），dae 反复报 pure SYN refused rewrite of a live flow's routing metadata（outbound=0，目标即代理节点本身 112.36.236.164:3533）→ dae 数据面拒绝重写发往节点的流，所以 mihomo 的出站 SYN 在本地就死了。结论：故障在代理栈，不是网络本身；mihomo 9097 API 需 secret（401）、配置在 root 凭据路径读不到，故节点健康与订阅有效期无法直接查证。
- maxMemoryChars 现为 45000（desktop + web 同日对齐，2026-11-07 09:00；回退 .bak-20261107-0900-maxmemory45000）；配置与 5efaef8 都要重启才生效。
- 23:14 / 23:21 两次拒绝签名相同（11 whole entry(ies) from 3 section(s)）；重建回复 43016 字符：cap 40000 丢 11 条 / 3 节（与日志逐字对上），cap 45000 丢 0，breakeven 43500，43000 仍差 500。
- 新门禁 fit-capped-refused：首次 fit 命中裁剪即在模型调用前拒绝，杠杆是 maxOutputTokens 或压小文档，回执明确不提 maxMemoryChars；该拒绝只设节流、不写 lastOutcome（那个缓存按 maxMemoryChars 记，会变成死杠杆）。
- 截断重试的 fit 若会隐藏内容则不发送，失败文案改成真实成因；重试只能靠抬高请求 cap 腾地方，不能靠少发内容。实测默认 maxOutputTokens 32768 下即可命中（memory 42199+ctx 16048 隐藏 4232，45247+8164 隐藏 3218，均在读上限内）。
- 骨架回复半写已堵：memoryChanged 排除 semanticEmpty 使 memoryKeptStale 恒 false，导致 contextRefused 看不到该拒绝；现增加 memoryKeptUnderSkeleton（用 basisKey 判据，空库不拦，新项目仍能拿到第一份 CONTEXT.md）。22:28 的现场是 CONTEXT.md 11439 → 3160 且无一行记录。
- 残差（已登记，未收口）：写入路径现在只产出 updated，status 记成 clipped 与落地隐藏计数结构性不可达；移除要连带删回执分支与约 10 条手搓 report 单测，属独立清理批次（用户已选：重启验证后再做）。
- 门禁（09:29 重跑）：pnpm test 497 通过 / 0 失败；lib/ 在 test 自带的 tsc 重新 emit 之后仍与 HEAD 一致（干净），lib/client.js 37270 未变；上一轮的变异轮 3 个变异体全部被杀，lib 内变异标记 0。
- 拒绝的日志措辞可分流：whole entry/ies 或 section 超预算 → budget 半边；cut off by the model output limit → output 半边；fit-capped-refused → 输出预算装不下两份文档（降 maxMemoryChars 无用）。
- maxMemoryChars 是读写同一把尺：注入侧与整理读入同用这个 cap，顺序只能是先写小文档再降 cap。
- 小窗口结论：窗口是声明值不是硬限；本插件没有窗口设置项，读宿主解析的 contextWindow；≤64K 时交接余量与宿主 compaction 的 headroomTokens 65536 都不够。
- 已知噪声：context-injection.test.mjs 偶发失败，是并发写入读仓库自身 memory 文档所致，复跑即绿，未记成已修。

## Open tasks

- 重启（仅用户可执行）：/etc/nixos/scripts/dsh-desktop-restart.sh；重启前不要在设置卡片里保存记忆 cap，卡片若仍显示 40000，一点保存就写回 40000。
- 重启后验收（只看新 pid 启动时刻之后的行）：新 pid 启动时刻晚于 2026-11-07T09:27:32+08:00；git diff --exit-code -- lib 为空；MEMORY.md 出现新 mtime（超过 40000 是 cap 生效的硬证据）；errors.log 在重启后没有新的 would have been stored lossily 行。现成探针：bash .agents/evidence/2026-11-07-restart-acceptance/acceptance.sh（已在重启前跑出阴性对照 PASS/FAIL 均为真实分支）。
- 推送待办：origin/main 停在 874ca18，本地有未推提交（含 324dcb7、44b70d4 与本轮 docs/evidence 提交），现读 git log --oneline origin/main..HEAD 取数。阻塞在代理栈而非出网，修法在用户侧（如 sudo systemctl restart dae，可能连带 mihomo）；我未改动代理配置。恢复后 git push，再核对 origin/main。
- 重启验证通过后做 clipped 清理批次（用户 09:30 选择）：移除结构性不可达的 clipped 状态与落地隐藏计数，连带回执分支与约 10 条用手搓 report 测回执的单测。
- 验证 handoffRetireReplaced 关掉后的效果（用户侧：关闭→保存→/handoff now）；已归档的 c35a7f0f / 3a51f066 需手动取消归档。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: 记忆上限 45000、两个写入缺陷收口与重启前状态 -->
