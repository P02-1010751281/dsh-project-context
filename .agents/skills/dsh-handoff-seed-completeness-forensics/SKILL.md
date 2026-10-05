---
name: dsh-handoff-seed-completeness-forensics
description: "Diagnose whether a dsh-project-context handoff/seed actually dropped the last turn, the user's decision, or an answered question: reconstruct the parent session from session.jsonl and prove the seed's composition with probes on lib/."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Handoff seed completeness forensics (dsh-project-context)

Use when a successor session re-asks something the user already decided, when a seed's `<handoff>` block looks like it lost the last turn, or when the user says "the handoff missed a message". Decide whether content was really lost and which gate dropped it — do not answer from the summary's prose.

## 1. Pin the handoff artifact and its time

- Read the first lines of `.agents/memory/HANDOFF.md`: `# DSH 会话 <id> 的交接文档` plus `- 生成时间：<ISO>`.
- Handoff generation runs **after** `turn/end`. A generation time later than the session's last `turn/end` proves the artifact covered the whole session; a session killed mid-turn (e.g. by a host restart) produces **no** handoff at all. Compare the artifact's section counts against the seed block the child received, section by section.

## 2. Reconstruct the parent session from the authoritative log

- Read `session.jsonl` in the session's archive directory, never the rendered `session.md` (a rendering, not the log).
- Bucket events by type: `turn/start` vs `turn/end`, `user/message`, `assistant/message`, `tool/call`, and whether any `command/*` entries exist (a typed slash command like `/memory update` would appear there; their absence means the user typed none).
- Almost every `user/message` is an injection — runtime-context snapshot, skill catalog, subagent receipt — not human typing. Do not count them as user turns.
- Enumerate `ask_user_question` calls and pair each with its result. The answer nests under `data.message`; a naive read of `data.content` returns `undefined`. That pairing is usually the only human input in the session.

## 3. Reconstruct the seed the child actually got

Parse the child session's first `user/message` and check for the markers `<handoff>`, `<recent-conversation>`, `## 待用户回答的问题`. Each missing marker points at one specific gate, so name the marker when reporting.

## 4. Prove seed composition with probes on `lib/` (never by reading prose)

- `textAsksQuestion(<parent's last assistant text>)` from `lib/project-handoff/conversation.js`: true only when the text ends in `?`/`？` after fenced code removal and trailing-markdown stripping, or matches `PENDING_QUESTION_PATTERNS` on the last 400 chars. A message ending in an offer ("…告诉我，我现在就写。") is **false**, so `pendingQuestion()` is `undefined` and the seed carries no pending-question block even with `handoffPendingQuestion: wait`.
- `handoffSplit(session, keepChars)` in the same file: with `handoffBudgetRecentTokens: 0` (both profiles) `keepChars <= 0`, so the entire conversation lands in `older` and `tail` is empty — no `<recent-conversation>`, and a decision the user made in prose survives only inside the summary.
- Note that this key is also auto handoff's threshold (`src/project-handoff/auto.ts` skips when everything fits the recent window), so raising it is not a free switch.
- Read `handoffPendingQuestion` and `handoffBudgetRecentTokens` fresh from `~/.dsh/profiles/{desktop,web}/cordis.patch.yml` rather than quoting memory.
- Probe against `lib/`, not the docs; state the probe output when reporting.

## 5. Surrounding disk state before recommending any action

`git rev-parse HEAD origin/main`; `git status --short`; `git diff --exit-code -- lib`; socket holder `ss -ltnp | grep 19387` then `ps -o lstart= -p <pid>` compared against the last `src/`-touching commit's time. A holder start earlier than that commit means the fix is not loaded yet and the pending user step is still the restart.

## 6. Report

Give the timeline (answer arrival → last assistant message → `turn/end` → handoff generation) and say which seed piece is missing and which gate dropped it. Never claim the handoff leaked content without a probe result, and never present a heuristic's residual misclassification as fixed. When the remedy is a `src/` change, follow the repo rules: probe the API first, edit `src/` only, add a mutation-checked regression test, rebuild `lib/`, and leave the desktop restart to the user.
