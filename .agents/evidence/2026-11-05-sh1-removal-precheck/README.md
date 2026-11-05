# `SH-1` 拆除可行性预检（2026-11-05）

`docs/harness/integration.md` §3.2 上一轮登记的是「`SH-1` 不能拆」：包不在依赖里、
`contextBreakdown` 的类型增强来自不依赖的包、锁定版本与运行线的签名不同。
本轮只做**可行性预检**（用户 2026-11-05 同意）：这三条在**我们锁定的 `0.1.7-rc.2` 线**上
是否可满足。零 `src/`、零 `package.json`、零 lockfile 改动 —— 全部发生在 `/tmp` 与 registry 查询。

## 三条候选路径

| 路径 | 做法 | 结果 |
|---|---|---|
| **A** | 两个新包都取 `0.1.7-rc.2`（与我们六包同线，type-only 使用） | **peer 图干净，可通** |
| **B** | 两个新包取运行线 `0.2.2-rc.1` | **装得上，但 7 条 unmet peer** |
| **C** | 整条线升到 `0.2.2-rc.1` + `cordis 4.1.0` | 可行，但是独立的大批次 |

## 证据

- `registry-peers.txt`：两包在两版本都存在。`0.1.7-rc.2` 的 peer 与我们六个包**逐条吻合**
  （`cordis ~4.0.4`、`dsh-* 0.1.7-rc.2`）；`0.2.2-rc.1` 的 peer 钉死整条线
  （`cordis ~4.1.0`、`dsh-session/llm/retry/compaction/... 0.2.2-rc.1`）。
- `peers-check.txt`：B 路在 pnpm 11 下 `install` **EXIT 0**，只打一行
  `[WARN] Issues with peer dependencies found`；`pnpm peers check` 列出 **7 条 unmet peer**
  （`cordis` 装的是 4.0.5 而 0.2.2 的包要 `~4.1.0`；`dsh-session-projection` 装 0.2.2 而
  `dsh-agent` 要 0.1.7-rc.2；`dsh-session`/`dsh-llm` 同样反向）。**「装得上」不等于「接对了」**：
  这正是本仓库最忌的静默错配，而且 install 的退出码不会拦住它。
- `path-a.txt`：A 路 `install` EXIT 0 且**无 WARN**，`pnpm peers check` 输出
  `No peer dependency issues found`；代价是 `auto-install-peers` 把
  `dsh-compaction` / `dsh-llm-retry` / `dsh-compaction-image-offload` / `dsh-timeout` /
  `dsh-util-values` 拉进 lockfile（我们只用类型，不 import 其运行时代码）。
- `type-shapes.txt`：类型互操作性的三项核对 ——
  1. `ContextBreakdownProjection` 两线**逐字相同**（`systemTokens` / `toolsTokens` / `messageTokens`）；
  2. 0.2.2 的 `SessionProjectionSummaryExcluded<T> = T & {brand}` 是**交叉类型**，不删字段；
  3. `snapshot` 的入参：0.1.7 是 `readonly (keyof SessionProjectionMap)[]`，0.2.2 是
     `ProjectionKeySelection = readonly ...[] | ReadonlySet<...>` —— 0.1.7 的入参是运行线的
     **子集**，我们用的数组形式两边都合法；返回的 `ProjectionSnapshot { asOfSeq, values }` 两线逐字相同。

## 结论

1. **B 不可取**：它会把 0.2.2 的投影/计量包硬接到 0.1.7 的 cordis 与 session 上，
   peer 图矛盾只在 `peers check` 里可见。
2. **A 可通**：`@deepseek-ai/dsh-session-projection` 的 `index.d.ts` 用 `declare module
   '@deepseek-ai/cordis'` 增强了 `ctx.sessionProjections: SessionProjectionRegistry`
   （0.1.7 的 `index.d.ts:23-27`），所以加入依赖后，`SH-1` 手写的 `SessionProjectionsLike`
   与 `ctx.get` 的未声明读取都可以换成有类型的服务读取。
3. **C** 是更大的独立批次（cordis 4.1.0 + 八个包 + 整轮兼容/变异/重启），不在预检范围。
4. 因此 §3.2 的判据需要改写成：**(c) 不是「版本相等」，而是「锁定版的签名是运行线的子集，
   且返回形状相同」**。这是判据改写，需要 reviewer 认可，不是免费通过。

## 下一批要证明的（预检没证）

- `pnpm install` 后 `pnpm peers check` 为 0（A 路在探针里已 0，但真实 lockfile 未动）。
- `pnpm typecheck` 0，且把 `['contextBreakdown']` 写成错键必须编译失败（判别器）。
- 变异轮：删掉结构化类型后，任何回退到 `as`/`any` 的走法都要打红具名用例；
  `src/` 从哈希校验过的 `/tmp` 快照恢复，重建后 `lib/` 0 标记。
- 改了 `src/` ⇒ 需要宿主重启才上线（与本轮无关）。

## 复核命令

```sh
cd /mnt/Data/Projects/dsh-project-context

# 两包在两版本的 peer 声明
npm view @deepseek-ai/dsh-session-projection@0.1.7-rc.2 peerDependencies --json
npm view @deepseek-ai/dsh-token-meter@0.2.2-rc.1 peerDependencies --json

# A 路（干净）与 B 路（7 条 unmet）的探针
ls /tmp/sh1-path-a /tmp/sh1-peer-probe 2>/dev/null || echo "探针目录已清理，按 README 的 package.json 重建"
# 判据再跑一遍：
#   A: 见 path-a.txt   -> "No peer dependency issues found"
#   B: 见 peers-check.txt -> 7 × "unmet peer"

# 类型互操作
grep -n -A 3 "interface ContextBreakdownProjection" /tmp/tm017/package/lib/types/projection.d.ts
grep -n "export type ProjectionKeySelection" /tmp/sp022/package/lib/types/index.d.ts
```

## 范围与残留

- 只核了 `dsh-session-projection` 与 `dsh-token-meter` 两个包，未核 `SH-2` 的其余十个服务。
- A 路「类型足够」是读 d.ts 得出的，**没有**在本仓库跑过 `tsc`；这属于下一批的门禁。
- 探针在 `/tmp`（`sh1-path-a`、`sh1-peer-probe`、`tm017`、`tmprobe`、`sp022`），重启即丢；
  需要重跑时按各文件里的 `package.json` 与命令重建。
