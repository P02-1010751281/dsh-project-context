# Seed identity hash — experiment result

Date: 2026-11-21. AOCI borrow ② (`docs/research/2026-11-19-aoci.md`), deferred in the previous session
because it "touches the seed format and the six `<handoff>` closings". Verdict: **feasible without
touching the structural judgement**; landed as `summary.ts` + `perform.ts` + 7 tests, 4 mutants.

## What was borrowed

> 种子落一个身份哈希，交接回执记下它，事后能对账「子会话读到的种子是不是这一份」。

## Design

- `continuation()` builds the body exactly as before, then inserts one line after the session-id detail
  line: `- handoff-seed: <12 hex>` = `sha256(body-without-that-line)[0..12]`.
- `seedIdentityOf(seed)` removes that one line (newline included) and recomputes; `verified` says whether
  the stored message still hashes to its own stamp. No file, no clock, no sidecar: the seed proves itself.
- `renderHandoff(..., seedId)` writes the same id into `HANDOFF.md`, so a project whose `HANDOFF.md` was
  overwritten still has an attributable seed in the child session.
- The line is ASCII in both languages, so a tool finds it without knowing the handoff language.

## Why the deferred risk did not materialise

`isHandoffContinuationText` needs (a) the prefix, (b) both `<handoff>` markers, (c) one of six closings
*last*. The line goes inside the details block: markers untouched, closing still last, prefix untouched.
Pinned for all six shapes (en/zh × closing / pendingWait / decisionClosing) plus a negative control that
strips the line and expects the predicate to still say "seed" — so the stamp is provably not load-bearing
for recognition.

## Chained handoffs

A handoff child that hands off again carries its own seed inside the tail, so the successor's message has
two identity lines. The details block comes first; `seedIdentityOf` uses the first match and a
non-global replace removes only that one, so the child's id verifies. Pinned by
`a chained handoff keeps its own id even when the tail carries the parent's seed`.

## Mutation round (4/4 killed, each by its named test)

| mutant | red |
|---|---|
| M1 stamp omitted (`return body`) | 5 tests: one-line, tamper, determinism, chained, document id |
| M2 digest covers parentId, not the body | tamper, verify, chained (3) |
| M3 canonicalisation keeps the emptied line | tamper, verify, chained (3) |
| M4 verifier always true | tamper + document negative control (2) |

Restore: `cmp src/project-handoff/summary.ts /tmp/mut-summary.ts` byte-identical; `pnpm build`; 0 markers.

## Residual

The id proves *integrity* (this message is what that handoff wrote), not *completeness* (the last turn made
it in). Completeness still needs `handoffSplit` reconstruction — skill
`dsh-handoff-seed-completeness-forensics`. Stated, not implied.
