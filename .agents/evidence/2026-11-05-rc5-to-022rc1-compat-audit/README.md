# 0.2.1-rc.5 → 0.2.2-rc.1 换版重启兼容性核对（2026-11-05）

宿主在 2026-11-05 09:52–09:53 期间由用户的 `dsh-desktop-restart.sh` 换版重启：
运行中的桌面从 `0.2.1-rc.5` 换到 `0.2.2-rc.1`，本会话跨过了这次重启。

- 旧宿主：`g8j01xhq…-dsh-desktop-0.2.1-rc.5`，pid 249231，端口 35837
- 新宿主：`p9lpls1h…-dsh-desktop-0.2.2-rc.1`，pid 250828，启动 **2026-11-05 09:53:41**，端口 32891
- 仓库最后一个 `src/` 提交：`e3459c6`（2026-11-04 21:27:10）

本文件只回答两件事：**批次 W 是否真的在跑**，以及**我们依赖的宿主 API 有没有被这次换版改动**。
它不是全量 delta 审计（见文末「范围」）。

## 一、批次 W 已生效

三段证据，缺一不可（skill `dsh-host-build-restart-verify` 第 4 步）：

1. **时间判据**：宿主启动 `2026-11-05 09:53:41` 晚于最后一个 `src/` 提交 `2026-11-04 21:27:10`。
2. **内容判据**：`tsc -p tsconfig.json --outDir /tmp/libcheck` 重编译当前 `src/`，`diff -rq /tmp/libcheck lib/`
   只报 `只在 lib/ 中存在：client.js` —— 这是 client bundle，`tsc` 不产出，属预期唯一差异。
   即 `lib/` 与 `src/` 逐字节一致，提交的不是陈旧产物。
3. **在线判据**：
   ```
   node /etc/nixos/scripts/dsh-live-inventory-probe.mjs \
     --url http://127.0.0.1:32891 \
     --expect dsh-project-context,dsh-project-context/memory,dsh-project-context/autolearn,dsh-project-context/handoff
   ```
   输出四个插件行全部 `✓ active enabled=true`，`enabled 但非 active: 0`，
   store 校验等于 wrapper 的 `p9lpls1h…-dsh-desktop-0.2.2-rc.1`，`RESULT: PASS`。

> 探针默认打 `http://127.0.0.1:19387`（web host）。桌面换版后端口变成 32891，
> 不传 `--url` 会以 `fetch failed ×5` 收场，那不是「宿主没就绪」。

## 二、我们依赖的 API 面：逐条核对

`0.2.2-alpha.2` 的 upgrade-guide 有 14 篇，`0.2.1-rc.4` 有 2 篇。**没有 rc.5 与 0.2.2-rc.1 的专页**，
所以下面每一条都以运行中 store 的 shipped 源码为准。

| 面 | 我们怎么用 | 换版后的状态 |
|---|---|---|
| `ctx.sessionProjections.snapshot(session, keys)` | `runtime.ts:43`：`snapshot(session, ["contextBreakdown"]).values.contextBreakdown` | **不破**。变更说「带 `keys` 时只计算选中的单元」，我们正是显式带了 keys |
| `session.list` 摘要的 `projections` | 不读（`watch.ts` 只读 `summary.origin` / `summary.cwd`，title 走 `binding(...).projections.faceOf("title")`） | **不破**。被移除的 `contextBreakdown` / `contextPressure` 我们从未读过 |
| `SessionSummary.origin` / `.cwd` | `watch.ts:136` 构造 watch 行 | **不破**。`session-controller/src/types.ts` 里 `origin?: 'subagent'`、`cwd?: string` 仍在 |
| `LlmResolvedModelInfo.context` | `shared/model-call.ts` 读 `context.contextWindow`（floor 的唯一上游接缝） | **不破**。`llm/src/types.ts:454` 仍是 `context?: LlmModelContext` |
| `GenerateOptions.purpose` | `shared/model-call.ts:188` 的 `requestOptions` **不设 purpose** | **不适用**。声明化变更只约束「构造辅助请求的插件」；我们既不传 `compaction` 也不自造 purpose |
| Loader / Include 1.0（`EntryTree.write` → `commit`，根 Include 运行时改动不再落盘） | 我们不改 loader 条目；profile 的 `disabled: true` 是 **patch 文件里声明的**，不是运行时变更 | **不破**，但**记忆里那条「dispose 要手工清 `dsh.profile.bundles`」需要重新核实**——它描述的是旧的整树回写行为 |

## 三、顺带可关闭的两个 open task

1. **「是否重启宿主让批次 W 在跑」** —— 已在 2026-11-05 09:53 由用户重启完成，上面三段证据即验收。
2. **「desktop profile 那条 `disabled: true` 行上残留 `backgroundMode: one-shot`」** ——
   现读 `~/.dsh/profiles/desktop/cordis.patch.yml:1114-1115` 只剩：
   ```yaml
   - id: subagent-codex-tool
     disabled: true
   ```
   残留字段已被 settings 层重写掉，无需清理。

## 四、范围与遗留

- 本文件核对的是**我们实际引用的那六个面**，不是 0.2.1-rc.5 → 0.2.2-rc.1 的全量 delta；
  其余 9 篇 guide（`forge-*`、`schedule-*`、`context-menu-target`、`projection-event-frames`、
  `projection-released-checkpoint`、`sdk-run-commands`、`fs-observation-policy-default-off`、
  `cordis-loader-entry-trees` 的其余部分、`model-listing-refresh`、`pi-ai-request-image-count`）
  与本插件四条数据流无直接交集，未逐条展开。
- **type-level 对照仍未跑**：`pnpm typecheck` 编译在 `node_modules` 里的 peer floor（0.1.7-rc.2）上，
  所以这次换版的类型面变化不会让它变红。要真正拿到「类型面兼容」的结论，得走
  skill `dsh-version-upgrade-compat-probe` 的映射-then-tsc 流程（把 dsh 模块指向候选树的 `lib/types`）。
- `fs-observation-policy-default-off` 与我们的文件读取有关，但只影响宿主侧的观察/审批策略，
  插件的 `readFileSync` 路径不变；如后续要做审批门，需重读该 guide。

## 五、复核命令

```bash
# 谁在服务本会话
ss -ltnp | grep 127.0.0.1:          # 桌面端口每次重启都会变
ps -o pid,lstart= -p <holder-pid>

# lib/ 是否等于 src/
rm -rf /tmp/libcheck && ./node_modules/.bin/tsc -p tsconfig.json --outDir /tmp/libcheck
diff -rq /tmp/libcheck lib/          # 只应出现 client.js

# 四个插件行是否 active
node /etc/nixos/scripts/dsh-live-inventory-probe.mjs --url http://127.0.0.1:<port> \
  --expect dsh-project-context,dsh-project-context/memory,dsh-project-context/autolearn,dsh-project-context/handoff
```
