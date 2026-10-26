# Project Context

Last updated: 2026-10-26T09:01:36.830Z

## Summary

**本会话由 `session-2498fdec` 交接而来**，用户两个问题：①「会不会有点保守了？」②「根据 dsh 更新调整了吗？」。**①已回答**：`knee(1M) = 157,000`，相对声明窗口是 16%，但相对 DeepSeek-V4.1-Flash 实测膝（130–170K）已在上沿，不是偏早；触发点是 `min(quality, capacity)`，1M 上 quality 绑住，`/handoff budget summary` 抬不上去；想更激进只能用户跑 `/handoff threshold 0.25|0.3`（放弃自适应膝线）。顺带查明**为什么交接没带上一条回答**：批次 J（pi `b4c9405`）删掉生成式摘要后只带「原文尾料 + 指针」，而两个 profile 都设 `handoffBudgetRecentTokens: 0` ⇒ `handoffSplit` 尾料为空、连 `<recent-conversation>` 都不生成；pi 的前提是「无摘要 ⇒ 必须有尾料」，我们的 `0` 把它反过来了（该 `0` 是摘要时代定的，注释仍写「只带摘要」）。唯一杠杆是用户跑 `/handoff budget recent 8000`（代价：与 `## 用户最后一次输入` 块重复，已在案）；可补的小缺口是 pi 的 `carryNothing` 告知。**②进行中**：已用 `npm pack` 拉齐 0.1.7-rc.2 / 0.2.1-rc.2 / 0.2.1-rc.3 三版包到 `/tmp/dsh-delta-2026-10-26/`，读了 32 篇 `docs/upgrade-guide/`。结论：已按更新调整的是 `6109688` 的 `interpolate: false`；新知情项为 context provider 在 request admission 再求值（`refreshContext`，同步纯读 ⇒ 无行为变化，只是中途改文件将在 admission 生效）、`engines.dsh` 优先于 peer 线、`./invariant` 子路径整族删除（未用）、`Session.header.cwd` 被定义为项目身份（我们正读它）、`subagent-activations` 删了 `backgroundMode`（desktop profile 那条已 disabled，无行为只是可清理）。类型面机械 diff：我们 import 的十个符号全部未变形，新增项均 additive。**rc.3 的行为面 diff 未做完**——rc.3 在 store 里只有 CLI bundle，npm 包已下好但审计被宿主重启打断，两个 in-process teammate 也随之死掉。宿主重启后 pid 186739 / 端口 42841，`check.mjs` 现跑 **RESULT: PASS**，代码全部 live。宿主上下文已越过阈值（18%，>157k），本轮结束会再触发一次自动交接。球在用户手上：①要不要 `/handoff budget recent 8000`（或先补 `carryNothing`）②是否清理 desktop profile 的过期 `backgroundMode` ③是否把这轮审计落档。

## Key points

- **保守性结论（现算，不写死）**：`knee(W)` 常量在 [threshold.ts](src/project-handoff/threshold.ts)（渐近 157K、过渡 450K、陡度 0.04），1M 上给出 157k，属 DeepSeek-V4.1-Flash 实测膝 130–170K 的上沿；pi 拟合依据是 46 个 ≥1M 模型 MRCR 膝 p25 127K / p50 157K / p75 190K。触发点由 `tokens = min(quality, capacity)` 决定，1M 上 quality 绑住；`/handoff budget summary` 只收到 override 告警，不抬触发点；更激进的现成杠杆是用户跑 `/handoff threshold <ratio>`。
- **交接不带尾料的完整链路**：`handoffBudgetRecentTokens: 0` → `handoffSplit` 的 `keepChars = 0` → `tail = ""`、无 `<recent-conversation>` 块；种子只剩指针 + `## 用户最后一次输入`（`904152d`，pi post-J 无此块）。本会话首条 `user/message`（607 字符，source kind `dsh-project-context`）即证据。默认 20000 在 `DEFAULT_CONFIG`，两 profile 显式写 0。
- **dsh 0.2.1-rc.2 类型面 diff（机械核对完毕）**：`Session`/`Agent`/`Context`/`UserMessage`/`ContentBlock`/`ToolCallBlock`/`GenerateOptions`/`LlmResolvedModelInfo`/`SettingsFieldSpec`/`SettingsFormLabels` 全部未变形（仅 JSDoc）；新增 `PluginRecord*`、`ConfigureCall`/`LlmCallControls`/`LlmNativeAuth`、ui-primitives 组件均为 additive；`LlmModelContext` 仍是 `{contextWindow}`。
- **dsh 0.2.1-rc.2 行为面新发现**：`refreshContext` 在 request admission 重跑 context providers（指南 `v0.2.1-alpha.1/working-directory`）；`engines.dsh` 若存在则单独决定 peer 兼容；`./invariant` 子路径 v0.2.0-rc.2 整族删除；`Session.header.cwd` 是官方项目身份（`working_directory({cd})` 后记忆仍锚原项目，是该语义不是缺陷）；`tool-subagent` 删 `backgroundMode`/`enableRunInBackground`。
- **未完成**：0.2.1-rc.3 的逐包行为 diff（包已解包在 `/tmp/dsh-delta-2026-10-26/pkgs/0.2.1-rc.3`，store 侧只有 CLI bundle）。两个 in-process 审计 teammate（`dsh-api-diff`、`dsh-behaviour-diff`）随宿主重启死亡，机械面已由我复核，行为面 rc.3 待做。
- **加载态现跑**：宿主 pid 186739（端口 42841），`check.mjs --port 42841` → `RESULT: PASS`，四插件 `include:project-context` active、enabled-但非-active 0，`git diff --exit-code -- lib` 干净。
- **本会话未改代码**：没有新增提交；`MEMORY.md` / `CONTEXT.md` 均未写（插件写路径不由本会话触发）。

## Open tasks

- None recorded

<!-- latest-session-title: Handoff seed carries no verbatim tail by design; dsh 0.2.1-rc.2/rc.3 delta audit (rc.3 behaviour half open) -->
