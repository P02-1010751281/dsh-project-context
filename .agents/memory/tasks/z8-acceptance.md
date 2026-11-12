# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title 方案 D（三位 id）验证已在运行宿主生效、五处安装点全齐；MEMORY.md 用「合并重复条目」省出 491 字符到 44,482/45,000（7afb4f4）

## Summary

本会话接着 z8-acceptance 任务，主体是收尾批次 Z8f（方案 D：条目 id 四位→三位）并把濒临撞顶的 MEMORY.md 救出空间危机。开工核对：HEAD=13d37c7、MEMORY.md 44,170 字符、本机宿主 pid 79211（08:48:47 启动）。会话确认方案 D 已在运行宿主上真正迁移生效、未等重启：inspector 读到常驻 retirement.js 已含 slice(0,3)+LEGACY_TID_MARKER（模块一次性热换），随后整理 pass 把 MEMORY.md 从 146 条四位迁到 147 条三位；当时文档 44,973 字符、round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、无截断标记、分节 P17/I67/P46/Ix17、147 条全三位 0 条四位；entries.json 147 键全 3 字符，80 条仍 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文后按正文 sha256 重派生 id 导致，属方案固有行为、非迁移重置）。用户在会话中挂载 OS 卷后，本会话补完 Windows P02-1 的三步换包（tgz sha256 d1877506… 与本机 pnpm pack 逐字节相同；pnpm-lock 第 400 行 integrity 换成新值、旧 613cb9f 残留 0；node_modules 重解包 168 文件；retirement.js/consolidate.js/shared-paths.js/client.js 四文件 sha256 与仓库 HEAD 逐个相同；provenance 已追加；回滚 ~/.cache/win-pctx-backup-20261112-1112/），故五处安装点现全为 2dc80cc。406-12 已于 19:57:51 重启（pid 805948）。本会话把过时的 tasks/z8-acceptance.md 刷新并入库（e27dbe7，20:06 的 pass 又自刷一版入库为 8706d25），AGENTS.md 快照计数更新到 617 测试/161 lib 文件/35 技能/40 .mjs/18,018 行（a9e1395）。最紧的问题是空间：MEMORY.md 44,973/45,000 只剩 27 字符，09:22 那次 pass 被 lossy-refused（会丢 4 条整条目、store 未动，其定向重试另撞 AUTH 401 登录过期），09:07 那次把手工压缩采纳为外部编辑属正常，errors.log 的 memory regression 行是按正文比对的措辞误报。用户问「或者合并？」，遂用 token Jaccard 扫全部 147 条（最高一对仅 0.31），合并 7 处同一事实在两处重复陈述的位置、未删任何事实，净省 491 字符：MEMORY.md 44,482/45,000（余 518）、143 条、round-trip 逐字节相同、dropped 0、loadMemory 返回内容==磁盘、isMemoryTruncated false、cappedDroppedChars 0、pnpm test 617/617，提交 7afb4f4。防丢事实的机械判据：每条被合并行的所有反引号 token 与数字仍必须出现在合并后的整篇文档里（id 尾标除外）。顺手修两处已变假陈述：406-12『还跑旧码、等用户重启』→ 已在 19:57 重启跑当前构建；『正文 + 6 超 800』→ +5（方案 D 之后的事实变化）。现状 HEAD=origin/main=7afb4f4，工作树干净。自动交接：本会话上下文 401,548/1,048,576（38%），已越 400,000 阈值，仅在轮次结束时评估，轮内越线不会立即触发。

## Key points

- 方案 D（三位 id）已在运行宿主热换生效、未等重启：本机 pid 79211 仍 08:48:47 启动但 retirement.js 已含 slice(0,3)+LEGACY_TID_MARKER，pass 把 MEMORY.md 146 条四位迁到 147 条三位。
- 迁移文档完好：round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、无截断标记、分节 P17/I67/P46/Ix17、147 条全（xxx）0 条四位。
- 时钟继承成立：entries.json 147 键全 3 字符、80 条 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文按 sha256 重派生 id，属方案固有行为非迁移重置）。
- Windows P02-1 三步换包本会话补完（用户挂载 OS 卷后）：tgz sha256 d1877506… 与本机 pnpm pack 逐字节相同；lock 第 400 行 integrity 换新、旧 613cb9f 残留 0；node_modules 重解包 168 文件；四关键文件 sha256 与 HEAD 逐个相同；provenance 已追加；回滚 ~/.cache/win-pctx-backup-20261112-1112/。
- 五处安装点现全为 2dc80cc：desktop/web（git pin + store pnpm 重装）、Windows P02-1、406-12（同名 tgz + lock integrity + 重解包）、ctxdev（link: 天然最新）；406-12 已 19:57:51 重启（pid 805948）。
- 文档刷新入库：tasks/z8-acceptance.md 两版（e27dbe7 手刷、8706d25 由 20:06 pass 自刷）；AGENTS.md 快照计数 11-10→11-12（617 测试/161 lib/35 技能/40 .mjs/18,018 行）提交 a9e1395。
- MEMORY.md 合并：token Jaccard 扫 147 条最高仅 0.31，合并 7 处重复陈述、未删事实，净省 491 字符；44,973→44,482/45,000（余 518）、147→143 条、round-trip 逐字节相同、dropped 0、loadMemory==磁盘、isMemoryTruncated false、pnpm test 617/617，提交 7afb4f4。
- 合并防丢判据：每条被合并行的所有反引号 token 与数字必须仍出现在整篇文档里（id 尾标除外）+ 渲染 round-trip 逐字节相同。
- 顺手修两处已变假陈述：406-12『还跑旧码等重启』→ 已跑当前构建；『正文 + 6 超 800』→ +5。
- 合并天花板约 500 字符：文档已被历次 pass 去重，再要余量只能删事实（CHANGELOG/文档有归宿的）或调高 maxMemoryChars。
- 自动交接：本会话上下文 401,548/1,048,576（38%），已越 400,000 阈值，仅轮次结束时评估，轮内越线不立即触发。
- 回滚点：~/.cache/pctx-pin-20261112-desktop、~/.cache/pctx-pin-20261112-web、~/.cache/pctx-backup-20261112-0920（406-12）、~/.cache/win-pctx-backup-20261112-1112（Windows）。

## Open tasks

- 空间决定待用户定（现状余 518 字符）：够用则到此为止；要 ~1.5k 余量则列出约 10 条删除候选（按 entries.json 年龄 + 是否在 CHANGELOG 有归宿）供过目；或调高 maxMemoryChars（记忆裁定调高只加剧模型输出上限那一半，不推荐当唯一手段）。
- 本机 desktop 重启一次（可选但建议）：现在插件是热换进来的，重启让整进程都确定 2dc80cc，之后只读复核 --verify-only PASS。
- Windows P02-1 下次启动 DSH 自动加载新包（已换好，无需再动）。
- 旧项：被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 旧项：只读复核 subagent 69845585 已随父会话结束而销毁，实际可勾掉；若仍有报告到达则逐条复现其发现。

<!-- latest-session-title: 方案 D（三位 id）验证已在运行宿主生效、五处安装点全齐；MEMORY.md 用「合并重复条目」省出 491 字符到 44,482/45,000（7afb4f4） -->
