# Project Task: z8-acceptance

> created 2026-11-11 · status active · lastSeen 2026-11-11 · title profile rollout: 613cb9f deployed to five install sites, desktop verified live, Windows and 406-12 await their own restart

## Summary

接 z8-acceptance 会话之后继续，本轮把仓库构建（613cb9f，含 Z8e 的合并阈值键与 `lib/shared/threshold-spec.js`）推到了全部安装点，并首次拿到桌面的真实验收：用户 16:43:40 重启后宿主 pid 233258，`dsh-desktop-restart.sh --verify-only` 输出 `RESULT: PASS`、`enabled 但非 active: 0`；`probe.mjs` 报 `the running host executes the code on disk`（磁盘归属 613cb9f）。此前 `include:project-context` 不激活的根因是 profile 装的还是 9225b56：旧代码把 `handoffThreshold` 当成未知配置键在 apply 期抛错——把 desktop/web 的 git pin 升到 613cb9f、用 store pnpm 重装后重启即恢复。`~/.dsh/profiles/web` 同步升级（与仓库逐字节相同、`resolvePluginConfig` 接受 "0.4"→ratio 0.4），`ctxdev` 是 `link:` 无需动作。Windows 侧（`/run/media/user/OS/Users/P02-1/.dsh/profiles/desktop`，`file:./vendor/…tgz`）与「隔壁机器」406-12 用同一套三步换包：`pnpm pack` 出 168 项新 tgz 覆盖同名文件（166→168，仅多 `threshold-spec.{js,d.ts}`）、改 `pnpm-lock.yaml` 唯一一行 integrity、重解包 `node_modules`，随后追加 provenance；两处的 `config.js`/`threshold-spec.js`/`project-handoff/threshold.js`/`client.js` 与本机仓库 HEAD 的 sha256 逐个相同，`package.json` 只差 pack 重排版。两侧 `cordis.patch.yml` 只有 `handoffPendingQuestion: wait`、无阈值键（默认 auto），故不需改配置。406-12 的宿主 pid 2727214 仍在跑旧码，等用户重启。`DSH-AV/.dsh-sec` 四个 profile 都不装本插件，`~/.dsh-sec-web/profiles` 是指向 `~/.dsh/profiles` 的软链（共用同一份 desktop/web）。用户此前问的 `/handoff threshold 400k` 问题已由 Z8e 收敛（用户选了让 token 数可用）：`400k` 现应回 `threshold 400000 tokens`、`/handoff status` 写 `fixed ratio 40%`，待在重启后的宿主上实测。

## Key points

- 桌面验收首次 PASS：`--verify-only` → `RESULT: PASS`，`enabled 但非 active: 0`；探针报 `the running host executes the code on disk`，磁盘归属 613cb9f（宿主 16:43:40 重启，pid 233258）。
- 不激活的根因：profile 装的是 9225b56，旧代码对 `handoffThreshold` 抛 unknown config key，apply 期失败 ⇒ 条目 enabled 但不 active；修法是升 pin/tgz + 重启，不是改 config。
- 升级分布：desktop/web 的 git pin 升到 613cb9f（web 逐字节同仓库、resolve 0.4→ratio 0.4）；ctxdev 是 `link:` 天然最新；Windows（`P02-1/.dsh/profiles/desktop`）与 406-12 换了 168 项新 tgz + lock integrity + 重解包 node_modules。
- tgz 三步法与校验：同名覆盖（`pnpm pack`，package.json 会重排版，只比语义）、lock 唯一 integrity 行、重解包；之后 sha256 比 `lib/shared/config.js`、`lib/shared/threshold-spec.js`、`lib/project-handoff/threshold.js`、`lib/client.js`，并追加 provenance。
- 406-12 = CachyOS 笔记本，easytier 10.126.126.4（LAN 10.42.0.1），其 DSH desktop 宿主 pid 2727214 仍在跑旧码，须用户重启；它从 11-02 的 0.4.3 直接跨到 613cb9f。
- `DSH-AV/.dsh-sec` 四个 profile 全都不装 dsh-project-context；`~/.dsh-sec-web/profiles` 是 `~/.dsh/profiles` 的软链，所以 desktop/web 的升级被共用。
- 两侧 profile 的 `cordis.patch.yml` 只有 `handoffPendingQuestion: wait`，没有阈值键（默认 auto），换包后无需改配置。
- Z8e 已随 613cb9f 落地：合并阈值键 `handoffThreshold`，`src/shared/threshold-spec.ts` 的 `resolvePluginConfig` 同时接受 auto / 窗口比例 / 绝对 token 数（`400k` → `threshold 400000 tokens`，`0.4` → 回执 `fixed ratio 40%`），此前「只接受比例」的断言与对应报错文案都已被取代。
- 备份/回滚点：`/tmp/profile-desktop-20261111-162539`、`/tmp/profile-web-20261111-164942`、`~/.cache/win-pctx-backup-20261111-165019`、406-12 的 `~/.cache/pctx-backup-20261111-172424`。
- 本轮只动 profile 与文档，未改 `src/`/`test/`，故 `lib/` 零漂移（HEAD=origin=cca4444，工作树干净）。

## Open tasks

- 用户：重启 406-12 的 DSH 桌面宿主（pid 2727214 仍跑旧码），重启后新构建生效；本机 Windows 侧下次启动 DSH 自动加载新包。
- 用户：在本机触发一次 `/memory update` 修掉 `MEMORY.md` 第 57/58 行的旧断言（`handoffThresholdAuto`、「从不接受 token 数」）；文档 44,997/45,000 只剩 3 字符余量，pass 必须先腾空间。
- 用户：在已重启的本机宿主上验 Z8e —— `/handoff threshold 400k` 应回 `threshold 400000 tokens`、`/handoff status` 写 `fixed ratio 40%`、设置卡片只剩一行阈值文本。
- 观察 `context-injection.test.mjs` 偶发失败是否在无并发写入时复现（旧项，未定性）。
- 被误留的旧会话 session-88ada514 需客户端手动归档；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档（旧项）。
- 只读闭合复核 subagent 69845585（上一会话发起）若仍待回，报告到达后逐条复现其发现、阻塞项当场修。
- 方案 D（3-hex id）默认不做：A 已让 id 不再吞事实，D 只增余量且会重置现有年龄。

<!-- latest-session-title: profile rollout: 613cb9f deployed to five install sites, desktop verified live, Windows and 406-12 await their own restart -->
