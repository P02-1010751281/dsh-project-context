---
name: dsh-memory-entry-id-stamping
description: "Change or verify dsh-project-context's Z2 memory entry-id stamping (retireWithinBudget / stampEntryIds / keepIds / entries.json clock) and prove a partial-stamp batch actually landed on the running host without trusting snapshot counts."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# When to use

Any change to, or post-restart verification of, the Z2 retirement machinery in `src/project-memory/retirement.ts` of dsh-project-context: `stripEntryTid`, `retireWithinBudget`, `stampEntryIds`, `readEntryDates`, the `entries.json` clock, and the `removedSectionEntries` regression guard. Also use it when a `/memory update` pass leaves fewer ids than expected, or when an `errors.log` `memory regression:` line claims entries were deleted.

## Ground rules (they are the whole point)

- An entry id is derived from the entry body's sha256. Never seed derivation from `entries.json`: treating a sidecar id as "taken" makes an unstamped entry collide with its own old id, get re-salted, change id, and reset its age.
- Age is carried only by `entries.json`. Trim that file with `keepIds` = every id the document owns, including entries a partial stamp could not mark; otherwise postponing a stamp silently restarts the clock.
- Partial stamping is legitimate, so a missing `（xxxx）` suffix is never evidence that Z2 is not live. Only "zero ids landed" is `stamped:false`, and that now means exactly that.
- Never verify by arithmetic on a truncation marker, by `grep` for a marker string, or by reusing character/entry/id counts written in memory or a handoff: those are snapshots. Re-read through the built renderer.

## Procedure

### 1. Fix or extend the stamping

1. Read the current document and measure it fresh, before touching code: drive the built renderer (`renderMemoryDocument` / `sectionsFromMarkdown` from `lib/`) over `.agents/memory/MEMORY.md` and record characters, entry count per section and id count. Record numbers as a snapshot and label them so.
2. In `retireWithinBudget`, decide the stamp set by rendering: with ids clean → stamp all; ids dirty but a no-id render clean → stamp by priority **Invariants → Pitfalls → Project → Index** with the characters left; both renders dirty → keep every id; no entry fits → `stamped:false`.
3. Skip any entry whose body + 6 characters exceeds the 800 single-entry cap. Otherwise one near-cap entry makes every prefix containing it unrenderable, the budget collapses to zero, and entries beside it never get an id.
4. Keep `id` derivation purely body-based (sha256 hex prefix), no sidecar read in that path.
5. Trim `entries.json` with `keepIds` (all ids in the document), so a postponed stamp does not reset age.
6. In the regression guard, compare after `stripEntryTid` on **both** sides and after `normalizeMemoryEntry`. Keep the guard report-only, keep Project/Index excluded, and keep `removedSectionEntries` from blocking a write.

### 2. Pin each rule with a mutation-checked test

The suite that must turn red for each mutation (add the case if it does not):

| Mutation | Test that must fail |
| --- | --- |
| budget forced to zero | the partial-stamp case |
| stamp priority reversed | only the priority case |
| `keepIds` degraded to "carried ids only" | the unit case **and** the end-to-end clock case |
| id derivation back to sidecar seeding | the end-to-end clock case |
| near-cap filter removed | the boundary case (`a near-cap entry postpones only itself`) |
| guard compares verbatim | the `batch Z8d` case (4000-char cap reproduces the asymmetry: ~107 reported deletions where only 11 were real rewrites) |

Never leave a symbol unreferenced in `src/` to make a mutant red — `tsc` then reports `TS6133` and the red is meaningless.

### 3. Gate

`pnpm typecheck` (0 errors), `pnpm test` (read the exit code; TAP is off a TTY, and a bare `node --test test/` fails — use the package script), `pnpm build`. Take `lib/client.js` size from the build output, and confirm 0 mutant markers with `grep -n "<NAME> = "` in `lib/` (not `grep -cF` on a template marker: `tsc` emits `String.raw` plus a space and the count reads 0).

### 4. Prove it is live only after the host restart

The user restarts the dsh host; plugin host code loads at process start. Do not report the batch as live before that.

1. Compare the host `pid` start time with the last `src/`-touching commit (`git log -1 --oneline -- src/`); a host older than the commit has not loaded it.
2. After the restart, trigger one consolidation pass, then re-measure ids through the built renderer and check that ids appear in the Invariants → Pitfalls → Project → Index order, quoting only the fresh numbers.
3. Verify `.agents/memory/errors.log` gained no new `memory regression:` line and no new named refusal line.
4. For a live-module proof use `.agents/evidence/2026-11-11-z8d-live-module-version/probe.mjs`, which compares the resident module source against `git show <commit>:lib/…`; the process-start-time test alone is unsound because plugin code can be hot-swapped once without a restart.

### 5. Record

Write the round into `CONTEXT.md` / `.agents/memory/MEMORY.md` as constraints and open tasks (restart pending, pass to observe), not as counts. Report unresolved residuals (e.g. an entry whose stamp is postponed forever) as residuals, never as fixed.
