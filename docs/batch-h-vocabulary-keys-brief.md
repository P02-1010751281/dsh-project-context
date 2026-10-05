# Batch H port brief — config keys mirror the command path, and one notification prefix per layer

**Status: implemented 2026-10-05** — rulings in `docs/batch-h-vocabulary-keys-ruling.md`, standing rules in
`docs/vocabulary-conventions.md`. Opened by the fifth pi triage pass (`docs/upstream-pi-triage.md` §"Fifth pass",
commit `2177386` of the range `f6bea1d..ca71fd3`, pi's v0.4.0, plus `b869be3` for the strings v0.3.0 left
behind). Every claim here is either a pi path at a stated revision or a read-now command.

> **Dated addendum (2026-10-05, this file is kept as the pre-change record):** two of its sections are superseded.
> §4's target table **omits `client/card-fields.ts`**, which carries the same seven keys twice (the settings
> interface and the row table) and has to move with them — `test/settings-form.test.mjs` compares the row-key set
> with the schema's, and `FieldRow.key` is `keyof ProjectContextSettings`, so skipping it fails to compile. §7's
> H2/H3 and the compat half of H8 describe a compatibility reader; H-D2 was ruled as option (b), so they are
> replaced by their negation (a retired spelling must throw), as the ruling's §5 tabulates.

## 1. Why — pi says outright that dsh has to adopt the new spellings

`2177386`'s body: "Six of these keys were shared with dsh, so the two config surfaces now differ and dsh has
to adopt the new spellings; that is recorded in the file header, the docs and the changelog rather than left
implicit." pi's `extensions/project-context/shared/config.ts` header repeats it: "Six of the renamed keys were
shared with dsh, so the two config surfaces now differ: dsh reads its own spellings and ignores the new ones,
and it has to adopt them."

The drift this closes is the same one this repo closed on its *command* surface in batch E: the command said
`budget summary` while the key said `handoffTargetTokens`, and a notification went on saying `Auto summarize
target` after the command was renamed. pi's rule is that a key mirrors the command path that changes it.

**This batch is riskier here than in pi, and that is the whole point of writing it down.** pi's migration
seam is `legacyConfigPatch`, which reads a **project** file (`.agents/memory/project-context.json`). Our
settings are parsed from the Loader entry's config and the platform persists what the card writes into each
profile's own `cordis.patch.yml` — files outside this repo. We have no legacy-name reader to extend
(`git grep -in legacy -- src/shared/config.ts` → `0`), and `resolvePluginConfig` **throws** on an unknown key
(`src/shared/config.ts:105-107`). The settings namespace's live reader swallows that and falls back
(`src/shared/settings.ts:94-101`), but the four `apply()` call sites call `resolvePluginConfig` unguarded. So a
rename without a compatibility reader is not a silent default — it is a thrown
`dsh-project-context: unknown config key "<old name>"` at plugin apply, with the profiles' values stranded.

## 2. What pi does — read at `ca71fd3`

```sh
P=/mnt/Data/Projects/pi-project-context   # local tree is 6707376; read origin/master == ca71fd3
git -C $P show 2177386                                    # keys + prefixes + renderers, tests included
git -C $P show ca71fd3:extensions/project-context/shared/config.ts   # the settled header and RENAMED_KEYS
git -C $P show ca71fd3:.codestable/reference/vocabulary-conventions.md
```

**The rename table**, copied from pi's `legacyConfigPatch` (its validators are the same readers `parseConfig`
uses, so a hand-edited bad old value falls back to the default instead of entering the config unchecked):

| pi old name | pi new name | validator |
| --- | --- | --- |
| `autoConsolidate` | `memoryEnabled` | `bool` |
| `autoLearn` | `autolearnEnabled` | `bool` |
| `handoffTargetTokens` | `handoffBudgetSummaryTokens` | bounded(min summarize, max keep-recent) |
| `handoffKeepTokens` | `handoffBudgetRecentTokens` | bounded(0, max keep-recent) |
| `handoffSummaryThinking` | `handoffThinking` | `thinkingOf` |
| `handoffAdaptive` | `handoffThresholdAuto` | `bool` |
| `handoffLanguage` | `handoffLang` | `languageOf` |

Two rules ride the existing one-time migration: **the new name wins when both are present** (so a rename can
never undo a newer choice), and the rewrite drops the old name. `legacyConfigPatch` stays the only place that
knows an old name.

