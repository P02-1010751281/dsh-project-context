# Project Context

Last updated: 2026-11-07T01:05:52.185Z

## Summary

2026-11-07 上午接续记忆预算决策：上一轮给出三选一（再压文档 / 抬 maxMemoryChars / 接受冻结），用户选 ②，已把 maxMemoryChars 从 40000 抬到 45000（desktop 与 web 两个 profile 对齐，备份 cordis.patch.yml.bak-20261107-0900-maxmemory45000）。依据是离线探针：按日志签名（11 whole entry(ies) from 3 section(s)）重建的 43016 字符回复在 40000 下正好丢 11 条跨 3 节、在 45000 下 0 丢，breakeven 43500，43000 仍差 500；输出侧在 45000 下首调与重试都不裁剪。现在卡在重启：宿主 pid 5455 启动于 2026-11-06 23:02:04，早于最后一个 src/ 提交 5efaef8（23:11:10）和今晨的配置改动，所以读上限门禁与 45000 都尚未加载；仓库 HEAD 874ca18，lib 与 src 一致，本轮只动 evidence 与 CONTEXT.md。

## Key points

- maxMemoryChars 现为 45000（desktop + web 同日对齐，2026-11-07 09:00 改；回退 .bak-20261107-0900-maxmemory45000）；配置与 5efaef8 都要重启才生效，判据是新 pid 启动时刻晚于 2026-11-06T23:11:10+08:00。
- 23:14 与 23:21 两次拒绝签名相同（11 whole entry(ies) from 3 section(s)）；重建回复 43016 字符：cap 40000 丢 11 条 / 3 节（与日志逐字对上），cap 45000 丢 0，breakeven 43500 —— 所以 43000 不够，45000 余 1500。
- 输出侧在 45000 下仍干净（当日 fit：首调约 24429 / 重试约 28525 maxTokens，memoryHidden 0）；重试拟合 breakeven 随 CONTEXT 长度移动（实测 45787–47087），45000 之上只剩 1–2k 字符余量；输入拟合裁剪仍是报告不拒绝。
- 拒绝的日志措辞可分流：whole entry/ies 或 section 超预算 → budget 半边；cut off by the model output limit → output 半边（此时降 maxMemoryChars 无用）。
- maxMemoryChars 是读写同一把尺：注入侧与整理读入同用这个 cap，顺序只能是先写小文档再降 cap；5efaef8 之后读上限截断会在模型调用前直接拒绝（read-capped-refused）。
- 整理 pass 自身也会撞窗（两份文档 + 不可配置的 recent-conversation 块 + 输出预算），压 maxOutputTokens 会让 fitMemoryInput 头尾各剪一刀，唯一无损杠杆是压小两份文档。
- 小窗口结论：窗口是声明值不是硬限；本插件没有窗口设置项，读宿主解析的 contextWindow；≤64K 时交接余量与宿主 compaction 的 headroomTokens 65536 都不够。
- handoffRetireReplaced 默认 true、门在 performHandoff 收尾，重启后四条机器判据已通过。
- 已知噪声：context-injection.test.mjs 偶发失败，是并发写入读仓库自身 memory 文档所致，复跑即绿，未记成已修。

## Open tasks

- 重启（仅用户可执行）：/etc/nixos/scripts/dsh-desktop-restart.sh；重启前不要在设置卡片里保存记忆 cap，卡片若仍显示 40000，一点保存就会写回 40000。
- 重启后验收（只看新 pid 启动时刻之后的日志与文件）：新 pid 启动时刻晚于 2026-11-06T23:11:10+08:00；git diff --exit-code -- lib 为空；MEMORY.md 出现新 mtime（超过 40000 是 cap 生效的硬证据）；errors.log 在重启时刻之后没有新的 would have been stored lossily 行 —— 重启前每次 turn/end 仍按 40000 拒绝，旧行不算。
- 两个未决行为问题（都改 src/、都要重启，用户尚未拍板）：(a) fitMemoryInput 裁剪仍是报告不拒绝，剪过的视图落地会覆盖原文；(b) semanticEmpty 不在 contextRefused 里，memory 骨架被拒时 CONTEXT.md 仍会发布（22:28 因此掉了 7280 字符）。
- 验证 handoffRetireReplaced 关掉后的效果（用户侧：关闭→保存→/handoff now）；已归档的 c35a7f0f / 3a51f066 需手动取消归档。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: 记忆上限 45000 与重启前状态 -->
