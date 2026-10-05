# Batch E ruling — the command surface, one name per fact

**Status: implemented 2026-10-05** (code and tests in `4b7bfb8`; §5 records what the implementation had to
add beyond these rulings). The fourth pi triage pass (`docs/upstream-pi-triage.md` §"Fourth pass") marked
this portable from `0399e04` at `f6bea1d`. §1 below describes the **pre-change** grammar and is kept as the
record of what was renamed.

The grammar before the change, for reference:

```sh
D=/mnt/Data/Projects/dsh-project-context
git -C $D show 4b7bfb8^:src/project-handoff/command.ts | sed -n '39,66p'   # settingPatch + USAGE
git -C $D show 4b7bfb8^:src/project-handoff/index.ts  | sed -n '150,166p'  # the /handoff command itself
git -C $D show 4b7bfb8^:src/project-context/index.ts  | sed -n '120,158p'  # /context and /session-log
git -C /mnt/Data/Projects/pi-project-context show 0399e04                  # pi's change, tests included
```

## 1. What the surface does today

| spelling | effect today | the fact it sets |
| --- | --- | --- |
| `/handoff auto` | `handoffAdaptive: true` | how the threshold is decided |
| `/handoff 0.4` (bare ratio) | `handoffAdaptive: false, handoffThresholdRatio: 0.4` | the same fact, second spelling |
| `/handoff target 64k` | `handoffTargetTokens` | conversation tokens handed to *each summary* |
| `/handoff keep 20k` | `handoffKeepTokens` | recent conversation carried verbatim |
| `/session-log` (bare) | **writes** the session's artifacts | a read habit with a write side effect |
| `/session-log now` | the same write | the same fact, second spelling |

`/handoff` also carries `status`, `now`, `on`, `off`, `thinking off|session`, `pending defer|wait` and
`lang auto|zh|en`; none of those changes.

## 2. Rulings

1. **One fact, one spelling — a hard cut, no alias.** The precedent is this repo's own
   `/context-update` → `/memory update` rename with no alias: a second spelling is what let `auto` and the
   bare ratio drift apart in the first place. An old spelling must not act; the error text names the new
   one.
2. **`threshold` owns "how the threshold is decided".** `/handoff threshold auto` → `handoffAdaptive:
   true`; `/handoff threshold 0.4` → `handoffAdaptive: false, handoffThresholdRatio: 0.4`. A bare ratio
   and a bare `auto` are rejected with the usage line.
