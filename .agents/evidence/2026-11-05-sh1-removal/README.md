# `SH-1` 拆除（2026-11-05 落地）

用户 2026-11-05 选择「整批做完」。本批把 `src/project-handoff/runtime.ts` 的手写结构化视图
`SessionProjectionsLike` 删掉，改为两个包的声明类型，并补上**判别器**与**变异轮**。
预检（同日前一份）只证明可行性；本记录证明落地。

## 1. 改了什么

| 文件 | 改动 |
|---|---|
| `src/project-handoff/runtime.ts` | 删 `SessionProjectionsLike`；`projectionEnvelope` / `measuredContext` 改用 `SessionProjectionRegistry`；新增两个 type-only import |
| `src/project-handoff/gate.ts` | `ctx.get("sessionProjections") as …` → `ctx.get("sessionProjections")` |
| `src/project-handoff/command.ts` | 同上 |
| `package.json` | `devDependencies` 加 `@deepseek-ai/dsh-session-projection`、`@deepseek-ai/dsh-token-meter`（都是 `0.1.7-rc.2`） |
| `test/projection-typing.test.mjs` + `test/fixtures/projection-typing/` | 新增判别器（见 §4） |

**不加 `peerDependencies`**：两个服务都是可选的（`projectionEnvelope` 在缺失时返回 `undefined`，
回执写 `harness envelope unavailable`），而 peer 是「宿主必须提供」的契约；加进 peer 会把门禁从
6 条收紧到 8 条，并让能优雅降级的老宿主在 peer 判定上失败。类型导入编译后擦除，运行时不依赖它们。

## 2. 为什么是两个包（不是「顺手多装一个」）

那一行代码同时依赖两份类型：

```ts
projections.snapshot(session, ["contextBreakdown"]).values.contextBreakdown
```

- `sessionProjections` 服务 —— 由 `@deepseek-ai/dsh-session-projection` 的
  `declare module '@deepseek-ai/cordis'` 声明；
- `contextBreakdown` 这个**键** —— **不在**该包自己的 `SessionProjectionMap` 里，由
  `@deepseek-ai/dsh-token-meter` 的 module augmentation 贡献（`lib/types/projection.d.ts:64`）。

实测（`probe-no-meter.ts` / `probe-with-meter.ts` 两种同构程序）：

| 程序 | 结果 |
|---|---|
| 只 import session-projection | `error TS2322: Type 'string' is not assignable to type 'never'`（键类型塌成 `never`）+ `error TS2339: Property 'contextBreakdown' does not exist on type 'Partial<SessionProjectionMap>'` |
| 两个都 import | **0 错** |

## 3. 预检的一处错结论（本批纠正）

预检记录称 A 路 `pnpm peers check` → `No peer dependency issues found`。**那条在真实仓库里不成立。**

- 预检跑在干净 `/tmp` 沙盒，pnpm 自行解析到 cordis `4.0.5`，所以看起来干净；
- 真实锁文件把 `cordis` 钉在 **4.0.2**，而 `dsh-agent@0.1.7-rc.2` 本来就要求 `~4.0.4`。

同一把 pnpm（store 自带 `11.28.5`）、同一份 `HEAD` 三件套（`package.json` /
`pnpm-workspace.yaml` / `pnpm-lock.yaml`）复制到 `/tmp/peers-head` 跑对照：

| 状态 | 未满足的 peer 名 | 条数 |
|---|---|---|
| HEAD（改动前） | `@deepseek-ai/cordis`、`@deepseek-ai/schemastery` | **2** |
| 改动后 | `@deepseek-ai/cordis`、`@deepseek-ai/schemastery` | **2** |

`diff` 两份输出，差异只有「wanted by」列表里多了 4 个新包（`dsh-token-meter`、
`dsh-compaction`、`dsh-compaction-image-offload`、`dsh-llm-retry`）——它们并入**既有的**那条
`cordis ~4.0.4` 缺口。

所以正确说法是：**新增 0 条未满足的 peer 名**，而不是「0 条」。这 2 条是既存残差，
修它要动 cordis / schemastery 的 devDeps，属于独立批次，本批不顺手改。

## 4. 判别器（`test/projection-typing.test.mjs`）

一次 `tsc -p test/fixtures/projection-typing/` 跑两个同构 fixture：

- `positive.ts`：真实键 `["contextBreakdown"]` —— 必须 0 诊断；
- `negative.ts`：差一个字的 `["contextBreakdwon"]` —— 必须**恰好 1 条**诊断且点名该键。

