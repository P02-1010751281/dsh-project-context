# Project Context

Last updated: 2026-11-20T02:31:19.235Z

## Summary

从 session-f608b842 交接进入本会话。先把磁盘核对完、把本地 25 个提交推到 origin（`7c93969..90d5956`，含 Batch V 与三份 AOCI 调研），再把 `~/.dsh/profiles/desktop/package.json` 的 pin 从 `2dc80cc`（11-12）升到 `90d5956`，用 store 内 pnpm 11.27.0 装好并逐文件 sha256 校验（Batch V 四个新模块到位，`staleness.js`/`anchors.js`/`index.js`/`client.js` 与仓库全等，profile 的 5 个配置键都在现行 `config.ts`，`config.ts`/`settings.ts`/`card-fields.ts` 在该区间零差异）；`peers check` 的 `missing peer @deepseek-ai/dsh-*` 是宿主自提供的包，非本次引入。随后发现工作区 `MEMORY.md` 被 09:37、10:06 两次自动 pass 整篇重生成（44,996→39,900→41,659，61 个精确标识符消失、108/145 条被替换），两份都能逐字节往返且三个结构计数全 0 —— 定性为 tier C 只看结构性丢弃数导致的设计真空档，不是截断损坏，也不是「dsh 没更新插件」（显式 SHA pin 确实停在 11-12，但当时在跑的 `consolidate.js`/`record.js` 与 HEAD 相同，只是 `index.js` 差在 Batch V 接线）。按用户「都行」执行：备份三份到 `/tmp`，从 HEAD 恢复 MEMORY.md（44,996 / 145 条），把 profile `cordis.patch.yml` 的 `maxMemoryChars` 从 45,000 提到 52,000（往返一致零丢弃），提交并推送 `b1fe747`、`9ca227a`（新增 `docs/memory-rewrite-loss-gate-spec.md` 并挂上 `docs/README.md`）。随后用户问「回执是不是只能一行」：读源码确认命令回执是服务端拼好的纯文本、客户端保留换行（裸 `/context` 四行、`/session-log tree` 靠缩进），于是把 `/memory` 回执拆成 5 行（与 Batch V 一起进 `d1f1828`），重新打包装到 10:21:13。用户 10:27 重启后验收：宿主启动 10:27:00 > 安装副本 10:21:13，跑的就是新代码；`entries.json` 已是 v2 / 154 条 / 30 个 `sources` 绑定，回执出现 `stale N`，文档 48,560 / 52,000（旧上限 45,000 已被越过），重启后无新错误。但 journal 末条仍停在 10:14（重启前），所以 5 行效果还没被任何一次 pass 跑到，只能由用户跑 `/memory` 验证。另查到 10:22:49 一条 `MALFORMED_RESPONSE`（`record_memory` 参数 JSON 非法，历史第 4 次，错在第 8747 字符不在尾部），该次 pass 整次没写盘；现行 `callWithToolsFallback` 只对 `REQUEST_SHAPE_CODES` 重试，这类错误不消耗无工具重试，属未处理的失败类别（未改代码）。本会话 403,704 / 1,048,576（39%）已越过 40 万阈值，自动交接只在轮次结束评估。

## Key points