3. **`budget summary|recent` owns the two numbers**, because the old names did not say which was which:
   `budget summary <tokens>` → `handoffTargetTokens` (the config's own words: "conversation tokens handed
   to each summary"), `budget recent <tokens>` → `handoffKeepTokens` ("recent conversation tokens carried
   into the continuation verbatim"). `target`/`keep` are rejected. The 8000 floor on summary and the
   0 floor on recent stay exactly as they are — the rename moves no bound.
4. **`/session-log` reads, `write` writes.** The bare command is the "what is my state" habit, so it
   prints the log directory and the index and says how to write (`/session-log write`); `now` is retired
   rather than kept as an alias (ruling 1). `import <path…>` is unchanged. The ungated-command reasoning
   in `src/project-context/index.ts` still holds — `write` is that command under its new name — so the
   `releaseSessionQueue` path and its comment move with the verb, not away from it.
5. **"A parameter lives with the layer that owns it" is already satisfied and needs no port.** pi moved
   per-feature switches into the owning commands because in pi a command carries config. Here the settings
   card owns it: every field is declared once in `PluginSettingsSchema` and published through the shared
   namespace, so there is no umbrella-to-layer move to make. The ruling is to leave the card alone.

## 3. Acceptance criteria

- **E1** `threshold auto` and `threshold 0.4` set the same two fields the old spellings did; a bare
  `auto` and a bare ratio are rejected and the message names `threshold`.
- **E2** `budget summary 64k` sets `handoffTargetTokens` and `budget recent 20k` sets
  `handoffKeepTokens`; `target` and `keep` are rejected and the message names `budget`.
- **E3** the bounds do not move: summary keeps its 8000–200000 range and its example text, recent keeps
  0–200000.
- **E4** bare `/session-log` writes nothing and names `/session-log write`; `write` performs exactly what
  `now` did, including the queue release on the same session key; `import` is untouched.
- **E5** `USAGE`, the command `input.hint`, the README's command table and the memory/context pointers
  that name `/session-log now` all move together — a doc that still teaches a retired spelling is the
  defect this batch exists to remove.
- Mutants that must each redden exactly their own case: making the bare ratio act again (E1), dropping the
  `budget` regex while keeping `target`/`keep` (E2), making the bare session-log write (E4), leaving the
  old usage line (E5).

## 4. Not ported from `0399e04`

The **legacy-config migration** has no counterpart: pi read three pre-unification file shapes on the hot
path and folded them into flat keys once; our settings live in the shared namespace's
`PluginSettingsSchema`, `src/shared/config.ts` has no legacy term, and `src/shared/migrate.ts` migrates
directory layouts rather than config shapes. The umbrella command pi retired does not exist here, so
`89cadee`'s naming fix has nothing to rename either.

## 5. What the implementation had to add beyond these rulings (2026-10-05)

1. **Runtime receipts name levers too.** E5 lists `USAGE`, the command `input.hint`, the README's table and
   the memory/context pointers, but three *runtime* strings also teach a spelling: `thresholdRefusalText`'s
   knee sentence ("… a fixed ratio — `/handoff 0.4` is not checked against the knee …"),
   `thresholdOverrideText` ("handoff target … — lower `/handoff target` …") and
   `assertHandoffSummarizable`'s escape hatch ("run `/handoff keep 0`"). All three moved with their tests,
   because a receipt that names a retired spelling is the same defect as a README that does.
2. **The settings-card hint moved too.** `field.archiveEnabledHint` said `/session-log 仍可用` while the write
   it points at is now the `write` verb; it names `write` in both locales. That is a client change, so
   `pnpm build` moved `lib/client.js` (28376 → 28388 bytes).
3. **An incomplete verb names its own sub-verbs.** `budget` with no argument or a wrong one answers
   `budget needs summary or recent: …` rather than falling through to the whole usage line, since `budget`
   has two sub-verbs to choose between; a bare `threshold` gets the ratio sentence. Both are reachable from
   the command handler and pinned by the command-level test.
4. **`/handoff force` was deliberately left alone.** It is a third spelling of `now`, but ruling §1's table
   does not mention it and pi's own `0399e04` explicitly kept its synonyms ("the already-pinned
   language/run/force synonyms are untouched"). Retiring it would apply ruling 1 beyond what was ruled, so
   it stays and this note records the decision — it is a one-line change if the hard cut should cover it.
   **Addendum (2026-10-05, after `v0.3.0`):** the user ruled to close this, so `/handoff force` is now retired —
   it no longer triggers a manual handoff and answers with the `/session-log now`-shaped naming sentence
   instead of the generic `USAGE`; `now` is unchanged. Recorded under `未发布` in `CHANGELOG.md`.
5. **`keep` as a *setting* name survives.** The refusal's lever sentence still says "lower `keep`", because
   there `keep` names the `handoffKeepTokens` setting rather than a command spelling, and pi's port left the
   same sentence alone. Only spellings actually typed at `/handoff` moved.
   **Addendum (2026-10-05, after `v0.3.0`):** the user ruled to retire the `keep` shorthand from everything the
   user can see. The label now has one definition, `src/shared/setting-labels.ts`, read by the settings card
   (`client/locales.ts`) and by the receipts alike; `thresholdRefusalText` renders in both languages, using the
   session language `resolveHandoffLanguage` already picks for `HANDOFF.md`, so the zh card label is used
   verbatim instead of leaving a Chinese session with an English explanation; and `command.ts`'s two verb-style
   `keep ~N recent tokens` lines moved with it. The two-branch exclusion is unchanged. The rest of the status
   receipt (`context …`, `harness envelope …`, `adaptive target …`) is English in both languages — localizing
   every fragment is a separate decision, not a side effect of this one.

## 6. Addendum (2026-10-05, batch H): the key column is superseded

This ruling's tables name the config keys as they were at `v0.3.0`, which is the point of a ruling record; they are
kept verbatim. Batch H then renamed seven of them so each mirrors the command path that changes it
(`handoffTargetTokens` → `handoffBudgetSummaryTokens`, `handoffKeepTokens` → `handoffBudgetRecentTokens`,
`autoConsolidate` → `memoryEnabled`, `autoLearn` → `autolearnEnabled`, `handoffSummaryThinking` → `handoffThinking`,
`handoffAdaptive` → `handoffThresholdAuto`, `handoffLanguage` → `handoffLang`), with **no compatibility reader** —
the profiles persist those keys and this repo cannot rewrite them. Read this file's key names as the pre-rename
spelling and `docs/vocabulary-conventions.md` §5 K as the terminal state. The *command* spellings this ruling
settled (`threshold auto`, `budget summary|recent`, `thinking off|session`, `lang`, `pending`, `now`) are unchanged
by batch H and still current, as is item 5's "the `keep` shorthand is gone from everything the user can see".
