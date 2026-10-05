# Batch H — config vocabulary (2026-10-05): the mutation round

Evidence for the three valid mutants behind batch H, plus the one mutant that was **discarded as
invalid**. Run `bash mutate.sh m1|m2|m4` to reproduce any of them; the script snapshots `src/` and
`client/`, refuses an edit whose anchor is absent or ambiguous, and restores + rebuilds on every exit
path, printing the marker count left in `lib/`.

Batch H renamed seven config keys so each mirrors the command path that changes it
(`docs/batch-h-vocabulary-keys-ruling.md`), with **no compatibility reader** — a retired name must
throw `unknown config key` — and converged the memory layer's replies onto the `Memory: ` prefix.

## The round

| # | deliberate wrong edit | validity | result |
| --- | --- | --- | --- |
| m1 | give `handoffKeepTokens` a compatibility term in the unknown-key check (`src/shared/config.ts`) — i.e. D2=(b)'s negation | `tsc` 0, marker at `lib/shared/config.js`, probe returns `20000` instead of throwing | **KILLED** — `test/config-vocabulary.test.mjs` fails 3: the (b)-contract case, the both-profiles `apply()` case whose positive control is the same throw, and the source scan (the mutant's own text spells the retired name) |
| m2 | `/handoff budget recent` writes `handoffKeepTokens` (`src/project-handoff/command.ts`) | `tsc` 0, marker at `lib/project-handoff/command.js`, probe returns `{ patch: { handoffKeepTokens: 0 } }` | **KILLED** — the write-back guard in `test/config-vocabulary.test.mjs` fails, so does the source scan, and two pre-existing literal assertions in `test/logic.test.mjs` |
| m4 | one memory status prefix reverts to `Project memory: ` (`src/project-memory/index.ts`) | `tsc` 0, marker at `lib/project-memory/index.js`, probe returns the old sentence | **KILLED** — two cases in `test/logic.test.mjs` |
| m3 | rename a card dictionary key back to a retired spelling (`client/locales.ts`) | **`tsc` FAILS**: `SettingsCardKey` is a closed literal union, so the edit does not compile | **DISCARDED as invalid** — an invalid mutant's red is not evidence |

m3 is recorded rather than dropped because its failure is itself a fact about the design: the card's
copy layer cannot be left half-renamed. The type system, not the test suite, is what enforces it.

## What m1 and m2 have to prove together

The two halves of the rename are different data-flow directions, and each mutant covers one:

- **Read direction.** m1 reintroduces exactly the thing the ruling refused (an old name resolving
  instead of throwing). The (b)-contract case fails on its own, and the both-profiles case fails
  through its positive control — the assertion that the *same* `apply()` call site does throw on a
  retired key. That control is what makes "the profile shape applies cleanly" evidence rather than a
  statement about a stub that cannot throw.
- **Write direction.** m2 breaks the path the platform persists back into `cordis.patch.yml`. The
  guard that every key `settingPatch` can emit is a schema key catches it, and so do the two
  pre-existing literal assertions — a self-inflicted `unknown config key` on the next read is exactly
  the failure a rename exists to avoid, and it would otherwise only surface later.

## Gate, read at the end of the round

`pnpm typecheck` 0 errors; `pnpm build` ok (`lib/client.js` 28605 bytes); `node --test`
**346 pass / 0 fail** (340 before this batch, +6 in `test/config-vocabulary.test.mjs`);
`grep -rn 'MUTANT' lib/ | wc -l` = 0; `git grep -nE 'autoConsolidate|autoLearn|handoffTargetTokens|handoffKeepTokens|handoffSummaryThinking|handoffAdaptive|handoffLanguage' -- src/ client/` = 0 matches.

Numbers here expire — the point of the file is the mutants and their commands, not the count.
