# Project Context

Last updated: 2026-11-07T02:45:26.951Z

## Summary

2026-11-07 上午：记忆上限抬到 45000、两个写入缺陷（输出预算的裁剪视图写回、骨架回复半写）已在 44b70d4 收口，宿主 09:38:45 重启验收 PASS（pid 37757，判据 44b70d4）。随后按用户 09:30 的选择做了 clipped 清理批次并提交 49083b7：先现读源码重新证明「过了两条输入门禁的 pass 必然 clipped = false」这一前提，再删除结构性不可达的 status "clipped"、两个落地隐藏计数、memoryUpdateReply 的 clipped 回执分支与 memoryLossDetail 的一段文案。顺带修掉一处真实的错误成因：write() 里那条「consolidation was given a shortened version …」在门禁落地后只在两条拒绝路径上触发，而那两条根本没跑模型，所以每次触发都是假话，还把读上限与输出预算两个杠杆含糊成一句。这是纯删除，唯一可观察的变化就是那行日志消失。门禁 497/0（用例总数不变），新增 3 条 doesNotMatch 断言钉住「一次拒绝只留一行」，4 个变异体全部被杀。随后独立对抗式复核未能证伪主结论，但抓到 4 处文档/注释不准确，已复现后修掉（296652c 两条注释、f488b6d 技能与 pi triage）；验收探针也补成会开火的检查（52278d8：判据现算、errors.log 真比时刻、memory 那行明说不具判别力）。本批改了 src/，已于 2026-11-07 10:26:57 重启加载（探针 PASS，pid 47653，GUI 39111）；推送仍卡在代理栈（10:28 实测被 198.18.0.179:443 断开）。 用户随后报「交接后归档旧会话 疑似不生效」：对账 81 次交接，归档 80/81，唯一失败是手动 `/handoff now` 的父会话 session-88ada514（其日志在 command/done 后没有 turn/end），机制与修法候选见 Open tasks。

## Key points

