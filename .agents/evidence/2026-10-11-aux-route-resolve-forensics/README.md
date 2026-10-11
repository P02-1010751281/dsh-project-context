# 2026-10-11 — what resolved the auxiliary call's route, and which build logged the 16:54 400s

Corrects two claims that `CONTEXT.md` carried as *unresolved*: the two `MissingSessionID` 400s at
08:54:50/51Z (16:54:50/51 +08) were attributed to a dispose-time pass of `session-d435cad7`, and the
routing behaviour behind them ("the auxiliary call may lag the session's selection") was called an
unproven hypothesis. Both are decided by `probe.mjs`, which is read-only and re-runnable.

## probe.mjs

```
node .agents/evidence/2026-10-11-aux-route-resolve-forensics/probe.mjs
# exit 0 = both halves pass; 1 = a falsifier fired; 2 = indeterminate (input missing)
```

* **A — load state.** The last `MissingSessionID` trace in `.agents/memory/errors.log` names five
  `lib/…` frames. At each of those line numbers, `0bf0b31^` (the build that did *not* carry the fix)
  holds the call the frame names, while `0bf0b31` (the fix commit) holds a different statement. So the
  two 400s were produced by pre-fix code — the known pre-fix behaviour, not a post-fix regression.
  **This half never reads the socket holder's start time**: the stack discriminates by itself, and the
  holder's start has already moved twice (17:01:32, then 17:46:53 on a later restart).
* **B — route.** `resolveTarget` (`src/shared/model-call.ts`) resolves config → `requestHeader()?.config`
  → `agent.options`; `requestHeader()` is the fold of `request/header` events, i.e. the header of the
  session's **last dispatched request** (`packages/core/session/src/index.ts`), while the current
  `model/selection` is applied per dispatch by model-selection's `agent/request` hook
  (`packages/core/agent/src/model-selection.ts`) and is recorded as a different event. Folding every
  workspace session's headers at the cut shows the blamed session was already on `command-code`
  (in force since 16:30:56) — `command-code` cannot emit `MissingSessionID` — and that the only
  sessions still resolving to `opencode-go` were `session-7b280e03` (16:05:41) and
  `session-b2a9894b` (15:58:27).

## Runs

| file | command | result |
| --- | --- | --- |
| [`probe-output.txt`](probe-output.txt) | `node probe.mjs` | `RESULT: PASS` (exit 0) |
| [`control-fix-head.txt`](control-fix-head.txt) | `node probe.mjs --fix=HEAD` | `RESULT: FAIL` (exit 1) — section A's falsifier fires |
| [`control-cut-1625.txt`](control-cut-1625.txt) | `node probe.mjs --cut=2026-10-11T16:25:00+08:00` | `RESULT: FAIL` (exit 1) — section B's falsifier fires |

The controls exist because a probe that can only print PASS proves nothing: `--fix=HEAD` moves the
"pre-fix" side onto the fixed build, so every token is present on both sides; `--cut=16:25` moves the
cut before the 16:30:56 header, so the blamed session folds to `opencode-go`.

## Consequence for the batch-S witness

Because the route comes from the last **dispatched** request, switching a session's model writes only
`model/selection`. A `/memory update` run before that session has dispatched a request on the new
route still resolves to the OLD provider — so the witness protocol is: switch to
`opencode-go`/`deepseek-v4.1-flash`, let one ordinary turn run on it, *then* run `/memory update`.
