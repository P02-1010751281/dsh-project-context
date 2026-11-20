# Project Context

Last updated: 2026-11-20T02:14:19.950Z

## Summary

从 session-f608b842 交接进入。本会话先核对磁盘状态，把本地 25 个提交推到 origin（`7c93969..90d5956`，含 Batch V 与三份 AOCI 调研文档），本地与 origin 齐平；再把 `~/.dsh/profiles/desktop/package.json` 的 pin 从 `2dc80cc`(11-12) 升到 `90d5956`，只改一行、备份在 `/tmp/pkg-20261120-094621.json`，用 store 里的 pnpm 11.27.0 安装（`+1`、15.6s、lockfile 同步）；随后校验安装副本：Batch V 四个新模块已就位，`staleness.js`/`anchors.js`/`index.js`/`client.js` 与仓库 sha256 全等，profile 写的 5 个配置键都在现行 `config.ts` 里，`config.ts`/`settings.ts`/`card-fields.ts` 在这 35 个提交里零差异；`peers check` 的 `missing peer @deepseek-ai/dsh-*` 是宿主提供的包，profile 里每个插件（含第三方）都同样列出，非本次引入。新代码尚未生效，需用户重启宿主。 随后发现工作区 `.agents/memory/MEMORY.md` 被 09:37 的自动整理 pass 整篇重生成（44,996 → 39,900 字符、145 → 150 条，61 个精确标识符消失），10:06 又重写一次（157 条，145 条里 108 条被替换、新增 120 条）。两份都能被渲染器逐字节往返、三个结构计数器全 0，所以不是截断损坏，是措辞被概括。核查「是否 dsh 没更新插件」：显式 SHA pin 确实不自动升级，但 09:37 实际在跑的 `consolidate.js`/`record.js` 与 HEAD sha256 完全相同（`6e6e8e23…`），`src/shared/` 在这 35 个提交里零改动，`index.js` 差异只在于 Batch V 与 `/memory` 状态回执接线——根因是 tier C 只看结构丢弃数，信息被概括时三者全为 0，回执照样报 `updated`，属设计真空档，重启不会改变行为；`memory.jsonl` 末条记录的 text 长度恰等于落盘文档长度，证明是整篇重生成。 用户说「都行」，于是按建议执行：先备份三份到 `/tmp`，`git checkout` 恢复 MEMORY.md 到 44,996 完整版（61 个标识符全部回来），把 profile `cordis.patch.yml` 的 `maxMemoryChars` 从 45,000 提到 52,000（`yaml` 解析验证，余量 7,004 字符 / 86.5%，往返一致零丢弃），提交 `b1fe747`（记忆摘要）与 `9ca227a`（新规格 `docs/memory-rewrite-loss-gate-spec.md` 并挂上 `docs/README.md`），已推送，工作区干净。发现该 `cordis.patch.yml` 在我备份之后被平台又写过一次（新增 `hy4-flash-free`、若干 `maxTokens` 上调），说明设置面会整份回写，52,000 有被冲回的风险。宿主尚未重启。

## Key points

