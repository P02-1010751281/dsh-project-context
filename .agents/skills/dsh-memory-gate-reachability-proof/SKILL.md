---
name: dsh-memory-gate-reachability-proof
description: "Use when adding or changing a conditional on dsh-project-context's memory write path — a prompt ladder shown only near the character cap, a receipt that names where MEMORY.md came from, or any state the running host only sometimes has: measure where the band actually is before picking the threshold, gate on the value that identifies the real path instead of an approximation, and prove it with a mutation round of the prior laxer condition."
derived_from: autolearn
evidence: ["session-e841bd7b-486f-4b35-8298-05273505e4df", "session-a43aa39f-dd7b-4918-9ecb-ae6b45ca5668"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Proving a memory-path gate is reachable

## When to use

You are adding or changing a conditional in `src/project-memory/` (or a receipt built from it) that must fire
only in some states: a retention/compression ladder appended to the consolidation prompt when the stored
document is near its cap, a receipt line saying "the derived view is a projection, the journal is the
authority", a source label, etc. A green suite proves nothing here: in this project both such batches shipped a
condition that was unreachable or actively misattributed, and only a mutation round on the *prior laxer
condition* caught it.

## Steps

1. Write the claim in one sentence and the exact state it must detect. Two shapes exist:
   - occupancy ("the ladder appears only when the stored document is near `maxMemoryChars`");
   - provenance ("the label appears only when `loadMemory` really read the journal").

2. For an occupancy trigger, measure the band instead of guessing.
   - Read the cap the host actually runs with: the `project-context` entry's `maxMemoryChars` in
     `~/.dsh/profiles/<profile>/cordis.patch.yml` — read it, never quote it (both profiles were `54000` on 2026-11-26; the value has moved 40000 → 45000 → 52000 → 54000). Never measure against the library
     default `MAX_MEMORY_CHARS`; a built-renderer probe like `share-fit.mjs` reports against the default and can
     disagree with the running host.
   - `fitMemoryInput` (`src/shared/conversation.ts`) *clips* and reports `clipped` plus the hidden character counts when memory + context cannot fit the output budget; the *refusal* happens upstream in the pass (`fit-capped-refused`, raised in `src/project-memory/update.ts`), so the
     refusal line sits just under the cap: measured at the **then-current** 52,000 cap on a reasoning route it read
     ~51,225 chars (~98.5%) — a historical measurement, so re-measure at today's cap instead of quoting the ratio. A
     trigger at 90% of the cap is therefore unreachable — the pass it would have changed was already refused
     before the prompt was built.
   - Put the trigger safely below the line (85% worked) and say in the constant's comment that the line moves
     with the context size and the model route, so reachability is not universal. Do not invent a trigger that
     looks tidy but is provably in the dead band.
   - The wording of a prompt rule is pinned verbatim by `assert.match` in `test/prompt-bounds.test.mjs` and
     `test/logic.test.mjs`; changing the sentence means updating that pin in the same commit, keeping the test's
     intent (usually "this rule appears in this band and not in the other").

3. For a provenance gate, enumerate every path that reaches the label before choosing the predicate. Read
   `src/project-memory/load.ts` (`externalRenderWins`, `renderIsNewerThanJournal`, `readRenderWithMtime`) and
   list them: journal present and read; journal file present but empty (0 records) → falls back to `MEMORY.md`;
   a newer, externally edited `MEMORY.md` adopted; legacy/archive fallback. "The journal file exists" is true in
   all four and therefore misattributes three of them. Gate on the value that identifies the path —
   `source === journalPath`, or a `fromJournal` flag taken from `loadMemory` itself.

4. Make the test construct the state instead of approximating it. If the case does not reproduce — e.g. an
   external edit was not adopted because the write interval was too short, since a render only wins when it is
   newer than the journal — push the fixture into the intended ordering (set the render's mtime ahead of the
   journal's) rather than loosening the assertion. Keep one positive control (journal read → label present) and
   one negative control (fresh or blank render, no journal → label absent).

5. Mutation-check the prior laxer condition, not only the new code: revert the threshold to the old value, and
   revert the predicate to `journal file exists`. Each mutant must turn exactly its named test red while the
   controls stay green; an unconditional version of the gate must also go red. Restore `src/` from a
   hash-verified `/tmp` copy (never `git checkout --` or `git stash`), then `pnpm build` and confirm 0 mutant
   markers in `lib/`.

6. Run the gate with the package script: `pnpm test` (`tsc && node --test`); the reporter is spec even off a TTY, so judge the exit
   code. `node --test test/` bare does not work.

7. Land it: scoped `git add <paths>` and `git commit -F <msg> -- <paths>` (another agent session may share the
   tree), rebuild so `lib/` is committed next to `src/`, add the `CHANGELOG.md` `未发布` entry, push. A prompt or
   trigger change is not live until the user restarts the desktop host — say that explicitly and hand the
   restart over; never restart it yourself.

## Failure modes this prevents

- A trigger in a band the code never reaches, so the change is a no-op that still passes its tests.
- A label that reports "the journal is authoritative" while the document came from `MEMORY.md` — a wrong cause,
  which is worse than silence here.
- A test whose fixture does not produce the state it claims to cover, so the mutant survives.
- Mutating only the new line: the old, laxer condition is what must be shown to be killable.
