# Deferred continuation retitle — acceptance probe (2026-10-07)

`retitle-accept.mjs` answers one question that only the running host can answer, and that the
hand-off notes previously left as a hand-typed `grep`: **does a continuation get a second
`session/title` event once a person talks to it?**

It exists for the fix in `bb8bc2a` (`fix(handoff): defer the continuation retitle out of the
dispatch envelope`, `src/project-handoff/relabel.ts`).

## What is being judged

`src/project-handoff/perform.ts` writes the child's title at handoff time — one `session/title` with
`source.kind:"user"` and an empty `messageSeqs` — and the title service then pins that title ("A user
rename pins the title"). `relabel.ts` is the second, deferred write: it fires on the `session/event`
carrying the child's **first** human input and renames the child after that input, keeping the
`↪ handoff · ` prefix.

So inside one continuation's own log the whole observable is the **count of `session/title` events**:

| event count | meaning |
|---|---|
| 1 | only the handoff's own write — the deferred retitle never landed |
| ≥2 | the retitle landed (the second one is the label from the first human input) |

The event, not a file mtime, is the evidence: a session republished to v4 gets a fresh mtime without
being new, and a migrated directory keeps its old `session.vN` beside the new file (the probe reads
only the highest version, or every title would be counted twice).

## Why the criterion gate is inside the probe

`relabel.ts` decides the write on the event that carried the first input (`firstHandoffInput(...).seq`),
so the input's **own time** scopes the search — not the child's creation time. On this machine that
distinction is load-bearing: two continuations (`42bcc5f4` here, `440ccfc9` in the DSH-AV workspace)
received their first human input at 22:47, two minutes *after* the current holder started at 22:45,
while the fix `bb8bc2a` landed at 23:23. A probe that ignored the load criterion would call those two
a failure and name the wrong cause. They are reported as notes while the criterion is negative.

## Verdicts

| exit | meaning |
|---|---|
| 0 | PASS — every continuation talked to since the holder started carries two title events |
| 1 | FAIL — one such continuation still carries one; the deferred retitle is not live |
| 2 | UNOBSERVABLE — criterion negative, or nobody has typed into a never-typed continuation yet |

Exit 2 is deliberate: an unobservable state is not a green.

## Commands

```bash
# self-test: all three verdicts on synthetic session dirs, no live store touched
node .agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs --selftest

# live
node .agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs
```

Post-restart acceptance is two commands — the load criterion is owned by
`../2026-10-07-handoff-title-load-verify/verify.sh`, this one owns the retitle:

```bash
bash .agents/evidence/2026-10-07-handoff-title-load-verify/verify.sh   # expect exit 0
node .agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs
# then type one sentence into a `↪ handoff · …` session that has never been typed into,
# and re-run it: expect exit 0
```

Env overrides (`SESSIONS_ROOT`, `HOLDER_START`, `SRC_COMMIT_TIME`) let it run against a copied store.

## Read at the time of writing (2026-10-07, re-derive, do not quote)

`node … --selftest` → exit 0, all three branches reached. `node …` (live) → exit 2: holder pid 4890
started 22:45:00, last `src/` commit `bb8bc2a` at 23:23:06, so the criterion is negative and the two
candidates above are notes; 405 session dirs scanned across all workspaces.

## Residuals this probe does not cover

- It cannot make a person type. A never-typed continuation that was created *before* the restart is a
  perfectly good target — `relabel.ts` reads the first input from the durable log, not from a process
  — but a continuation whose first input was already consumed before the fix landed will never be
  retitled (the seq gate is fixed for the session's life). Those are the two `..` rows above.
- A label the title service strips entirely makes `relabel.ts` restore the previous title, which is a
  second title event equal to the first. The probe requires the last title to differ from the first,
  so it reports UNOBSERVABLE rather than a pass there.
- An ordinary session's `fallback` → `provider` upgrade also produces two title events, which is why
  the prefix check (read from `lib/project-handoff/marker.js`, never re-typed here) comes first.