**两侧对照都真的开火**（否则判别器恒真）：

| 对照 | 操作 | 结果 |
|---|---|---|
| A：augmentation 是承重的 | 两个 fixture 都去掉 token-meter 的 import | 键类型塌成 `never`，属性报不存在 → 正控制挂 |
| B：读取没退化成 `any` | `negative.ts` 的读取加 `: any` | 差一个字的键编译通过 → 判别器**失败**（`exactly the near-miss key must be rejected`） |

对照 B 一开始暴露过判别器自己的归因错：它报的是「tsc 没产出任何诊断，说明没编译 fixture」，
而真相是两个 fixture 都通过了。已把那句守卫换成让真正失败的断言先开口。

## 5. 变异轮（3 个 mutant，全部被杀）

协议：只改 `src/`，每个 mutant 单独 `tsc` 到 `lib/`，确认标记进了 `lib/`，跑定向测试，
然后从**哈希校验过的** `/tmp` 快照恢复。

| # | 变异 | 编译 | 标记进 `lib/` | 打红的用例 |
|---|---|---|---|---|
| M1 | `projectionEnvelope` 只返回 `systemTokens`，丢掉 `toolsTokens` | 0 错 | 1 | `the status receipt names the term that refused the threshold…`、`the receipt names whether the harness envelope was read…` |
| M2 | 删掉「两个字段都不是数字 → `undefined`」的守卫（畸形值当 0 用） | 0 错 | 1 | `the status receipt names the term that refused the threshold…` |
| M3 | `measuredContext` 把 `envelopeSource: "projection"` 错标成 `"meter"` | 0 错 | 1 | `the receipt names whether the harness envelope was read…` |

恢复后：`sha256sum -c` 通过、`tsc` 重建、`lib/` **0 个变异标记**。

## 6. 门禁

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 0 错（host + client 两半） |
| `pnpm test` | **477/477 通过**（476 基线 + 1 新判别器） |
| `pnpm build` | 通过；`lib/client.js` 28575 bytes |
| `lib/` 变异标记 | 0 |
| `src/` 里 `SessionProjectionsLike` | 0 命中 |

## 7. 环境发现（与本批无关，但会咬人）

`pnpm install` 之后有 **9 个测试文件**在 import `zod` 时崩：`zod@4.6.2` 的安装副本缺 6 个文件
（`v4/core/json-schema.js`、`v4/core/standard-schema.js`、`v3/standard-schema.js`、
`v3/helpers/{enumUtil,partialUtil,typeAliases}.js`、`compile.d.ts`/`.d.cts`）。

- **不是上游的问题**：`npm view zod@4.6.2 dist.tarball` 拉下来的 tarball 含这些文件，
  `diff -rq` 校验后补齐，差异归零。
- **不是本批的问题**：`pnpm-lock.yaml` 里 zod 前后都是 `4.6.2`，没动过。
- 是**安装/存储层**的：store 在 `/mnt/Data/.pnpm-store/v11`（该挂载点 `stat -f` 报
  `0x7366746e` = `ntfs`），`index.db` 无法按文件名核对。补齐后 477/477 全绿。
- 残差：只修了已观测到的这 6 个文件，**没有**对全仓做完整性审计；store 层面是否还会再丢文件未查。

## 8. 未证的边界

1. **还没上线**：改了 `src/` 就需要宿主重启。当前宿主 pid 5210 / 端口 45649 / 启动
   22:52:58，早于本批的 `lib/` 重建，所以跑的是旧字节码。
2. **只证了「可编译的调用面」**：判据是「锁定版签名是运行线（`0.2.2-rc.1`）的子集」，
   不是版本相等。下一个运行线若把 `snapshot` 的 `keys` 收窄或改返回形状，判别器会先红。
3. **`SH-2` 没动**：`ctx.get` 读未声明服务仍是 shim；本批只换掉类型。

## 9. 复核命令

```sh
cd /mnt/Data/Projects/dsh-project-context
PNPM=/nix/store/p9lpls1hljr0xzhw9hrc81qpfq3x4ydv-dsh-desktop-0.2.2-rc.1/lib/dsh-desktop/repo/node_modules/.bin/pnpm

grep -rc SessionProjectionsLike src/              # 期望 0
$PNPM run typecheck                               # 期望 0 错
$PNPM test                                        # 期望 477/477
$PNPM peers check                                 # 期望仍是既存 2 条（cordis / schemastery）
node --test test/projection-typing.test.mjs       # 期望 1/1
```
