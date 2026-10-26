# 交接尾料的「带入状态」三态（批次 U，2026-10-26）

用户裁决：交接要和 pi 一样（`handoffBudgetRecentTokens` 回到 `DEFAULT_CONFIG` 的 20000），
于是两个 profile 的 `0` 改成 `20000`，种子也按 pi post-J 的形状说明带入了什么。

## 证据

- `probe.mjs`：驱动构建后的 `lib/`（`handoffSplit` + `handoffArtifacts`），用一条真实形状的
  会话（提问 → 长回答 → 用户决定）打印两种预算下的种子，并按因分退出码：
  `10` 没有尾料、`11` 尾料与「用户最后一次输入」块重复、`12` 干净尾料被说成 trimmed、
  `13` 零预算仍保持沉默。
- `probe-output.txt`：现跑输出，`RESULT: PASS`。可读到的关键形状：
  - 20000：`<recent-conversation>` 在，carry 行是「已原文带入」，**没有** `## 用户最后一次输入`
    块（尾料已含该输入），结尾是 usual closing；
  - 0：没有 `<recent-conversation>`，carry 行是「没有原文带入本会话」，`## 用户最后一次输入`
    块回来并作为唯一载体。

## 判据来源

`src/project-handoff/summary.ts` 的 `continuation`：carry 行三态由 `tail.length` 与
`trimmedTail` 决定；`trimmedTail` 来自 `handoffSplit`（`ConversationSection.clipped`，
4000 字符消息上限 / 1500 字符工具结果上限）。决策块的条件是 `tail.length === 0`。

## 未在线

改成 `src/` ⇒ 需要宿主重启才生效（与 profile 的两处改动同一次重启覆盖）。