**The notification half** (`2177386` + `b869be3`): nine prefixes collapse to one per layer and the prefix no
longer repeats the layer after it — `Automatic consolidation`, `Project memory updated` and `Memory cap` all
become `Memory`; `Auto handoff` becomes `Handoff`; the three session-log spellings collapse. Two exemptions
are deliberate: `Usage: …` lines (they already start with their command) and the multi-line
`/project-context status` report, whose line labels are a different surface from a one-line toast.
`memoryStatusMessage` was renamed `memoryStatusLine` for the same reason.

## 3. What dsh has today — read now

```sh
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -cE '\b(memoryEnabled|autolearnEnabled|handoffBudgetSummaryTokens|handoffBudgetRecentTokens|handoffThinking|handoffThresholdAuto|handoffLang)\b' -- src/   # 0
for k in autoConsolidate autoLearn handoffTargetTokens handoffKeepTokens handoffSummaryThinking handoffAdaptive handoffLanguage; do git -C $D grep -rl "$k" -- src/ client/; done
git -C $D grep -n 'unknown config key' -- src/shared/config.ts
grep -n 'handoffKeepTokens\|handoffAdaptive' ~/.dsh/profiles/*/cordis.patch.yml
```

All seven old names are live here, in three places each:

- `src/shared/config.ts` — the `PluginConfig` interface (`:9`, `:27`, `:35`, `:39`, `:41`, `:43`, `:47`), the
  `DEFAULT_CONFIG` values (`:52`–`:71`), and `resolvePluginConfig`'s readers (`:173`–`:192`).
- `src/shared/settings.ts` — `PluginSettingsSchema` (`:43`, `:52`, `:56`, `:58`–`:62`), every field carrying
  `.extra("volatile", true)`; the fields carry **no** description, so card labels come from the client.
- `client/locales.ts` — `"field.<key>"` + `"field.<key>Hint"` per locale (`field.autoConsolidate` at `:22`,
  `field.autoLearn` at `:42`, `field.handoffAdaptive` at `:52`, `field.handoffTargetTokens` at `:56`,
  `field.handoffKeepTokens` at `:58` reading the shared `HANDOFF_KEEP_TOKENS_LABEL`). **A key rename moves
  these label keys with it**, so the card keeps rendering; renaming the field is not a separate string edit,
  but it is four dictionary entries per field.

Plus the runtime readers: `src/project-memory/index.ts`, `src/project-autolearn/index.ts`, and
`src/project-handoff/{auto,classify,command,index,perform,summary,threshold,conversation,language}.ts`, and
`src/shared/setting-labels.ts`.

