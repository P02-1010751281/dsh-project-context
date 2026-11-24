# Project Context

Last updated: 2026-11-24T13:45:13.647Z

## Summary

本会话从 session-278cee57 续接，完成两件事：批次 AC（设置拆分）全部落地并推送、SH-10 的 compactNow 探针取证，最后由用户要求清掉探针留下的会话桶。 设置拆分（批次 AC）：一份 23 键 schema 拆成四份（共用 10 / 记忆 3 / 技能 4 / 交接 6），四个入口各自 export `Config`，删掉 `effectivePluginConfig`，读取改成 `withShared(livePluginConfig(...), effectiveSharedSettings(...))` 每次现读；`resolveTarget` 仍从 `currentConfig()` 取路由，交接不受拆分影响。客户端四套行表、控制与组件都接受传入行表、移除 `SegmentedTabs`，一个组件服务四个入口。测试新增 `test/card-config.mjs`（`cardConfig` / `publishSharedFor` / `cardApplied`），16 个套件改为按卡片喂 `apply()`，删掉 4 个套件各自的本地 shim。 落地时修正两处会静默出错的问题：`handoffLang` 从交接卡移到共用卡（`receiptLanguage` 被四个入口读，规格映射漏了，§2.2 规则 1）；发布值必须先窄化到共用键再解析，否则整份 fiber config 被拒并静默回退默认值（`maxTokens: 8000` 被读回 8192）。另纠正一处误判：schemastery 对未声明键是原样透传而非丢弃，判据应是 `schema.dict` 而不是投影对象。 门禁全绿：typecheck 0、boundary 127 文件 0 失败、docs 138 项 0 失败、test 832/832、build 可复现 `202e467d`（255 个 lib 文件）。提交 `fc414cf`（feat，settings 拆分本体）+ `8cf7af5`（SH-10 证据）+ `234c3f8`（记忆文档），已推送，HEAD = origin/main = `234c3f8`；`8cf7af5..234c3f8` 只动 `.agents/memory/` 两个文档，`lib/` 未变。 两个 profile 已就绪：`cordis.patch.yml` 把错卡键迁到各自条目（备份 `.bak-20261124-2055-settingssplit`），pin 抬到 `234c3f8`（备份 `package.json.bak-20261124-2100-settingssplit`），用 store 的 pnpm 安装后 255/255 文件逐字节一致、旧 sha 残留 0，负控制验证了错卡键确实抛错。只等用户重启 desktop 宿主。 SH-10：子代理在真实宿主上两次独立复现 `compactNow` 返回非空 result（事件 44→48、surface 节点 13→3、token 5972→1082），用合成事件灌历史、0 次模型调用，探针全在 `/tmp` 且已 dispose；此前「历史太少返回 null」是误读，真实原因是 surface 节点为 0。 清理：用户要求清掉探针桶。实际是 8 个（先前报的 7 个不准，多一个后缀为空的 `--tmp-sh10-probe--`），共 18 个文件约 44KB，mtime 全在 18:32 与 20:04–20:21 探针窗口内；备份到 `/tmp/sh10-bucket-backup/buckets.tar`（50K、41 条目）后逐个校验绝对路径前缀再 `rm -rf`，8/8 成功。核验用户会话 `3772a3fc`（本会话）与 `session-95ba96da` 都在原桶内、未受影响。`~/.dsh/storages/dsh-context/overview-cache.v3/` 的 10 个 shard 里有 8 条指向已删路径的失效键，是第三方 `dsh-context` 的派生索引缓存，宿主正在写（21:14 仍活跃），故未改动，交由下次扫描自然失效重建。 顺带记一个操作坑：目录名以 `--` 开头会被 `find`/`du` 当成选项，必须加 `./` 前缀，否则输出为空却不报错。

## Key points

- HEAD = origin/main = `234c3f8`；`fc414cf` 拆分本体、`8cf7af5` SH-10 证据、`234c3f8` 记忆文档；`8cf7af5..234c3f8` 只动 `.agents/memory/`，`lib/` 未变。
- 四个卡片解析器 `resolveCard` / `resolveSharedConfig` / `resolveMemoryConfig` / `resolveHandoffConfig`（另 `resolveAutolearnConfig`），错卡键抛 `config key "X" belongs to <entry> (<card> card)`。
- 共用十键：`archiveEnabled`、`forceDedupeMs`、`handoffLang`、`maxMemoryChars`、`maxOutputTokens`、`maxTokens`、`model`、`provider`、`sessionSettledDays`、`taskMode`；记忆三键、技能四键、交接六键，合计 23。
- 判据是 `schema.dict`（声明集），不是投影对象：schemastery 会把未声明的键原样透传，所以 `SharedSettingsSchema({handoffEnabled:false})` 的输出里仍带它，但 `dict` 里没有。
- `publishedSharedOf` 先窄化再解析：fiber config 带该条目声明的全部键，整份交给卡片解析器必定抛错并静默钉在 apply 时的默认值（`maxTokens: 8000` 被读回 8192）。
- `test/card-config.mjs` 的 `cardApplied(apply, card)` 同时窄化并发布共享值，所以套件原有夹具语义不变；自带包装的套件必须直接调 entry，经 `cardApplied` 二次窄化会丢掉共享键。
- 两个 profile 都已迁移并通过新解析器验证（负控制：`resolveSharedConfig({handoffThreshold})` 抛错）；`handoffLang` 留在交接卡以外，其余值不动。
- `test/client-styles.test.mjs` 现在断言 `rows.map((row) => SPEC_BUILDERS[row.kind](row))` 与 `sections.map(`，因为表已按卡片参数化。
- SH-10：`compactNow` 在空闲但有 surface 节点的 agent 上返回非空 result（真实宿主两次复现，事件 44→48、节点 13→3、token 5972→1082）；返回 null 的真因是 surface 节点为 0，不是「历史太少」。
- 清掉的 8 个探针桶 mtime 落在 18:32 与 20:04–20:21；备份在 `/tmp/sh10-bucket-backup/buckets.tar`；用户会话 `3772a3fc`、`session-95ba96da` 完好。

## Open tasks

- 用户重启 desktop 宿主后验四张卡（共用/归档、记忆、技能、交接）都在、`maxMemoryChars: 54000` 生效——跑 9230 Inspector 探针读运行期 cap，不看 `--verify-only` 的 RESULT。
- SH-10 接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- `overview-cache.v3` 里 8 条指向已删探针路径的失效键未清（宿主运行中、属第三方派生缓存），待用户裁定是否在重启窗口清理。
- 406-12 那台机的 tgz 仍停在 `7704e2f`。
- `RULES.md` 第 11 章：`src/project-memory/consolidate.ts` 仍超 400 行线，属用户裁定项。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更（「原因」改「码 + 参数」）。
- 接第二个宿主前的三件缺口（`docs/host-context-2c1-settings-port-spec.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动。

<!-- latest-session-title: Batch AC 设置拆分落地并推送；SH-10 取证；清理探针会话桶 -->
