# Project Context

Last updated: 2026-11-20T02:06:06.079Z

## Summary

从 session-f608b842 交接进入（上一会话交付 Batch V 并写规格，未 push）。本会话先核对磁盘状态，然后做了三件事：① 把本地 25 个提交推到 origin（`7c93969..90d5956`，含 Batch V `90d5956` 与三份 AOCI 调研文档），本地与 origin 齐平；② 把 `~/.dsh/profiles/desktop/package.json` 的 pin 从 `2dc80cc`(11-12) 升到 `90d5956`，只改一行、备份在 `/tmp/pkg-20261120-094621.json`，用 store 里的 pnpm 11.27.0 安装（`+1`、15.6s、lockfile 同步）；③ 校验安装副本：Batch V 四个新模块已就位，`staleness.js`/`anchors.js`/`index.js`/`client.js` 与仓库 sha256 全等，profile 写的 5 个配置键都在现行 `config.ts` 里，`config.ts`/`settings.ts`/`card-fields.ts` 在这 35 个提交里零差异；`peers check` 的 `missing peer @deepseek-ai/dsh-*` 是宿主提供的包、profile 里每个插件（含第三方）都同样列出，非本次引入。**新代码尚未生效**，需用户重启宿主。 随后发现工作区 `.agents/memory/` 被 09:37 那次自动整理 pass 整篇重写：44,996 → 39,900 字符、145 → 150 条，新增 5 条（含 Batch V 的 `46c`、`3d0` 与一条安装点事实），但同时 61 个精确标识符消失（`LoadedMemory.cappedDroppedChars`、`fitted.clipped`、`sectionsSemanticallyEmpty`、`fallbackUpdate`、`cachedProjectRoot`、`HandoffRouteError`、`engines.dsh`、`/etc/nixos` 等）。两份都能被渲染器逐字节往返、0 丢弃，所以不是截断损坏，是内容被概括。`memory.jsonl` 最后一条记录（`ts`/`op`/`text`）的 text 正好 39,900 字符，证明那一 pass 是整篇重生成而非增量改。我没有提交这份重写，HEAD 仍是完整版，工作区停在新版上。 用户追问「有没有可能是 dsh 没更新插件？」——核实结果：显式 SHA pin 的 `git+ssh://` 确实不会自动升级（这点成立，也解释了它一直停在 11-12），但重写不是旧版缺陷：09:37 实际在跑的 `consolidate.js`、`record.js` 与 HEAD sha256 完全相同（`6e6e8e23…`），`index.js` 只差 Batch V 与 `/memory` 状态回执的接线，而 `src/shared/`（提示词、输入裁剪、模型调用）在这 35 个提交里零改动。根因是 tier C 只看 `sectionDropped`/`droppedItems`/`itemTruncated` 三个结构数，信息被概括时三者全为 0，回执照样报 `updated`——这是设计真空档，重启不会改变行为。 已给用户退役三选项：接受重写 / `git checkout -- .agents/memory/` 回退 / 回退后做保留标识符的受控压缩；外加可选把 `maxMemoryChars`（现 profile 设 45,000，默认 40,000）提一档。建议先回退、不要提交，再把「整篇重写会静默概括」记入下一批规格。用户尚未答复。

## Key points

