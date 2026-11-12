# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-12 · title 方案 D（三位 id）已在运行宿主上迁移生效：147 条全三位、时钟继承；406-12 已重启；cap 只剩 27 字符

## Summary

批次 Z8f（方案 D：条目 id 四位→三位）已实现、验证并部署到五处安装点，且**已经在运行中的宿主上真正迁移生效**，没有等重启：本机宿主进程仍是 08:48:47 启动的 pid 79211，但 inspector 读到的常驻 `retirement.js` 已含 `slice(0, 3)` 与 `LEGACY_TID_MARKER`——插件模块被热换（宿主对模块的一次性热替换），随后的整理 pass 就把 `MEMORY.md` 从 146 条四位 id 迁到 147 条三位 id。核验：147 条全部 `（xxx）`、0 条四位，`renderMemoryDocument` round-trip 逐字节相同、`sectionDropped`/`droppedItems`/`itemTruncated` 全 0、文档无截断标记；`entries.json` 147 个键全为 3 字符，**80 条日期仍是 2026-11-11**（迁移按截断继承，没有整体重置），另 67 条是 11-12——那是 11:13 pass 改写正文后 id 重新派生所致（正文派生 id 的固有行为，不是迁移引入的）。406-12 的宿主已在 19:57:51 重启（pid 805948），其安装包同样含三位 id 代码。当前最紧的问题不是 id 而是空间：`MEMORY.md` 44,973/45,000，**只剩 27 字符**；09:22 那次 pass 已被 `lossy-refused`（会丢 4 条整条目，store 未动）。

## Key points

- id 三位已生效：147 条全 `（xxx）`、0 条四位；round-trip 逐字节相同、dropped 0、无截断标记；分节 P17 / I67 / P46 / Ix17。
- 时钟继承成立：`entries.json` 147 键全 3 字符，80 条仍 2026-11-11、67 条 11-12（后者是 11:13 pass 改写正文重派生，非迁移重置）。
- 本机宿主未重启却已跑新码：pid 79211（08:48:47 启动），inspector 读到 `retirement.js` 含 `slice(0, 3)` + `LEGACY_TID_MARKER` ⇒ 热换；为求全进程确定性，重启仍建议做一次。
- 406-12 宿主 19:57:51 重启（pid 805948），安装包含三位 id 代码（`slice(0, 3)` 命中 4 处）。
- cap 危急：MEMORY.md 44,973/45,000（剩 27）；09:22 的 pass `lossy-refused`（4 条整条目会丢，store 未动）。下一次想加任何内容的 pass 都会撞 cap。
- 五处安装点均为 `2dc80cc`：desktop/web 改 git pin + store pnpm 重装；Windows P02-1 与 406-12 换同名 tgz + lock integrity + 重解包（168 文件、四文件 sha256 与 HEAD 同、provenance 已追加）。
- `errors.log` 的 `memory regression: N …` 是按正文比对的措辞误报：11:13 报的 4 条我核过，都在文档里、只是措辞改了。
- 回滚点：`~/.cache/pctx-pin-20261112-desktop|web/`、`~/.cache/pctx-backup-20261112-0920/`（406-12）、`~/.cache/win-pctx-backup-20261112-1112/`。

## Open tasks

- 用户决定空间：要么删约 10 条低价值条目（内容多在 CHANGELOG），要么提高 `maxMemoryChars`（记忆里的裁定：调高只加剧输出上限那一半）。
- 本机 desktop 重启一次（可选但建议），使进程内每个模块都确定是 `2dc80cc`；之后只读复核 `--verify-only` PASS。
- Windows P02-1 下次启动 DSH 自动加载新包（已换好，无需再动）。
- (旧) 被误留的旧会话 session-88ada514 需客户端手动归档；已归档 c35a7f0f / 3a51f066 需按用户判断取消归档。
- (旧) 只读闭合复核 subagent 69845585 若仍待回，报告到达后逐条复现其发现，阻塞项当场修。

<!-- latest-session-title: 方案 D（三位 id）已在运行宿主上迁移生效：147 条全三位、时钟继承；406-12 已重启；cap 只剩 27 字符 -->