- 判据（10:28 现读）：最后一个 src/ 提交仍是 296652c @ 2026-11-07T10:15:56+08:00（只改注释，重建后 lib/ 逐字节未变，行为等同 49083b7）。**已重启**：2026-11-07 10:26:57 旧实例完全退出、10:27:15 host 就绪（GUI 39111）、宿主 pid 47653 启动于 10:26:59 —— 晚于判据，验收探针 `RESULT: PASS` / exit 0，本批与后续全部 docs/evidence 提交均已加载。探针自己现算判据，不再钉死。
- 推送阻塞的真实原因（09:29 实测，取代上一轮的「整机出网故障」）：国内直连正常（baidu 200 / tuna 200），经代理一律 000（google / api.open-meteo），mihomo 对 ✈️Final、GitHub、Google 三个组的 dial 全部 context deadline exceeded，EasyTier overlay 健康（中继 10.126.126.1 3ms、0% 丢包、p2p），dae 反复报 pure SYN refused rewrite of a live flow's routing metadata（outbound=0，目标即代理节点本身 112.36.236.164:3533）→ dae 数据面拒绝重写发往节点的流，所以 mihomo 的出站 SYN 在本地就死了。结论：故障在代理栈，不是网络本身；mihomo 9097 API 需 secret（401）、配置在 root 凭据路径读不到，故节点健康与订阅有效期无法直接查证。 10:28 再试推送仍是 `Connection closed by 198.18.0.179 port 443`（rc=128）——198.18.0.0/15 正是 mihomo 的 fake-ip 段，说明请求被代理接管后在本地就被断开，与上面那批 dial 超时是同一处故障，不是出网问题。
- maxMemoryChars 现为 45000（desktop + web 同日对齐，2026-11-07 09:00；回退 .bak-20261107-0900-maxmemory45000）；配置与 5efaef8 都要重启才生效。
- 23:14 / 23:21 两次拒绝签名相同（11 whole entry(ies) from 3 section(s)）；重建回复 43016 字符：cap 40000 丢 11 条 / 3 节（与日志逐字对上），cap 45000 丢 0，breakeven 43500，43000 仍差 500。
- 新门禁 fit-capped-refused：首次 fit 命中裁剪即在模型调用前拒绝，杠杆是 maxOutputTokens 或压小文档，回执明确不提 maxMemoryChars；该拒绝只设节流、不写 lastOutcome（那个缓存按 maxMemoryChars 记，会变成死杠杆）。
- 截断重试的 fit 若会隐藏内容则不发送，失败文案改成真实成因；重试只能靠抬高请求 cap 腾地方，不能靠少发内容。实测默认 maxOutputTokens 32768 下即可命中（memory 42199+ctx 16048 隐藏 4232，45247+8164 隐藏 3218，均在读上限内）。
- 骨架回复半写已堵：memoryChanged 排除 semanticEmpty 使 memoryKeptStale 恒 false，导致 contextRefused 看不到该拒绝；现增加 memoryKeptUnderSkeleton（用 basisKey 判据，空库不拦，新项目仍能拿到第一份 CONTEXT.md）。22:28 的现场是 CONTEXT.md 11439 → 3160 且无一行记录。
- 残差已收口（本批 49083b7，纯删除）：status "clipped" 与落地隐藏计数已删除——ConsolidateReport 的 memoryHiddenChars/contextHiddenChars、ConsolidationOutcome 的 clipped 全没了。前提是现读源码重新证明的：readCapHidden > 0 与 fitted.clipped 两条门禁都在模型调用前返回，过了门禁必然 cappedDroppedChars = 0、contextReadHiddenChars = 0、fitted.clipped = false，而 usedInput 只在 retryFitted.clipped = false 时才被赋值，故旧的派生式恒为 false。顺带修掉一处真实的错误成因：write() 的 if (outcome.clipped) 日志在门禁落地后只在两条拒绝路径上触发，而那两条根本没跑模型，句子每次都是假的，还把读上限与输出预算两个杠杆含糊成一句——拒绝路径各自已写点名的一行，故删除。
- 独立对抗式复核（2026-11-07 10:20 回）**未能证伪主结论**：7 条逐条给了证据（两条门禁在模型调用前返回、缓存与节流路径不会把拒绝当成非拒绝、src/ 无残留读取、8 个可达 status 都有分支、剩余用例不空转）。**无代码缺陷**；它抓到 4 处文档/注释不准确，都已复现后修掉：两条注释（296652c）与技能 + pi triage（f488b6d）。其中技能里引用的那条 fit 日志是 2026-10-04 的 2b1edc8 就删掉的，属一个月前的既有失真，不是本批引入。
- 验收探针 `.agents/evidence/2026-11-07-restart-acceptance/acceptance.sh` 已没有「只报不判」的行：判据每跑现算；`errors.log` 那行把 `Z` 结尾的 UTC 条目时刻与 `ps lstart` 的本地时刻都换算成 epoch 再比，出现更新的 cap-loss 或时刻不可解析都算 FAIL；`memory` 那行明说文档长度不具判别力（现值 39587 同时低于 40000 与 45000，无法据此判断抬高后的 cap）。三支实测过：真实 PASS / 伪造未来时刻 FAIL / 不可解析 FAIL 且不吐 `integer expression expected`。
- 「交接后归档旧会话」缺陷已定位（未修）：**自动路径 80/80 生效**，唯一失败的是**手动 `/handoff now`**。机制：手动路径把退休记进内存 `pendingRetire`，只由 `turn/end` 消费；而该命令日志里 `command/done` 之后**没有 turn/end**（会话从此闲置），于是永不退休、且**一行日志都不写**。另两处静默：`session/disposed` 直接 `pendingRetire.delete` 不退休；该 Set 在进程内存里，重启即丢。代码前提「手动路径跑在命令的 turn 内」在本机不成立。
- 门禁（10:08 现跑）：pnpm typecheck 0、pnpm build 0（lib/client.js 37270 不变）、pnpm test 497 通过 / 0 失败；用例总数不变（497），因为删的是既有用例内部的 11 行断言与 2 段注释，不是独立用例——上一批 CHANGELOG 写的「约 10 条单测」在数量上不准确。tsc 重新 emit 到临时目录与入库的 lib/ 比对只差 lib/client.js（esbuild 产物）；src/ 与 lib/ 变异标记均 0。本批变异轮 4 个变异体全被杀：拆读上限门禁 → 6 条红；拆输出预算门禁 → 2 条红；把删掉的那条日志复活到读上限分支 → 2 条红（fit 那条保持绿）；复活到 fit 分支 → 1 条红。
- 拒绝的日志措辞可分流：whole entry/ies 或 section 超预算 → budget 半边；cut off by the model output limit → output 半边；fit-capped-refused → 输出预算装不下两份文档（降 maxMemoryChars 无用）。
- 重启后 errors.log 的两处读数都已归因，别当成新缺陷：①第 42 条 would have been stored lossily 在 09:38:36，早于重启 7 秒，是旧代码在 cap 40000 下写的；②4 条 cannot get required service "llm" in inactive context 在 09:38:43，是旧实例销毁期整理尝试，同类行自 2026-10-20 起共 31 条、每次关停成簇出现，属既存噪声。另：MEMORY.md 第 29 行不变量正文引用了截断标记格式，所以 grep 标记会假阳，必须用 isMemoryTruncated + 长度比对判定。
- maxMemoryChars 是读写同一把尺：注入侧与整理读入同用这个 cap，顺序只能是先写小文档再降 cap。
- 小窗口结论：窗口是声明值不是硬限；本插件没有窗口设置项，读宿主解析的 contextWindow；≤64K 时交接余量与宿主 compaction 的 headroomTokens 65536 都不够。
- 已知噪声：context-injection.test.mjs 偶发失败，是并发写入读仓库自身 memory 文档所致，复跑即绿，未记成已修。