Two things **outside** the rename set, deliberately: `handoffPendingQuestion` is a dsh-only key pi does not
rename (pi's analogue is `handoffGuard`, which is pi-only), and `handoffThresholdRatio` was never renamed by pi.

The profiles persist three of these keys today — `handoffAdaptive: true`, `handoffKeepTokens: 0`,
`handoffPendingQuestion: wait` — and web's copy carries a comment block explaining that `handoffKeepTokens: 0`
is deliberate ("hand off the summary only; `src/shared/config.ts` defaults to 20000"). Those files are
user-owned; the standing guard says no profile edits without the user naming them.

The five user-visible `"Project memory…"` literals to converge are in `src/project-memory/index.ts` (`:538`,
`:539`, `:557`, `:567`, `:579`), plus the cap warning at `:472`.

## 4. Target changes

| module | change |
| --- | --- |
| `src/shared/config.ts` | the interface, `DEFAULT_CONFIG`, `CONFIG_KEYS` and `resolvePluginConfig`'s readers take the new names; **add the old→new term to the reader layer**, because `CONFIG_KEYS` is built from `Object.keys(DEFAULT_CONFIG)` and an old key not in it throws |
| `src/shared/settings.ts` | `PluginSettingsSchema` field names follow; `volatile` marks stay per field |
| `src/shared/setting-labels.ts` | `HANDOFF_KEEP_TOKENS_LABEL` is named for the old key; rename the constant (and its importers: `src/project-handoff/{command,threshold}.ts`) or the shared definition names a key that no longer exists |
| `client/locales.ts` | `field.<old>` / `field.<old>Hint` → `field.<new>` / `field.<new>Hint`, both locales |
| every reader above | mechanical field rename; no behaviour change |
| `src/project-memory/index.ts` | notification prefixes converge to `Memory: …` (five literals + the cap warning), with pi's two exemptions honoured |

## 5. User-visible surface

- The settings card's **field ids** change (labels stay keyed to them), so a user's persisted values must be
  migrated, not merely renamed.
- The status/toast strings change from `Project memory and context are already up to date …` to the
  `Memory: …` family.
- `~/.dsh/profiles/{desktop,web}/cordis.patch.yml` would need their three keys updated in the same step —
  **user-run**, outside this repo.
- No `CHANGELOG.md` entry until the code lands; a landed version is a breaking change and must say so.

## 6. Decisions that need the user's ruling

- **H-D1** — adopt all seven new spellings, a subset, or none? `autolearn*` is the one family where pi's own
  rule (`autolearn*` all lowercase `learn`) already matches dsh's existing `autolearnTurns` /
  `autolearnIntervalMs`, so `autoLearn` → `autolearnEnabled` is the only inconsistency removed there.
- **H-D2** — where the compatibility reader lives. Either (a) `resolvePluginConfig` accepts the old names as
  fallbacks, which keeps the profiles working untouched, or (b) no reader and the user updates both profiles
  in the same step. (a) is a lasting alias — the repo's "one name, one spelling" work has refused aliases
  before (`/context-update`, `/handoff force`) — while (b) is a loud apply-time failure if the step is
  missed. This repo has never had a config-level alias, only a directory-layout migration
  (`src/shared/migrate.ts`), so (a) would be a new precedent.
- **H-D3** — if (a), does the accepted old name get rewritten anywhere? dsh cannot rewrite the profile (the
  platform owns that file), so the alias would persist indefinitely. That is the argument for (b).
- **H-D4** — adopt the notification-prefix convergence? It rewrites English user-visible strings that the
  previous session's localization work left alone on purpose ("the rest of the status receipt is still
  English, and localizing every fragment is a separate decision"). This ruling and that one overlap.
- **H-D5** — pi's terminal wording is `~N recent carried` and ` · summary budget N`; dsh's receipt uses the
  settings-card label (`Recent tokens kept`) and `summary thinking N`. A key name and a card label are
  different surfaces, so this is a wording question, not a mechanical rename.
- **H-D6** — is a dsh-owned vocabulary conventions file wanted (the fifth pass's third row)? pi's
  `vocabulary-conventions.md` is the artifact that keeps a rename from landing half-done; our nearest
  counterpart is `docs/batch-e-command-surface-ruling.md`, which records decisions but not the rules.

## 7. Acceptance criteria

- **H1** — the settings card renders every renamed field (a missing `volatile` silently drops the whole card;
  assert on the projected form, not on the schema literal).
- **H2** — a config object carrying an old name resolves to the new field with the **same** value, and when
  both names are present the new one wins (pin both orders).
- **H3** — an old name carrying a junk value falls back to the default through the same validator the current
  key uses, rather than entering the config unchecked.
- **H4** — `resolvePluginConfig` still **throws** on a genuinely unknown key: the compatibility term must not
  turn the type check off (the negative control for H2/H3).
- **H5** — the four `apply()` paths resolve the profiles' real config shape without throwing.
- **H6** — every runtime reader reads the new field; no reader still reads an old name
  (`git grep -nE '\b(autoConsolidate|autoLearn|handoffTargetTokens|handoffKeepTokens|handoffSummaryThinking|handoffAdaptive|handoffLanguage)\b' -- src/ client/` → only the compatibility term and this brief's own text).
- **H7** — the notification literals render one prefix per layer and never repeat the layer, with `Usage:` lines
  and the multi-line status report exempt.
- **H8** — the mutation round: each compat term removed reddens exactly its own case; the winner-order rule
  inverted reddens the both-present case only.

## 8. Verify, then land

```sh
cd /mnt/Data/Projects/dsh-project-context
pnpm typecheck && pnpm build && node --test      # read the counts, never a recorded one
grep -rn 'MUTANT' lib/ | wc -l                   # expect 0
# mutation round:      .agents/skills/dsh-plugin-mutation-round/
# loaded-vs-not check: .agents/skills/dsh-host-build-restart-verify/
# release flow:        .agents/skills/dsh-project-context-release/   (this is a breaking change)
```

This batch changes persisted config keys, so a half-landed version is worse than none: land the code, the two
profiles' keys and the card together, and do not ask for the host restart until H5 is green. The profile edits
are user-run; if H-D2 lands as (b), the restart and the profile edit must happen in the same step or the host
comes up with `unknown config key`.
