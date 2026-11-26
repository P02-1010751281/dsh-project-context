---
name: dsh-readonly-state-core-extension
description: "Add a state, verdict, or receipt field to one of dsh-project-context's read-only derivation cores (session-state, skill-state, entry-state) or close a CHANGELOG residual for one: keep the core pure, split derivation from disk reads, carry the denominator in the receipt, and prove it with a mutation round."
derived_from: autolearn
evidence: ["session-08dd4431-99ee-4804-ba6b-21612ae62e0e", "session-6baddac5-1f84-49f3-b92b-fedcb3b839aa", "session-e841bd7b-486f-4b35-8298-05273505e4df"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Extend a read-only state core in dsh-project-context

Use when adding a state / verdict / receipt count to one of the plugins' derivation
cores, or when closing a `CHANGELOG.md` residual that says a state is missing:

- `src/project-context/session-state.ts` + `session-state-source.ts` — session log
  states (`live`/`settled`/`stale`/`orphan`/`missing`/`dangling`/`unbaselined`/`abandoned`),
  command `/session-log status`, suite `test/session-state.test.mjs`.
- `src/project-autolearn/skill-state.ts` + `skill-state-source.ts` — skill states
  (`unbaselined`/`expired`/`drifted`/`moved`/`orphan`/`intact`), command
  `/autolearn status|bind|expire`, suite `test/skill-state.test.mjs`.
- `src/project-memory/entry-state.ts` (sole adjudicator `entryStateOf(tid, facts)`) +
  `entry-states.ts` (aggregation/counts, split out of `index.ts` to avoid a cycle).

Strategies live in `docs/batch-aa-state-machines-spec.md`; cross-plugin vocabulary
(anchor words) in `src/shared/anchors.ts`.

## 1. Keep the core derived and read-only

- The `*-state.ts` half takes caller-supplied facts only and probes nothing on disk;
  the `*-state-source.ts` half does every read. One owner per judgement, and every
  state must have a reachable exit (that is what made `abandoned` / `moved` residuals
  closeable rather than dead vocabulary).
- Never add a transition channel: writing lifecycle into `meta.json` / `INDEX.md`
  creates a second truth, and the mismatch with the directory is exactly what the
  judgement exists to report. State changes go through a separate explicit command
  (`/autolearn expire`, `/autolearn bind`, `/memory reconcile --accept <id>`), never
  as a side effect of the derivation.
- Reuse the existing structural rules instead of inventing new ones: a vanished
  parent directory is `moved`, not expired/drifted; `unbaselined` is the honest
  answer until a baseline is bound; a missing file is a zero count, not an error.

## 2. Counts and receipts

- First receipt line carries the payload AND the denominator, e.g.
  `Learned skills: N of M skill(s) — X intact, Y needing a look.` (the hand-written split is on the **second** line, `K hand-written skill(s) are not managed …`, because the folded summary clips near eighty columns); the report type
  carries `total` / `unmanaged`. A receipt whose `unmanaged` is constant-zero is a
  bug class that only a denominator assertion catches.
- Cap enumerated lines (`MAX_RECONCILE_LINES = 10`) and never report a state that has
  no fact source. Receipts must survive the client's collapsed one-line card — see
  skill `dsh-command-receipt-render-verify` (payload on line 1).
- Number computed counts by reading the store at build/verify time, never from prose.

## 3. Big-log and missing-file hazards

- A judgement that scans `session.jsonl` must stream and stop at the first hit: in
  real use 17 handoff sub-sessions held ~71MB, with the first human turn as deep as
  ~2.9MB. Never `readFile` the whole log.
- A handoff sub-session may have no `session.jsonl` at all. Treat "no log" as zero
  human turns — treating an unreadable event stream as nothing-to-do made the whole
  `/session-log status` die with ENOENT.
- Human-turn counting must skip handoff seed banners via the existing
  `humanUserText` / `isHandoffContinuationText` pair; an unmeasured subject must
  never be judged (that is why `abandoned` needs a positive measurement).

## 4. Wiring and tests

- Command wiring stays in the plugin's `index.ts`; the source module returns data,
  the command module renders text.
- Suite: `test/<core>.test.mjs`, driving the plugin's real `apply()`. Fixture rules
  that have already bitten here:
  - entry ids must be lowercase hex `[0-9a-f]{3,4}`; `hhh`-style ids are silently
    skipped and the control group becomes a no-op;
  - write fixture file mtimes explicitly relative to the injected clock, otherwise
    the subject computes as `live` instead of `stale`;
  - import the shared source of truth (e.g. `sessionSettledDays`, which drives the abandoned judgement and the log-scan threshold) instead of hard-coding the
    number, or a mutation of the constant stops being caught;
  - move-on-disk cases: parent directory gone = `moved`; whole-directory move must
    not collapse into `drifted`.

## 5. Prove it

1. `pnpm typecheck`, `pnpm build`, `pnpm test` (never bare `node --test test/`; on a
   off a TTY it is still the spec report, so read the exit code and not a TAP grep).
2. Mutation round by skill `dsh-plugin-mutation-round`: one named test red per mutant,
   each mutant compiling and actually changing behaviour. A first-pass mutant that
   stays green because the guard it removed was unreachable means the production
   branch is untested — add the case that reaches it, then re-mutate.
3. Restore `src/` from the hashed copy, rebuild, confirm zero residue (restoring
   `src/` does not restore `lib/`).
4. Commit with an English Conventional Commit, `git add <paths>` only (a second agent
   may share the tree), push to `main`, and move the closed residual into
   `CHANGELOG.md` `未发布`; register a new spec in `docs/README.md`.

## 6. Report honestly

A state that reports everything as `unbaselined` or reports 3 `abandoned` out of 211
is a reading, not a defect — say so, and separate "design boundary" (hand-written
skills are read-only, `confirmed` is a local sidecar) from "not done yet".