## Open tasks

- 重启已完成（2026-11-07 10:26:57 旧实例退出、10:27:15 就绪、pid 47653 启动于 10:26:59），验收探针 `RESULT: PASS` / exit 0。上一次重启（09:38:43）同样已 PASS，两次都留了探针记录。行为层仍待一次 `/memory update`（用户侧）看 cap 45000 下是否还出现 40000 cap 的 lossy 拒绝。
- cap 45000 已由配置与启动次序证明：两个 profile 的 cordis.patch.yml 都是 maxMemoryChars: 45000，desktop 与 09:00 备份的差异只有 40000→45000 一处（09:39 的重写保住了值）。行为层硬证据仍需一次 /memory update（用户侧），看是否不再出现 40000 cap 的 lossy 拒绝。
- 推送待办：origin/main 停在 874ca18，本地有未推提交（现读 git log --oneline origin/main..HEAD 取数，不再写死清单）。阻塞在代理栈而非出网，修法在用户侧（如 sudo systemctl restart dae，可能连带 mihomo）；我未改动代理配置。10:28 实试仍失败（rc=128 / Connection closed by 198.18.0.179:443，fake-ip 段）。恢复后 git push，再核对 origin/main。
- 验证 handoffRetireReplaced 关掉后的效果（用户侧：关闭→保存→/handoff now）；已归档的 c35a7f0f / 3a51f066 需手动取消归档。
- 修交接归档的手动路径（等用户授权）：`scheduleRetirement(ctx, session, reason === "manual")` 拿「是不是手动」冒充「turn 是否真的开着」。候选修法：用 `session.snapshotEvents()` 判断 turn 是否真开（末个 `turn/start` 无配对 `turn/end` 才算开），未开就立即退休；`session/disposed` 丢弃 `pendingRetire` 时写一行日志而不是静默删。开批须带变异轮与独立复核。复现：对账 `.agents/memory/session-logs/*/session.jsonl` 里的「上一会话 id」与 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: clipped 清理批次：删掉不可达状态，顺手修掉一处错误成因 -->