- 本地已与 origin 齐平：`7c93969..90d5956` 共 25 个提交，含 Batch V（`90d5956`）与三份 AOCI 调研提交（`01bed31`、`7384eee`、`31619a9`）；之后又推送 `b1fe747`、`9ca227a`。
- desktop profile pin `2dc80cc` → `90d5956`（`~/.dsh/profiles/desktop/package.json` 一行，备份 `/tmp/pkg-20261120-094621.json`），store 内 pnpm 11.27.0 安装成功，lockfile 同步到新 SHA。
- 安装校验通过：`staleness.js`/`anchors.js`/`index.js`/`client.js` 与仓库 sha256 全等；`staleness-source.js`、`entry-sidecar.js` 已在安装副本；profile 的 5 个配置键都在现行 `config.ts`；这 35 个提交里 `config.ts`/`settings.ts`/`card-fields.ts` 零差异。
- `peers check` 的 `missing peer @deepseek-ai/dsh-*` 是宿主自身提供的包（cordis、dsh-session、dsh-commands、dsh-system-prompt、dsh-llm、dsh-tools 等），profile 内所有插件（含第三方）都同样列出。
- 跑中的宿主仍持旧模块，新代码要重启才加载（host 半边重启生效，client 半边需 `pnpm build` + 标签页硬刷新）。
- 两轮自动 pass（09:37、10:06）都整篇重生成 MEMORY.md：44,996→39,900（145→150 条，+152/−145 行，61 个精确标识符消失），再→41,659（157 条，145 条里 108 条被替换、新增 120 条）；11 个旧 id 变新 id 属正常（id 由正文 sha256 派生）。
- 两版都能被 `renderMemoryDocument` 逐字节往返、`sectionDropped`/`droppedItems`/`itemTruncated` 全 0，所以「结构完好」不构成「事实未丢」的证据。
- `memory.jsonl` 末条记录 `{ts, op, text}` 的 text 长度（39,900、41,659）分别等于当次落盘文档长度，证明是整篇重生成而非增量编辑。
- 「dsh 没更新」成立但非本次原因：显式 SHA pin 不自动升级（停在 11-12）；09:37 在跑的 `consolidate.js`/`record.js` 与 HEAD sha256 相同（`6e6e8e23…`），`src/shared/` 零改动，只有 `index.js` 差在 Batch V 与 `/memory` 回执接线。
- 根因是 tier C 只看 `sectionDropped`/`droppedItems`/`itemTruncated`：措辞级概括使三者全为 0，回执照报 `updated`，重启不改变行为。
- 已恢复 MEMORY.md 到 44,996 / 145 条（HEAD 版），重写版备份在 `/tmp/rewritten-mem-20261120-100945.md`、上下文备份 `/tmp/rewritten-ctx-20261120-100945.md`、HEAD 版 `/tmp/head-mem-20261120-100945.md`。
- profile `cordis.patch.yml` 的 `maxMemoryChars` 45,000 → 52,000，`yaml` 解析验证 `project-context` 读到 52,000；44,996/52,000 = 86.5%，余 7,004 字符，往返一致零丢弃。
- 该 `cordis.patch.yml` 在我备份后被平台整份回写过（新增 `auto/hy4-flash-free`、`opencode-zen-free/hy4-flash-free`、若干 `maxTokens` 上调），说明设置卡保存会覆盖手改的 `maxMemoryChars`。
- 新规格 `docs/memory-rewrite-loss-gate-spec.md`（tier C 盲区：A 标识符存活校验 / B 补丁式回复 / C 模型自报，推荐先做 A 的只报不拒版），§8 三条复现命令都实跑验证（journal 尾长 41,659、token diff 553/522/缺 72、结构计数 0 0 0）。
- 审计方法修正：记忆事实比对必须按行抽反引号 token，跨行正则会让抽取错位、既多报又漏报（74 missing 中 13 个其实以纯文本存在）。
- `renderMemoryDocument` 签名是 `(sections, cap: number)`，传对象会得到假的「not identical」判定。

## Open tasks

- 用户执行桌面宿主重启（`/etc/nixos/scripts/dsh-desktop-restart.sh`，从 dsh 会话跑会退出码 3），重启前先确认 profile 里 `maxMemoryChars` 仍是 52000——设置卡若保存过会把整份配置从平台状态重写。
- 重启后验收 Batch V：`/memory` 回执出现 `stale N` 四态、`.agents/memory/entries.json` 升到 v2 并写出 `sources`、`errors.log` 无新的 `memory regression:` 行。
- 旧模块可能在重启前再触发一次整理 pass 并按旧的 45,000 覆盖恢复后的 MEMORY.md；若发生，重启后从 `/tmp/head-mem-20261120-100945.md` 再恢复一次并重新校验。
- 决定是否实现 `docs/memory-rewrite-loss-gate-spec.md` 的信息损失闸（建议先落 A 的只报不拒版，只改 `src/` 一个判定点 + 回执），再动 `src/` 与 `lib/`。
- 「调研一下 AOCI」仍未交付：需先问清所指（要文档还是源码核对）；仓库已有三份 AOCI 调研提交（`01bed31`、`7384eee`、`31619a9`，evidence 目录 09:07 的 `classes.txt`/`classify.mjs`/`probe.mjs`/`output.json`），需确认与用户所指是否同一件事。
- V-2（把 stale 数量写进整理提示词）排期待定：先跑几次真实 pass 观察 stale 数量再决定。
- SH-10：插件能否在空闲 agent 上调用 `ctx.compaction.compactNow` 仍未探针验证，未证不得写入承诺。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）仍未拍板，需用户定范围；可选的 `dsh-code-index` 兼容性试验尚未开始。
- `context-injection.test.mjs` 偶发失败未定性（旧项，需在无并发写入时复现）。

<!-- latest-session-title: 推送 Batch V、升 desktop pin，并修掉一次整篇重写的记忆损失 -->
