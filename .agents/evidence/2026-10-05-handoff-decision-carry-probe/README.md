# Handoff decision-carry probe — 2026-10-05

Answers the precondition the **A** proposal states before any `src/` work:

> A: carry the last `ask_user_question` question and answer verbatim into the continuation as its own
> block, independent of `handoffBudgetRecentTokens` and of the wording heuristic. Before implementing,
> a probe must confirm that `session.deriveMessages()` can reach that tool call/result and its
> structured `options` / `selected`.

**Result: the precondition holds.** Both halves of the pair are reachable from `deriveMessages()`.

## Revision read

- This repo: `HEAD == origin/main == f2f56ac`, `git diff --exit-code -- lib` empty (exit 0).
- `@deepseek-ai/dsh-session` **0.1.7-rc.2**, resolved at
  `node_modules/@deepseek-ai/dsh-session/lib/index.js` (`require.resolve` → the pnpm store copy).
- Source read there for the fold: `packages/core/session/src/index.ts` (`deriveMessages()`, "every
  surface node → `deriveEventMessage`, drop nulls"), `packages/core/session/src/surface.ts`
  (`case 'tool/result': return event.data.message`; `MESSAGE_ROLE_BY_TYPE['tool/result'] = 'tool'`),
  and the assertion in `packages/api/session-controller/tests/session-fork.host.spec.ts:484` that
  `deriveMessages().at(-1)` matches `{ source: { kind: 'tool', callId } }`.
- Checkout for the source read:
  `/nix/store/cl7chjvxjw81aizwlxar1k8n9z02yd3b-dsh-desktop-0.2.0-rc.2/lib/dsh-desktop/repo`.

## How to reproduce

```bash
cd /mnt/Data/Projects/dsh-project-context
node .agents/evidence/2026-10-05-handoff-decision-carry-probe/probe.mjs \
  .agents/memory/session-logs/session-8370820f-3290-4fc6-979a-46c68eaef3a1/session.jsonl
node .agents/evidence/2026-10-05-handoff-decision-carry-probe/probe.mjs \
  .agents/memory/session-logs/session-5d0ef0a3-7da3-4cdc-aabf-d4434abdfc70/session.jsonl
```

`probe.mjs` is read-only: it imports `foldSurface` / `deriveEventMessage` from the installed
`@deepseek-ai/dsh-session` and replays exactly the two calls `Session.deriveMessages()` makes, then
scans the result. It touches no host, store, or network.

## Observed

`session-8370820f…` (the session that made the decision) — 92 derived messages from 275 events:

```
ask_user_question tool-call blocks: 1

=== call call_00_2zUXIfKCvkrzXCp6Rc719629 ===
header:   下一步
question: 修复已就绪但宿主未加载（持有者启动 17:17:29 早于 f38a0ba）。接下来怎么做？
  option: "我去重启桌面宿主（推荐）"
  option: "先不重启，直接跑 /memory update"
  option: "跳过验活，直接打下一版 tag"
  option: "先别动，我还有别的事要说"
matching tool result: seq 121
source: {"kind":"tool","callId":"call_00_2zUXIfKCvkrzXCp6Rc719629"}
content: "{\"answers\":[{\"id\":\"next\",\"selected\":[\"我去重启桌面宿主（推荐）\"]}]}"
selected: [["我去重启桌面宿主（推荐）"]]

current-code view: last conversational role=assistant textLen=1933 textAsksQuestion=false
```

`session-5d0ef0a3…` (the successor that re-asked) — 83 derived messages, **0**
`ask_user_question` tool-call blocks.

The two carrier shapes, exactly as they appear in the derived message list:

- assistant message, inline content block:
  `{ "type": "tool-call", "id": "call_…", "name": "ask_user_question", "arguments": "{\"questions\":[{\"id\":\"next\",\"header\":\"下一步\",\"question\":\"…\",\"options\":[{\"label\":\"…\",\"description\":\"…\"}]}]}" }`
- tool message: `source = { kind: 'tool', callId }`, `content = [{ type: 'text', text: '{"answers":[{"id":"next","selected":["…"]}]}' }]`.

So the question, its full option list with descriptions, and the user's `selected` value are all
recoverable — `arguments` is a JSON **string** and the answer is a JSON **string inside a text
block**, so a reader must `JSON.parse` both.

## Diagnosis this supports

The friction is real and has a structural cause, not a wording cause:

1. In `session-8370820f` the user's decision travelled through `ask_user_question` (turn 1 step 15,
   seq 120/121) — not as plain text.
2. Both profiles set `handoffBudgetRecentTokens: 0`, so `handoffSplit` puts the whole conversation in
   the summarized `older` part and the verbatim `tail` is empty.
3. `pendingQuestion()` reads only **text** blocks of `user` / `assistant` messages, so the tool pair is
   invisible to it; and `textAsksQuestion()` is false for the last assistant text in both sessions
   (1933 and 2061 characters; both end in an offer, not a question mark).

With no verbatim tail and no pending-question block, the decision survived only as summary prose —
which is why the successor re-asked.

## One correction to the handoff

The handoff cited "上一会话最后一条 assistant 消息（13119 字符）返回 false". The classification is
correct, but the length was the **whole message** (reasoning + text = 13118 characters measured); the
text-only content the classifier actually reads is **1933** characters. Reasoning is not part of
`messageText()`, so reasoning length must not be quoted as the classified length.
