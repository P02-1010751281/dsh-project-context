# Project Context

Last updated: 2026-11-26T07:28:22.860Z

## Summary

本会话从 session-1ae81f13 交接续接，上一轮已把 25 份现行文档对源码核过并提交（`4148192`、`93ff955`）。用户对下一步选「3+4」，于是主题变成对 `.agents/skills/`（47 篇）做深度审计与阴性对照：先派两个冷读子代理逐条挑出无法核实的断言（28 条），再由 lead 逐条实测。实测结果推翻了一半：`fitMemoryInput` 的 `clipped` 不是从 24576 起为 false（当前文档 8192–32768 全裁、49152 以上才不裁）；zstd 会话日志不是「每次 append 一批一帧」（9.3 MB / 33,037 事件只有 2 帧）；desktop 与 `dsh web` 不共享 store（本机同时跑两个不同 store 的 desktop、且无 `dsh web`）；pnpm 的 git 依赖锁条目没有 `integrity`（只有 `{commit, repo, type: git}`，该比 `resolution.commit`）；`session/list` 的 `{"args":{"_request":{}}}` 形状在 0.2.2-rc.5 源码里不存在；codex `features list` 的 135 行属已不在 store 的 0.153.4。也确认了几条原本「无法核实」的断言是对的：`/handoff now` 七分支、`--selftest` 有先例（`retitle-accept.mjs`）、上游有 `skippedBundles`、`--dump-config` 对 web/ctxdev 通过而对 desktop 被独占拒绝。顺带纠正上一轮交接里的过期说法：`RULES.md` §11 已清空、`consolidate.ts` 于 2026-11-23 已拆（1241 → 617 行），最大源文件是 `report.ts` 801 行，所以没有「超 400 行待裁定」这回事。测试面也钉死了：`pnpm test` 832 例全通过，裸 `node --test` 会跑 840 并红 2 条（把 `test/fixtures/host-contract/*.ts` 当用例），`node --test test/` rc=1，RULES 6.6 的判据是准的。改动落在六份技能，提交 `a2717ff docs(skill): settle the items the two readers could not verify` 并已推送（远端确认同一 sha），工作树干净。仍只剩必须由用户动手的验证窗口。

## Key points

- 本会话主题由「文档全覆盖」转到「技能库全覆盖」：两轮冷读子代理在 `.agents/skills/` 47 篇里挑出 28 条无法核实的断言，lead 逐条实测收口。
- 实测推翻约一半冷读断言：`fitMemoryInput` 的 `clipped` 随两份文档大小变化（当前 8192–32768 全裁、49152 以上不裁），不能写死 token 门槛。
- zstd 会话日志帧又大又少：实测 9.3 MB / 33,037 事件的 v4 日志只有 2 帧（`zstd -l`），「每次 append 一批一帧」不成立。
- 本机可同时跑两个来自不同 store 的 desktop 宿主（都是 0.2.2-rc.5）且没有 `dsh web`，`dsh --version` 分不出它们，要按 pid 读 argv 里的 `nix-project/<hash>-dsh-desktop-<ver>`。
- pnpm 的 git 依赖锁条目没有 `integrity` 字段（只有 `{commit, repo, type: git}`）；tag pin 与 sha pin 是否等效要比 `resolution.commit`，`v0.5.0` peel 到 `28d2459` 是对的那一半。
- `session/list` 的 `{"args":{"_request":{}}}` 形状在 0.2.2-rc.5 checkout 里不存在（gateway 测试里的 `_request` 是事件回调参数）——RPC 参数形状只能读运行中方法表或按服务端报错确认。
- codex `features list` 的 135 行属已不在 store 的 0.153.4；现 store 只有 0.171.0，`features list` 224 行，那条历史测量永久不可复核（技能已注明）。
- 确认原本「无法核实」但其实正确的：`/handoff now` 七分支、`--selftest` 有先例（`retitle-accept.mjs`）、上游有 `skippedBundles`（`packages/boot/app-boot/src/profile.ts`）、`--dump-config` 对 web/ctxdev rc=0 而 desktop 被 Electron 独占拒绝。
- 上一轮交接里的 `RULES.md` §11 待裁定项已过期：`consolidate.ts` 2026-11-23 已拆（1241 → 617 行，提示词到 `prompt.ts`、回复解析到 `reply.ts`），§11 空、§3.2 不再声明基线，最大源文件是 `report.ts` 801 行。
- `pnpm test` 832/832 通过；裸 `node --test` 跑 840 例并红 2 条（`test/fixtures/host-contract/{positive,negative}.ts` 被当用例），`node --test test/` rc=1，所以 RULES 6.6 的「幽灵用例」判据准确。
- 构建确定性成立：`pnpm build` rc=0，`lib/client.js` 41741 字节，`git diff --exit-code -- lib` 为空。
- 门禁全绿：`pnpm docs:check` 135 项 0 失败、`pnpm boundary:check` 127 文件 0 失败、docgate 对 6 份改动技能失败项 0（48 份技能总失败 0）。
- 提交 `a2717ff docs(skill): settle the items the two readers could not verify`（6 文件、+15/−9）已推送，远端与本地同 sha；本轮累计 6 笔（含上一轮 5 笔）全部推送，工作树干净。
- 仍属用户动手范围：desktop `--dump-config`、`dsh-desktop-restart.sh --verify-only`、`/memory update`、重建客户端后看回执真实折叠、活 RPC 的拒绝形状，以及 codex 0.153.4 那条不可复现的测量。

## Open tasks

- 仅用户可做：从运行中宿主取 desktop 装载证据（`dsh --profile desktop --dump-config` 被 Electron 独占拒绝），及在停机窗口跑 `/etc/nixos/scripts/dsh-desktop-restart.sh --verify-only`。
- 仅用户可做：`/memory update`（用户动作），以及重建客户端后跑一次命令、硬刷新看回执真实折叠效果。
- 仅用户可做：活 RPC（`session/agent-busy`、`workspace/archiveSession`）的拒绝形状——参数形状只在运行中方法表里，且不跨重启沿用。
- 406-12 需用户重启一次才加载 0.5.0；重启后读 loader 条目 config 验四个命名空间与 shared `maxMemoryChars: 48000`，不看 `--verify-only` 整体 RESULT。
- 406-12 的 pin 保持用户手写的 `github:P02-1010751281/dsh-project-context` 不变（用户已裁定，agent 不动）；其上三个 `.bak-20261124-*` 与 `/tmp/vendor-0.4.3-tgz` 待用户确认后清理。
- SH-10 接线前仍差：真实 `performHandoff`/`scheduleRetirement` 与压缩的端到端交叠、压缩后 gate 重算、自动压缩三条路径、其余五个 `ManualCompactionError` 码。
- 残余：`/autolearn` 的 admission / skip 原因句要中文化需 `AutolearnOutcome` 类型变更（「原因」改「码 + 参数」）。
- 接第二个宿主前的三件缺口（`docs/host-context-2c-design.md` §6）：服务 getter 进契约、事件时序写进契约。
- 待用户回答：`--verify-only` 回落到 19387 的假失败是否写进 `docs/`；`include:subagent-claude-code` 为何 enabled 未 active。
- P0 补强与 AOCI 可选动作 A/B 未启动；`overview-cache.v3` 里指向已删探针路径的失效键待在重启窗口决定是否清。
- 记忆余量仍紧（正文已到 54K 上限）：下次记账继续合并同义重述或指针化，动前先按「加事实不丢条目」判余量。

<!-- latest-session-title: 技能库断言审计：冷读的「无法核实」实测后修正六份技能并全部推送 -->
