# dsh 0.2.2-rc.5：宿主实际跑的那条线，还认我们的类型面吗？

只读预检，2026-11-22。候选线就是**正在运行**的那条（`dsh --version` = `0.2.2-rc.5`，本会话的
runtime checkout 也是同一份 store 树）。问的是类型面，不是「我们的代码是否已上线」——后者是
重启前后的事，与本文件无关。

## 0. 为什么要再跑一次

仓库的 `devDependencies` 钉在 `0.1.7-rc.2`，`peer` 写 `>=0.1.7-rc.2`；宿主已经跑到 `0.2.2-rc.5`，
差 5 个 rc。`pnpm typecheck` 只会对着钉住的地板编译，所以它绿**不能**说明新线还认我们。

上一次同一动作是 2026-11-05 对 `0.2.2-rc.1`（见
[../2026-11-05-dsh-022rc1-api-compat/README.md](../2026-11-05-dsh-022rc1-api-compat/README.md)）。
这次重新量，因为线又往前走了（rc.1 → rc.5）。

## 1. 方法

复用 2026-10-03 的生成器（`mk-probe.mjs` / `mk-client-probe.mjs`），但**扩了映射集合**：
`src/host/contract.ts` 直接 import `@deepseek-ai/dsh-session-projection` 与
`@deepseek-ai/dsh-token-meter`，旧脚本的 `HOST_SPEC` 只有六个包，这两个包会从本仓库的
`node_modules`（钉住的地板）解析——探针反而没在量候选线的类型面。客户端半边同理：
`ui-primitives` 的声明会再 import 一串 `dsh-*`，不映射就全部落回旧线。

本目录的 [run-probe.sh](run-probe.sh) 把完整集合与**解析来源计数**写在一起，并把敏感度控制
也串进同一次运行，避免下一次换线重新推导这两件事。

```sh
bash .agents/evidence/2026-11-22-dsh-022rc5-api-compat/run-probe.sh \
  "$(ls -d /nix/store/*-dsh-desktop-0.2.2-rc.5)" /tmp/dsh-probe-022rc5
```

## 2. 结果

| leg | 控制/对照 | 结果 |
|---|---|---|
| 仓库自身 `pnpm typecheck`（对 `0.1.7-rc.2`） | 地板 | `exit 0`，0 error |
| host 半边，8 个映射包 | 同上 | `exit 0`，0 error；**90/90** 解析自候选树，0 自 `node_modules` |
| client 半边，21 个映射项 | 同上 | `exit 0`，0 error；**425/425** 解析自候选树，0 自 `node_modules` |
| 敏感度（把 `dsh-session` 指到 `dsh-llm` 的声明） | 同一配置，必然红 | `exit 2`，**25** 个 error → 探针能红 |
| peer / 装载门 | `dsh --profile <p> --dump-config` | `web` rc=0、`ctxdev` rc=0，四个条目都在、0 个 skip |
| desktop profile | — | CLI 拒绝：`profile "desktop" is managed exclusively by the Electron application`；运行中的 desktop 宿主本身就是 rc.5，本会话的注入来自它 |

`@deepseek-ai/cordis` **未**重映射：它必须解析到 dsh 包自己 `node_modules` 里的那份，否则
`Context` 增强消失、报一墙假错（技能里记的已知陷阱）。

日志：`logs/results.txt`（数字）、`logs/sensitivity-red.log`（25 个 error 的原文）、
`logs/dump-web-rows.txt`（两个 profile 里我们四行的投影）、`logs/typecheck-control.log`（地板控制）。

## 3. 结论

- **rc.5 没有打坏我们使用的类型面**：两半都 0 error，且解析证明量的是候选树。5 个 rc 的跨度里，
  我们触到的 `Session` / 事件 / `Llm` / 命令与投影服务、客户端 `ui-primitives` 等形状仍兼容。
- **不需要为 rc.5 改 `src/`**。这不是「升级完成」——`devDependencies` 仍钉 `0.1.7-rc.2`，抬它属于
  另一件事（改 pin 会牵动 `pnpm-lock.yaml`、两个 profile 与 406-12 的 tgz）。
- **探针本身的洞已补**：旧 wrapper 的映射少两个直接 import 的包，客户端半边还把一串传递依赖
  解析到了地板。现在的 wrapper 对「解析来源」有判据（`repo-node_modules != 0` 即失败），不再靠
  人肉相信 `missing: (none)`。

## 4. 未覆盖

- **0.2.3-alpha.1 未探**：本机没有 `*-dsh-desktop-0.2.3*` 的 store 树，探针无从指向。要量它得先
  装出一个可解析的树（或按声明源码做逐面审读），那是另一步；alpha 也不该直接切。
- **运行期面**：类型面绿不证明行为面没变。行为差异（事件时机、投影内容）只有重启后按
  `.agents/skills/dsh-runtime-line-delta-audit` 逐面读上游源码并现场取证才能说。
