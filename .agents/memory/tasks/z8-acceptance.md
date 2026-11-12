# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title 方案 D（三位 id）已在运行宿主热换生效、五处安装点全齐；任务文档刷新至 e27dbe7；MEMORY.md 仍卡在 44,973/45,000

## Summary

本会话接着 z8-acceptance 任务，主题是批次 Z8f（方案 D：条目 id 四位→三位）。该批次此前已实现（部署提交 2dc80cc，typecheck 0、测试 613→617、build ok、五变异矩阵全红到命名用例）并铺到五处安装点。方案 D 是截断式迁移：旧四位 id 截断（29f8→29f）而非重新派生，entries.json 的四位键读时发布成三位（撞车取更早日期），所以首次见到日期继承而非重置；旧四位 supersedes: 目标解析到迁移后 id；截断撞车走既有盐循环重铸。核验显示迁移已在运行中的本机宿主上真正生效、未等重启：宿主 pid 79211 仍是 08:48:47 启动，但 inspector 读到常驻 retirement.js 已含 slice(0, 3) + LEGACY_TID_MARKER（模块被一次性热换），随后的整理 pass 把 MEMORY.md 从 146 条四位迁到 147 条三位。文档完好：44,973 字符、round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、无截断标记，分节 P17/I67/P46/Ix17；147 条全三位、0 条四位。entries.json 147 键全 3 字符，80 条仍 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文后按正文 sha256 重派生 id 所致，是方案的固有行为，不是迁移重置）。本会话在用户挂载 OS 卷后补完 Windows P02-1 的三步换包（tgz sha256 d1877506… 与本机 pnpm pack 逐字节相同；pnpm-lock 第 400 行 integrity 换成新值、旧 613cb9f 残留 0；node_modules 重解包 168 文件；retirement.js/consolidate.js/shared-paths.js/client.js 四文件 sha256 与仓库 HEAD 逐个相同；provenance 已追加），故五处安装点现全为 2dc80cc。406-12 已于 19:57:51 重启（pid 805948）。本会话还把握手时过时的 tasks/z8-acceptance.md 刷新为当前事实（2186 字符、round-trip 逐字节相同、dropped 0，头行标题与 latest-session-title 注释已对齐）并提交为 e27dbe7（HEAD = origin/main 干净）。最紧的问题仍是空间：MEMORY.md 44,973/45,000，仅剩 27 字符；09:22 那次 pass 被 lossy-refused（会丢 4 条整条目、store 未动；其定向重试另撞 AUTH 401 登录过期），所以任何想新增内容的 pass 现在都会撞 cap。errors.log 里的 memory regression: N … 行是按正文比对的措辞误报（被点名的条目都在、只是改写），09:07 那次把手工压缩采纳为外部编辑属正常。剩下两次重启：本机 desktop（可选但建议，让全进程都确定 2dc80cc）与 Windows P02-1 下次开机自动加载新包。

## Key points

- 方案 D（三位 id）已在运行宿主上真正迁移生效，未等重启：本机宿主 pid 79211 仍 08:48:47 启动，但 inspector 读到常驻 retirement.js 已含 slice(0, 3)+LEGACY_TID_MARKER（一次性热换），随后 pass 把 MEMORY.md 从 146 条四位迁到 147 条三位。
- 文档完好：44,973 字符、round-trip 逐字节相同、sectionDropped/droppedItems/itemTruncated 全 0、无截断标记；分节 P17/I67/P46/Ix17；147 条全（xxx）、0 条四位。
- 时钟继承成立：entries.json 147 键全 3 字符，80 条仍 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文后按 sha256 重派生 id 所致，属方案固有行为，非迁移重置）。
- 本会话补完 Windows P02-1 三步换包（用户挂载 OS 卷后）：tgz sha256 d1877506… 与本机 pnpm pack 逐字节相同；lock 第 400 行 integrity 换成新值、旧 613cb9f 残留 0；node_modules 重解包 168 文件；四关键文件 sha256 与 HEAD 逐个相同；provenance 已追加。回滚 ~/.cache/win-pctx-backup-20261112-1112/。
- 五处安装点现全为 2dc80cc：desktop/web（git pin + store pnpm 重装）、Windows P02-1、406-12（同名 tgz + lock integrity + 重解包）、ctxdev（link: 天然最新）。
- 406-12 已于 19:57:51 重启（pid 805948），安装包含三位 id 代码。
- 本会话把过时的 tasks/z8-acceptance.md 刷新为当前事实（2186 字符、round-trip 逐字节相同、dropped 0，头行标题与 latest-session-title 注释对齐），提交 e27dbe7（docs(memory): record the 3-hex id migration as landed and refresh the z8-acceptance task context）；HEAD = origin/main = e27dbe7，工作树干净。
- cap 危急：MEMORY.md 44,973/45,000（剩 27 字符）；09:22 的 pass lossy-refused（会丢 4 条整条目、store 未动，其定向重试另撞 AUTH 401 登录过期）。下一次想加任何内容的 pass 都会撞 cap。
- errors.log 的 memory regression: N … 是按正文比对的措辞误报（被点名条目都在、只是措辞改写）；09:07 的同日另一行是把手工压缩‘采纳为外部编辑’，属正常。
- 回滚点：~/.cache/pctx-pin-20261112-desktop、~/.cache/pctx-pin-20261112-web、~/.cache/pctx-backup-20261112-0920（406-12）、~/.cache/win-pctx-backup-20261112-1112（Windows）。

## Open tasks

- 用户决定空间：删约 10 条低价值条目（内容多在 CHANGELOG/文档有归宿），或提高 maxMemoryChars（记忆裁定：调高只加剧‘模型输出上限’那一半，不推荐当唯一手段）；下一次新增内容的 pass 必定撞 cap，需先处理。
- 本机 desktop 重启一次（可选但建议）：现在插件模块是热换进来的，重启让整进程都确定 2dc80cc；之后只读复核 --verify-only PASS。
- Windows P02-1 下次启动 DSH 自动加载新包（已换好，无需再动）。
- 旧项：被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档。
- 旧项：只读复核 subagent 69845585 已随父会话结束而销毁，实际可勾掉；若仍有报告到达则逐条复现其发现。

<!-- latest-session-title: 方案 D（三位 id）已在运行宿主热换生效、五处安装点全齐；任务文档刷新至 e27dbe7；MEMORY.md 仍卡在 44,973/45,000 -->