- 本地已与 origin 齐平并再推送三个提交（记忆恢复、新规格、回执拆行），工作区干净。
- desktop pin `2dc80cc` → `90d5956`（后随回执修复一并落到 `d1f1828`），安装副本落地 10:21:13，备份 `/tmp/pkg-20261120-094621.json`。
- 重启验收通过：宿主启动 10:27:00 晚于安装 10:21:13 ⇒ 跑新代码；`entries.json` v2 / 154 条 / 30 个 `sources`；`/memory` 回执已带 `stale N`；文档 48,560 / 52,000；重启后无新错误。
- Batch V 的 stale 绑定实测：145 条里 33 条带锚点、共 44 个锚点、38 个唯一文件、`errors.log` 无 drift 报告。
- 两次整篇重写（09:37、10:06）都通过 `renderMemoryDocument` 逐字节往返、三个结构计数全 0 ⇒ 「结构完好」不构成「事实未丢」的证据，根因是 tier C 的盲区，重启不改变行为。
- `memory.jsonl` 末条 text 长度等于当次落盘文档长度，是判断「整篇重生成 vs 增量编辑」的唯一机械证据。
- 恢复基线：MEMORY.md 44,996 / 145 条；备份 `/tmp/head-mem-20261120-100945.md`、`/tmp/rewritten-mem-20261120-100945.md`、`/tmp/rewritten-ctx-20261120-100945.md`。
- profile `cordis.patch.yml` 的 `maxMemoryChars` 45,000 → 52,000（86.5% 占用，余 7,004 字符，往返一致零丢弃）；该文件会被平台设置卡整份回写，保存后须复读该键。
- 命令回执是 `{kind, text}` 纯文本，但客户端**确实折叠**：`GenericCommandCard` 折叠态是一行 `white-space: nowrap` + 省略号的 `outcome.text`，`<pre>` 正文仅在文本含换行时存在且默认收起 ⇒ 单行回执永远无法展开、只能被裁；因此回执首行必须承载要点（`/memory` 首行已改为度量行，路径挪到 `source` 行）。
- 10:22:49 的 `MALFORMED_RESPONSE`：`record_memory` 参数 JSON 非法（位置 8747，非尾部截断），历史第 4 次（11-11×2、11-18、今天），该次 pass 整次没写盘、journal 未变；`callWithToolsFallback` 只对 `REQUEST_SHAPE_CODES` 重试，这类错误不消耗无工具重试。
- 重启后还没有任何整理 pass 落盘（journal 末条 10:14），所以 5 行回执效果只能等用户跑一次 `/memory` 才能确认。
- 本会话 403,704 / 1,048,576（39%），已越过 400,000 阈值，自动交接只在轮次结束评估。
- 审计方法：记忆事实比对必须按行抽反引号 token；`renderMemoryDocument` 签名是 `(sections, cap: number)`，传对象会得到假的 not-identical。

## Open tasks

- 用户跑一次 `/memory`（或等一个落盘 pass），确认回执确实渲染成 5 行；若仍糊成一行则继续查客户端折叠，否则该项闭合。
- 决定是否让 `MALFORMED_RESPONSE` 也消耗那次无工具重试（改为退到四节 Markdown 路径而非整次失败）；落地前先读 pi-ai 抛错是否带结构化字段，禁止字符串匹配 `Tool call "..."`。
- 跑几次真实 pass 后复核 Batch V 的 stale 计数与回执四态，据此给 V-2（把 stale 数量写进整理提示词）排期。
- 实现 `docs/memory-rewrite-loss-gate-spec.md` 的信息损失闸，建议先落 A 的只报不拒版（只改 `src/` 一个判定点 + 回执），再动 `lib/`。
- 每次改动 profile 设置后复读 `cordis.patch.yml` 的 `maxMemoryChars`，防止设置卡整份回写把它冲回 45,000；若被冲回，从 `/tmp/head-mem-20261120-100945.md` 恢复并按旧上限重新校验。
- 「调研一下 AOCI」仍未确认所指：仓库已有 `01bed31`/`7384eee`/`31619a9` 三份 AOCI 调研提交与 evidence 目录（`classes.txt`/`classify.mjs`/`probe.mjs`/`output.json`），需问清是文档还是要源码核对。
- SH-10：插件能否在空闲 agent 上调用 `ctx.compaction.compactNow` 仍未探针验证，未证不得写入承诺。
- P0 补强（`/memory status` 面板扩展、交接回执可视化）仍未拍板，需用户定范围；可选的 `dsh-code-index` 兼容性试验尚未开始。
- `context-injection.test.mjs` 偶发失败未定性（旧项，需在无并发写入时复现）。

<!-- latest-session-title: 推送 Batch V、升 desktop pin、定性整篇重写损失，并完成重启验收 -->
