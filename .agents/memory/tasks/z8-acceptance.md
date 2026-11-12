# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title 方案 D（三位 id）已热换生效、五处安装点齐；MEMORY.md 合并省 491 至 44,482/45,000（143 条、余 518）

## Summary

本会话接着 z8-acceptance 任务，主题是批次 Z8f（方案 D：条目 id 四位→三位）。该批次此前已实现（部署提交 2dc80cc，typecheck 0、测试 613→617、build ok、五变异矩阵全红到命名用例）并铺到五处安装点。方案 D 是截断式迁移：旧四位 id 截断（29f8→29f）而非重新派生，entries.json 的四位键读时发布成三位（撞车取更早日期），所以首次见到日期继承而非重置；旧四位 supersedes: 目标解析到迁移后 id；截断撞车走既有盐循环重铸。核验显示迁移已在运行中的本机宿主上真正生效、未等重启：宿主 pid 79211 仍是 08:48:47 启动，但 inspector 读到常驻 retirement.js 已含 slice(0, 3) + LEGACY_TID_MARKER（模块被一次性热换），随后的整理 pass 把 MEMORY.md 从 146 条四位迁到 147 条三位。entries.json 147 键全 3 字符，80 条仍 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文后按正文 sha256 重派生 id 所致，是方案的固有行为，不是迁移重置）。本会话在用户挂载 OS 卷后补完 Windows P02-1 的三步换包（tgz sha256 d1877506… 与本机 pnpm pack 逐字节相同；pnpm-lock 第 400 行 integrity 换成新值、旧 613cb9f 残留 0；node_modules 重解包 168 文件；retirement.js/consolidate.js/shared-paths.js/client.js 四文件 sha256 与仓库 HEAD 逐个相同；provenance 已追加），故五处安装点现全为 2dc80cc；406-12 已于 19:57:51 重启（pid 805948）。文档同步：把过时的 tasks/z8-acceptance.md 刷新为当前事实并提交 e27dbe7，随后把 Windows 三步与 e27dbe7 写进任务文档（8706d25），并刷新 AGENTS.md 的快照计数（a9e1395：617 用例、161 个 lib 文件、35 个技能、40 个 .mjs、18,018 行）。空间问题处理掉一半：先是 44,973/45,000 只剩 27 字符、09:22 的 pass 被 lossy-refused（会丢 4 条整条目、store 未动，其定向重试另撞 AUTH 401 登录过期）。20:13 做了一轮不删事实的合并——token Jaccard 扫全部 147 条、最高一对只有 0.31，合并 7 处同一事实的重复陈述（sections.ts 导出与标记约束、/etc/nixos 并入「不要擅自重启宿主」invariant、restart 时陈旧 provider/model 行让出机制细节、406-12 使用点并入 Index 的 ssh 行、tracking boundary 与其唯一静默失败、Index 的 model-call 指针、以及「正文 +6」更正为 +5），净省 491，MEMORY.md 44,482/45,000、143 条、余 518，提交 7afb4f4；复核 round-trip 逐字节相同、dropped 0、loadMemory 内容与磁盘相同、isMemoryTruncated false、pnpm test 617/617。errors.log 里的 memory regression: N … 行是按正文比对的措辞误报（被点名的条目都在、只是改写），09:07 那次把手工压缩采纳为外部编辑属正常。剩下两次重启：本机 desktop（可选但建议，让全进程都确定 2dc80cc）与 Windows P02-1 下次开机自动加载新包。

## Key points

- 方案 D（三位 id）已在运行宿主上真正迁移生效，未等重启：本机宿主 pid 79211 仍 08:48:47 启动，但 inspector 读到常驻 retirement.js 已含 slice(0, 3)+LEGACY_TID_MARKER（一次性热换），随后 pass 把 MEMORY.md 从 146 条四位迁到 147 条三位；20:13 合并后为 143 条、全（xxx）、0 条四位。
- 文档完好（合并后复核）：44,482 字符、round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、无截断标记；分节 P16/I66/P46/Ix15（共 143 条）。
- 时钟继承成立：entries.json 147 键全 3 字符，80 条仍 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文后按 sha256 重派生 id 所致，属方案固有行为，非迁移重置）。
- Windows P02-1 三步换包已补完：tgz sha256 d1877506… 与本机 pnpm pack 逐字节相同；lock 第 400 行 integrity 换成新值、旧 613cb9f 残留 0；node_modules 重解包 168 文件；四关键文件 sha256 与 HEAD 逐个相同；provenance 已追加。回滚 ~/.cache/win-pctx-backup-20261112-1112/。
- 五处安装点现全为 2dc80cc：desktop/web（git pin + store pnpm 重装）、Windows P02-1、406-12（同名 tgz + lock integrity + 重解包）、ctxdev（link: 天然最新）；406-12 已于 19:57:51 重启（pid 805948）。
- 文档提交线：e27dbe7 刷新任务文档、8706d25 落地 20:06 的 pass 写入、a9e1395 刷新 AGENTS.md 快照计数（617 用例、161 lib 文件、35 技能、40 .mjs、18,018 行）、7afb4f4 合并省 491；HEAD = origin/main = 7afb4f4，工作树干净。
- 合并轮结果：7 处同一事实的重复陈述被并掉，净省 491 字符，143 条；token Jaccard 全量扫描最高一对仅 0.31、绝大多数低于 0.15，所以「合并」的天花板就在五百字符量级，再要更多余量只能删有归宿的条目或调 maxMemoryChars。
- 空间现状：MEMORY.md 44,482/45,000、余 518；下一次 pass 加一条 ~300 字符的条目仍放得下，但再加两条就再次撞 cap。09:22 的 lossy-refused（会丢 4 条整条目、store 未动；定向重试另撞 AUTH 401）仍是那次拒绝的物证。
- errors.log 的 memory regression: N … 是按正文比对的措辞误报（被点名条目都在、只是措辞改写）；09:07 那次把手工压缩「采纳为外部编辑」属正常。
- 回滚点：~/.cache/pctx-pin-20261112-desktop、~/.cache/pctx-pin-20261112-web、~/.cache/pctx-backup-20261112-0920（406-12）、~/.cache/win-pctx-backup-20261112-1112（Windows）。

## Open tasks

- 用户定空间路线：518 余量够用则收手；想要 ~1.5k 余量就列 10 条删除候选（按 entries.json 年龄 + CHANGELOG/文档归宿）给用户过目再动手；或调高 maxMemoryChars（记忆裁定：调高只加剧「模型输出上限」那一半，不推荐当唯一手段）。
- 本机 desktop 重启一次（可选但建议）：现在插件模块是热换进来的，重启让整进程都确定 2dc80cc；之后只读复核 --verify-only PASS。
- Windows P02-1 下次启动 DSH 自动加载新包（已换好，无需再动）。
- 旧项：被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 旧项：只读复核 subagent 69845585 已随父会话结束而销毁，实际可勾掉；若仍有报告到达则逐条复现其发现。

<!-- latest-session-title: 方案 D（三位 id）已热换生效、五处安装点齐；MEMORY.md 合并省 491 至 44,482/45,000（143 条、余 518） -->
