# Batch H — config vocabulary (2026-10-05): the mutation round

Evidence for the five valid mutants behind batch H, plus the two spellings that were **discarded as
invalid** (m3, and m4's first). Run `bash mutate.sh m1|m2|m4|m5|m6` to reproduce any of them; the script
snapshots `src/` and
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
| m5 | the memory pass reads a sibling's switch: `current.memoryEnabled` → `current.autolearnEnabled` (`src/project-memory/index.ts`) | `tsc` 0 (`autolearnEnabled` is a real field, defaulting to `true`), marker at `lib/project-memory/index.js` | **KILLED** — `test/top-level-gate.test.mjs`, one case: the `memoryEnabled: false` negative added by the review. Before that test, the whole suite passed with the memory switch read nowhere |
| m6 | a card union loses an option: `handoffLang` → `options: ["auto", "zh"]` (`client/card-fields.ts`) | `tsc` 0, marker at `lib/client.js` | **KILLED** — `test/settings-form.test.mjs`, one case: the row-options ↔ schema-union comparison added by the review. `card-render.test.mjs` counts pills from the same table, so it cannot notice |
| m3 | rename a card dictionary key back to a retired spelling (`client/locales.ts`) | **`tsc` FAILS**: `SettingsCardKey` is a closed literal union, so the edit does not compile | **DISCARDED as invalid** — an invalid mutant's red is not evidence |

m3 is recorded rather than dropped because its failure is itself a fact about the design: the card's
copy layer cannot be left half-renamed. The type system, not the test suite, is what enforces it.

**m4's first committed spelling was invalid too** — found 2026-10-05 by re-running this script verbatim.
It appended its marker as a *line* comment, ``…${capped}` // MUTANT H4``, but the anchor is the consequent
of a ternary written on one physical line, so the `//` swallowed the `: ` else-branch and `tsc` answered
`src/project-memory/index.ts(489,2): error TS1005: ':' expected.` That is validity leg (a), so the round
could not run at all — and it read as an environment fault rather than an invalid mutant, because the old
script sent `pnpm typecheck` to `/dev/null` and died with a bare `[ELIFECYCLE] … exit code 2`. The result
in the table above came from an ad-hoc mutant; the committed script could not reproduce it. The marker is
now a block comment (`/* MUTANT H4 */`), which does not eat the `:`, and both validity legs fail loudly:
the script prints `INVALID MUTANT` and exits 1 instead of reporting a red. Both branches are proven
reachable — reverting the marker to `//` prints the TS1005 line, and a renamed marker prints the leg-(b)
message. The full round then reproduces 5/5 KILLED.

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

## Review round (2026-10-05, after `7ac5be0`)

An independent adversarial review (`/tmp/h-review/report.md`) passed the batch as landable and found no
runtime regression, but it falsified two claims this batch had written down and found two real test gaps:

- **A `/memory on|off` command that does not exist.** dsh registers `context/session-log/memory/autolearn/handoff`,
  and `/memory on` answers `Unknown option "on"`. `memoryEnabled` is changed by the settings card and by nothing
  else, so the rationale said the rule this batch exists to enforce and got the rule's own example wrong (F1).
- **"A stale profile fails loudly, never silently at the default" is half true.** Only the `project-context`
  entry — the settings-namespace owner — throws; the other three entries carry no config of their own, and
  `publishProjectContextSettings` runs *after* `resolvePluginConfig`, so they apply with `DEFAULT_CONFIG`:
  `handoffBudgetRecentTokens` becomes 20000 and `handoffPendingQuestion` becomes `defer` until the profiles are
  edited. `src/shared/settings.ts`'s own header already said this; the ruling contradicted it (F2). The deploy
  order is therefore **edit both profiles, then restart** — not "restart, then fix it".
- **The memory switch had no negative** and the card's union options were never compared with the schema (F3, F4)
  — hence mutants m5 and m6 above, both of which now die.

## Gate, read at the end of the round

`pnpm typecheck` 0 errors; `pnpm build` ok (`lib/client.js` 28605 bytes); `node --test`
**347 pass / 0 fail** (340 before this batch: +6 in `test/config-vocabulary.test.mjs` and +1 for the
`memoryEnabled` negative the review asked for); `grep -rn 'MUTANT' lib/ | wc -l` = 0;
`git grep -nE 'autoConsolidate|autoLearn|handoffTargetTokens|handoffKeepTokens|handoffSummaryThinking|handoffAdaptive|handoffLanguage' -- src/ client/` = 0 matches.

Numbers here expire — the point of the file is the mutants and their commands, not the count.
