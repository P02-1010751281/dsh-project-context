# Project Context

Last updated: 2026-11-24T12:45:44.233Z

## Summary

本会话从 session-278cee57 续接，Batch AC 设置拆分已全部落地并推送。代码：一份 23 键 schema 拆成四份（共用 10 / 记忆 3 / 技能 4 / 交接 6），四个入口各自 `export const Config`，删掉 `effectivePluginConfig`，读取改成 `withShared(livePluginConfig(...), effectiveSharedSettings(...))` 每次现读；`resolveTarget` 仍从 `currentConfig()` 取路由，所以交接不受拆分影响。落地时两处修正：`handoffLang` 从交接卡移到共用卡（`receiptLanguage` 被四个入口读，规格映射漏了）；发布值必须先窄化到共用键再解析，否则整份 fiber config 被拒并静默回退默认值。客户端：四套行表、移除 `SegmentedTabs`、控制器与组件都接受传入的行表，一个组件服务四个入口。测试：新增 `test/card-config.mjs`（`cardConfig` / `publishSharedFor` / `cardApplied`），16 个套件改为按卡片喂 `apply()`。门禁全绿：typecheck 0、boundary 127 文件 0 失败、docs 138 项 0 失败、test 832/832、build 可复现 `202e467d`（255 个 lib 文件）。提交 `fc414cf`（feat）+ `8cf7af5`（SH-10 证据），已推送，HEAD = origin/main。profile：两个 profile 的 `cordis.patch.yml` 已把错卡键迁到各自条目（备份 `.bak-20261124-2055-settingssplit`），pin 抬到 `8cf7af5`（备份 `package.json.bak-20261124-2100-settingssplit`），装好并与提交逐文件 sha256 比对 255/255 一致、旧 sha 残留 0。等用户重启 desktop 宿主：重启后四张卡应都出现，且 `maxMemoryChars: 54000` 才生效。

## Key points

- HEAD = origin/main = `8cf7af5`；本批代码与 `lib/` 都已提交，pin 一致。
- 四个卡片解析器 `resolveCard` / `resolveSharedConfig` / `resolveMemoryConfig` / `resolveHandoffConfig`（另 `resolveAutolearnConfig`），错卡键抛 `config key "X" belongs to <entry> (<card> card)`。
- 共用十键：`archiveEnabled`、`forceDedupeMs`、`handoffLang`、`maxMemoryChars`、`maxOutputTokens`、`maxTokens`、`model`、`provider`、`sessionSettledDays`、`taskMode`；记忆三键、技能四键、交接六键，合计 23。
- 判据是 `schema.dict`（声明集），不是投影对象：schemastery 会把未声明的键原样透传，所以 `SharedSettingsSchema({handoffEnabled:false})` 的输出里仍带它，但 `dict` 里没有。
- `publishedSharedOf` 先窄化再解析：fiber config 带该条目声明的全部键，整份交给卡片解析器必定抛错并静默钉在 apply 时的默认值（`maxTokens: 8000` 被读回 8192）。
- `test/card-config.mjs` 的 `cardApplied(apply, card)` 同时窄化并发布共享值，所以套件原有夹具语义不变；自带包装的套件必须直接调 entry，经 `cardApplied` 二次窄化会丢掉共享键。
- 两个 profile 都迁完并通过新解析器验证（负控制：`resolveSharedConfig({handoffThreshold})` 抛错）；`handoffLang` 留在交接卡以外，其余值不动。
- `test/client-styles.test.mjs` 现在断言 `rows.map((row) => SPEC_BUILDERS[row.kind](row))` 与 `sections.map(`，因为表已按卡片参数化。

## Open tasks

- 用户重启 desktop 宿主后验四张卡都在、`maxMemoryChars: 54000` 生效（跑 9230 Inspector 探针读运行期 cap，不看 `--verify-only` 的 RESULT）。
- SH-10 的 `result !== null` 已在真实宿主上两次复现（证据 `.agents/evidence/2026-11-24-sh10-compact-result/`）；接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- 406-12 那台机的 tgz 仍停在 `7704e2f`。
- `RULES.md` 第 11 章：`src/project-memory/consolidate.ts` 仍超 400 行线，属用户裁定项。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更。
- 接第二个宿主前的三件（`docs/host-context-2c1-settings-port-spec.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动。

<!-- latest-session-title: Batch AC 设置拆分 -->
