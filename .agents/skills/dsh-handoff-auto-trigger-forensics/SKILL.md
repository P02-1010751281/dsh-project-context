---
name: dsh-handoff-auto-trigger-forensics
description: "Diagnose why dsh-project-context's handoff did or did not fire for a given session, reading /handoff status receipts and session-level meter/projection values without mistaking profile-level numbers for that session's state."
---

Use when the question is why a session did or did not hand off, what the handoff threshold is, or whether the auto handoff path has ever really fired.

1. Do not answer from `/handoff status` alone. `threshold auto <n>` / `threshold context <n>` are profile + model level — two different workspaces on the same window print the same number. Quote the workspace and session id alongside any receipt; a receipt is never by itself evidence about one session (this misattribution has already happened once). Read the envelope wording the receipt prints instead of inferring it: `harness envelope <n>` (harness `contextBreakdown` projection), `meter envelope <n> — not the harness composition`, `harness envelope unavailable — no contextBreakdown projection`. All three come from the single `measuredContext` entry point, so value and provenance cannot disagree.

2. Derive session-level numbers read-only from that session's archived log: the last `assistant/message` entry's `data.usage.totalTokens` is exactly `meter.measure(session).totalTokens`; `request/context` in the same log gives `contextWindow`; whether the last assistant text ends in `?`/`？` decides the pending-question guard. Do not count strings in the log to estimate this — the log echoes your own probe commands.

3. Recompute the chain with live values. `quality = upstreamUsableInput ?? knee(window)`; `threshold = min(max(baseline + keep + summarizeTokens, quality), usable − SAFETY_MARGIN)`. Defaults live in `src/shared/config.ts` (`DEFAULT_CONFIG`); the effective values are the profile-level ones in the profile's `cordis.patch.yml` — read both now, quote neither from memory. dsh exposes no upstream usable-input field (`LlmResolvedModelInfo.context` is only `{contextWindow}`), so `qualityLimit`'s upstream branch is deliberately unwired; do not invent a value for it. The knee is a fallback, not a ceiling — capacity (`usable − SAFETY_MARGIN`) is usually what binds, so compute `threshold / window` for the current config instead of quoting remembered shares. The envelope and `keep`/`MIN_SUMMARIZE` share one basis (the `contextBreakdown` /4 heuristic); only the `tokens` comparison mixes window-basis with heuristic — never present the envelope as provider-exact.

4. Check the evaluation door before blaming the threshold: auto handoff is evaluated only on `turn/end` and there is no timer, so a session far above the threshold that no longer ends a turn will never auto-hand off. Confirm the `session/event` filter and the absence of timers in `src/project-handoff/`.

5. Walk the guards in order and keep them distinct: threshold -> pending question (`handoffPendingQuestion`, default `defer`; a question-ending assistant message makes `auto.ts` return) -> running subagents. `pending wait` is the lever that unblocks an agent that ends every turn with a question. Never present a guard failure as a threshold failure.

6. Confirm whether the auto path fired. Successor nails: `session/title` = `↪ handoff · <parent id>` and the first `user/message` carries `source.kind = dsh-project-context` with no `rpcId`; a parent that ran `/handoff now` shows a `command/run`, auto shows none. When judging whether a behaviour has been verified live, scan every workspace archive, not just the one asked about — a fix can be structurally unable to fire before it lands, so one observed firing is evidence the fix is loaded.

7. Report the workspace, session id, derived numbers, which door or guard blocked, and the envelope's provenance. If nothing blocked and the threshold was not reached, say that plainly rather than inferring a defect.