- 本地已与 origin 齐平：推送 `7c93969..90d5956 main -> main`，共 25 个提交，含 Batch V（`90d5956`）与三份 AOCI 调研提交（`01bed31`、`7384eee`、`31619a9`）。
- desktop profile pin 由 `2dc80cc` 升到 `90d5956`（仅 `~/.dsh/profiles/desktop/package.json` 一行，备份 `/tmp/pkg-20261120-094621.json`），用 store 内 pnpm 11.27.0 安装成功，lockfile 同步到新 SHA。
- 安装校验通过：`staleness.js`/`anchors.js`/`index.js`/`client.js` 与仓库 sha256 全等；`staleness-source.js`、`entry-sidecar.js` 已在安装副本；profile 用的 5 个配置键都在现行 `config.ts`；本节 35 个提交里 `config.ts`/`settings.ts`/`card-fields.ts` 零差异。
- `peers check` 里 7 个块的 `missing peer @deepseek-ai/dsh-*` 是宿主自身提供的包（cordis、dsh-session、dsh-commands、dsh-system-prompt、dsh-llm、dsh-tools 等），profile 内所有插件（含第三方 `dsh-context`、`dsh-oil-ui`、`archive-manager`）都同样列出；包本身不拥有任何 missing peer。
- 跑中的宿主仍持旧模块，新代码要重启才加载（host 半边重启生效，client 半边需 `pnpm build` + 标签页硬刷新）。
- 09:37 的自动 pass 把 MEMORY.md 整篇重写：44,996 → 39,900 字符，145 → 150 条，+152/−145 行；新增 5 条，但 61 个精确标识符消失；11 个旧 id 变新 id 属正常（id 由正文 sha256 派生）。
- 两版都能被 `renderMemoryDocument` 逐字节往返、`sectionDropped`/`droppedItems`/`itemTruncated` 全 0，所以「结构完好」不构成「事实未丢」的证据。
- `memory.jsonl` 末条记录 `{ts, op, text}` 的 text 长度 = 39,900，等于落盘文档长度，证明那次是整篇重生成而不是增量编辑。
- 「dsh 没更新」这一层成立但非本次原因：显式 SHA pin 不自动升级（停在 11-12）；但 09:37 在跑的 `consolidate.js`/`record.js` 与 HEAD sha256 相同（`6e6e8e23…`），`src/shared/` 零改动，`index.js` 差异只在 Batch V 与 `/memory` 回执接线。
- 根因是 tier C 只看结构丢弃数：措辞级概括使三个计数器全为 0，回执报 `updated`，重启不会改变这一行为；属设计真空档，需单独设计一道「信息损失」闸。
- profile 的 `maxMemoryChars` 已是 45,000（默认 40,000），文档 44,996 顶格——加 5 条就得砍约 5,000 字符；提高 cap 只买时间，不修根因，且每轮多花提示词 token。
- 改 `renderMemoryDocument` 的调用签名要先读：它是 `(sections, cap: number)`，我一开始传对象导致一次假的「not identical」判定。
- 记忆事实审计要按行抽反引号 token：跨行正则会让抽取错位、既多报又漏报；本轮修正后 74 个 missing 中 13 个仍是纯文本存在、61 个真消失。
- 用户尚未在「接受重写 / 回退 / 回退后受控压缩」中拍板；工作区当前停在 39,900 的重写版，HEAD 为完整的 44,996 版。

## Open tasks

- 等用户定夺 MEMORY.md 的处理方式：① 提交这份 39,900 重写；② `git checkout -- .agents/memory/` 回退到 44,996 完整版；③ 回退后由我做保留标识符的受控压缩（每个消失 token 机械校验仍存在）再经插件写路径落地。当前建议是 ②/③ 而非 ①。
- 若用户同意：把 profile 的 `maxMemoryChars` 提一档（约 52,000）以留余量，并接受每轮提示词 token 增加的代价。
- 把「整篇重写会静默概括、tier C 三个计数器看不到」写成下一批规格的候选条目（信息损失闸），再决定是否动 `src/`。
- 用户执行宿主重启后：确认新 pin 的 Batch V 代码生效（`/memory` 回执行显示 `stale N` 四态），并触发一次整理 pass 确认 `errors.log` 无新 `memory regression:` 行。
- 「调研一下 AOCI」仍未交付：范围为「AOCI 指什么、要文档还是源码核对」先问清；仓库里已有三份 AOCI 调研提交（`01bed31`、`7384eee`、`31619a9`，evidence 目录 09:07 的 `classes.txt`/`classify.mjs`/`probe.mjs`/`output.json` 即该实验），需确认与用户所指是否同一件事。
- V-2（把 stale 数量写进整理提示词）排期待定：先跑几次真实 pass 观察 stale 数量再决定。
- SH-10：插件能否在空闲 agent 上调用 `ctx.compaction.compactNow` 仍未探针验证，未证不得写入承诺。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）仍未拍板，需用户定范围；可选的 `dsh-code-index` 兼容性试验尚未开始。
- `context-injection.test.mjs` 偶发失败未定性（旧项，需在无并发写入时复现）。

<!-- latest-session-title: 推送 Batch V、升 desktop pin 并安装，发现一次自动 pass 静默概括了 MEMORY.md -->
