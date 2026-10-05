# Batch H ruling — config keys mirror the command path, and the memory layer's prefix says the layer once

**Status: implemented 2026-10-05** (code and tests in `7ac5be0`; the doc commit is the one this file
arrives in). Opened by the fifth pi triage pass (`docs/upstream-pi-triage.md` §"Fifth pass", commit `2177386`
of pi's `f6bea1d..ca71fd3`, plus `b869be3` for the notification strings), briefed in
`docs/batch-h-vocabulary-keys-brief.md`, and ruled on by the user before any code moved.

All pi claims below are read from the local pi checkout at the revision named, never from our own call path.
The brief pins `ca71fd3`; by the time this batch started, `origin/master` had advanced to `7e9241c`, and the two
commits in between (`60f63b0`, `7e9241c`) touch only `docs/`/spec prose and the skill-marker ruling — they do not
touch `RENAMED_KEYS` or `shared/config.ts`, so the brief's table stands.

## 1. What was renamed and why

pi's rule (`2177386`'s body, and `.codestable/reference/vocabulary-conventions.md` §2.2): **a config key mirrors
the command path that changes it.** This repo closed the same drift on its *command* surface in batch E, where the
command said `budget summary` while the key said `handoffTargetTokens`.

| old key | new key | command it mirrors |
| --- | --- | --- |
| `autoConsolidate` | `memoryEnabled` | the settings card — **dsh has no command that changes it** |
| `autoLearn` | `autolearnEnabled` | `/autolearn` (the capability switch) |
| `handoffTargetTokens` | `handoffBudgetSummaryTokens` | `/handoff budget summary <tokens>` |
| `handoffKeepTokens` | `handoffBudgetRecentTokens` | `/handoff budget recent <tokens>` |
| `handoffSummaryThinking` | `handoffThinking` | `/handoff thinking off\|session` |
| `handoffAdaptive` | `handoffThresholdAuto` | `/handoff threshold auto` (pairs with `handoffThresholdRatio`) |
| `handoffLanguage` | `handoffLang` | `/handoff lang auto\|zh\|en` |

Not renamed, deliberately: `handoffPendingQuestion` (dsh-only; pi's analogue is its own `handoffGuard`) and
`handoffThresholdRatio` (pi never renamed it). `archiveEnabled` / `handoffEnabled` already fit `<capability>Enabled`.

## 2. The rulings

- **H-D1 — scope: all seven.** pi states outright that dsh has to adopt the new spellings, and the alternative
  (a subset) would leave the two config surfaces differing on the rest.
- **H-D2 — no compatibility reader (option b).** This is a ruling, not an omission. pi's migration seam is
  `legacyConfigPatch`, which rewrites a **project** file; our values are persisted by the platform into each
  profile's own `~/.dsh/profiles/{web,desktop}/cordis.patch.yml`, which this repo cannot rewrite. An alias would
  therefore never retire, and this repo has refused lasting aliases before (`/context-update`, `/handoff force`).
  The accepted cost is a **half-loud** failure, which the independent review corrected in this paragraph: the
  `project-context` entry — the settings-namespace owner, whose `apply()` calls `resolvePluginConfig` unguarded —
  throws `unknown config key "<old>"` and loses its card, but the other three entries carry **no config of their
  own** (both profiles attach it to `- id: project-context` only) and `publishProjectContextSettings` runs after
  `resolvePluginConfig`, so they apply with `DEFAULT_CONFIG` **silently**: `handoffBudgetRecentTokens` becomes
  20000 and `handoffPendingQuestion` becomes `defer` until the profiles are edited. `src/shared/settings.ts`'s own
  header already documented that fallback; this ruling's first draft contradicted it. The live settings reader
  inside the owner still swallows and falls back to the entry it was applied with.
- **H-D3 — moot.** It asked what a compatibility reader would do about rewriting the accepted old name; with (b)
  there is nothing to rewrite.
- **H-D4 — do the notification-prefix convergence.** The memory layer's replies now lead with `Memory: `, with pi's
  two exemptions kept (`Usage: …` lines, and the multi-line status report — in dsh that is `/context`'s
  path report, left as `Project context:`).
- **H-D5 — do NOT adopt pi's terminal wording.** dsh's handoff receipt keeps the settings card's own name for the
  recent-window setting, in the session's language (`保留最近对话（token）` / `Recent tokens kept`), and keeps
  `summary thinking <level>`. Three reasons: that line is the only bilingual one and pi's `~N recent carried` is
  English-only; the repo's invariant is that a receipt names a knob the way the card names it, so switching would
  break card↔receipt alignment; and pi's ` · summary budget N` describes the same fact as our `adaptive target N`,
  only segmented differently (pi folds it into the threshold clause). Zero wording migration in this batch.
- **H-D6 — build a dsh-owned conventions file**, modelled on pi's: `docs/vocabulary-conventions.md`. It owns the
  standing rules and the terminal-state tables; this ruling owns the batch's decisions and points there.

## 3. Corrigenda to the brief

1. **`client/card-fields.ts` was missing from the brief's §4 target table.** It carries the same seven keys twice
   (the `ProjectContextSettings` interface and the `SECTIONS` row table), and `test/settings-form.test.mjs` compares
   the row-key set with the schema's. A rename that skipped it cannot compile (`FieldRow.key` is
   `keyof ProjectContextSettings`) — but a brief that omits it is exactly how "a rename lands half-done" starts, so
   it is recorded here rather than silently fixed. This layer is one of the six a settings key touches.
2. **The brief's "five user-visible literals" covers only part of the surface.** It listed line numbers for
   `src/project-memory/index.ts` and excluded the branches the same family reaches. D4 was applied by **rule**
   (`Project memory…` → `Memory: `, with pi's exemptions), not by that line list: seven reply strings changed plus
   the `writtenTarget` helper. `Consolidation ran but produced no new memory or context.` was left alone, because it
   is not in the family named by the ruling and pi left its analogue alone too.

## 4. What landed

- **The config face, in lockstep:** `src/shared/config.ts` (interface, `DEFAULT_CONFIG`, readers, the inline
  `off|session` / `auto|zh|en` validators and their error messages, plus a header note recording the rule and the
  no-alias decision), `src/shared/settings.ts` (`PluginSettingsSchema`), `client/card-fields.ts` (interface + rows),
  `client/locales.ts` (`field.<key>` / `field.<key>Hint` moved with the fields; **label and hint text unchanged** per
  H-D5), `src/shared/setting-labels.ts` (`HANDOFF_KEEP_TOKENS_LABEL` → `HANDOFF_BUDGET_RECENT_LABEL`, since the key
  it was named after no longer exists) and its two importers, and every runtime reader across
  `src/project-{context,memory,autolearn,handoff}/`.
- **The memory face (D4):** `src/project-memory/index.ts`. The dsh-only `writtenTarget` helper now names the
  **files** (`MEMORY.md` / `CONTEXT.md` / `MEMORY.md and CONTEXT.md`) instead of the layer. That is what lets the
  prefix lead without repeating the layer (`Memory: memory and context updated` would violate the rule) while
  keeping the invariant the helper exists for: a receipt must not claim an artifact that did not land. The unit
  assertions that pin the three cases were updated, not weakened, and the doc comment that claimed "a clean pass
  reads exactly as it did before the report carried counts" was corrected because the new prefix makes it false.
- **A new test file, `test/config-vocabulary.test.mjs`**, owns the batch's contract: value passthrough of all seven
  new names and their defaults; the schema exposes the new spellings and not the old ones; **each old name throws
  `unknown config key`** (the (b) contract); both profiles' real persisted shapes resolve and all four `apply()`
  calls accept them, with a positive control that the same call site does throw on an old key; every key the
  `/handoff` verbs write back is a schema key; and a source scan asserting no `.ts`/`.tsx` under `src/` or `client/`
  still spells a retired key.

## 5. Acceptance criteria, rebased

The brief's H2/H3 (old name resolves to the new field; a junk old value falls back through the same validator) and
the compat half of H8 describe **option (a)**, which the ruling rejected. They are replaced by their negation:

| id | brief's criterion | what is pinned now |
| --- | --- | --- |
| H1 | card renders every renamed field | unchanged — `test/settings-form.test.mjs` compares rows with the schema and requires a label+hint per row; `test/card-render.test.mjs` renders it |
| H2/H3 | old name resolves; junk old value falls back | **inverted**: a retired spelling throws (`test/config-vocabulary.test.mjs`) |
| H4 | `resolvePluginConfig` still throws on a genuinely unknown key | unchanged (`test/logic.test.mjs`'s `{ nope: 1 }`), and the new file's throws are the specific-key evidence |
| H5 | the four `apply()` paths resolve the profiles' real shape | covered, plus the positive control above |
| H6 | no reader still reads an old name | covered by the source scan, which is wider than `src/`: it also covers `client/` |
| H7 | one prefix per layer, never repeating the layer | covered; the two exemptions are asserted by leaving them alone |
| H8 | mutation round | rebased and run — see §6 |

## 6. Verification

- **Mutation round** (3 valid mutants; each compiled with 0 errors, carried its marker into `lib/`, and reddened
  exactly its own case; `src/ client/ test/` were snapshotted to `/tmp` with `sha256sum -c` and restored byte-identically):
  1. give one retired name a compatibility term in the unknown-key check → the (b)-contract case and its positive
     control redden, and so does the source scan (the mutant's own text spells the old name);
  2. make `/handoff budget recent` write `handoffKeepTokens` → the write-back guard and the source scan redden, and
     two pre-existing literal assertions in `test/logic.test.mjs` redden too;
  3. revert one `Memory: ` prefix to `Project memory: ` → two `test/logic.test.mjs` cases redden.
  One mutation was **discarded as invalid**: renaming a card dictionary key back to the old spelling does not
  compile, because `SettingsCardKey` is a closed literal union. An invalid mutant's red is not evidence — but the
  fact is worth recording: the card's copy layer cannot be left half-renamed.
- **Gates, read now (not quoted from the brief):** `pnpm typecheck` 0 errors, `pnpm build` ok
  (`lib/client.js` 28605 bytes), `node --test` **347 pass / 0 fail** (340 before this batch: the six cases in
  `test/config-vocabulary.test.mjs` plus the `memoryEnabled` negative the review asked for),
  `grep -rn MUTANT lib/ | wc -l` = 0, and `git grep -nE '<seven old names>' -- src/ client/` = 0.
- **Independent adversarial review:** `.agents/evidence/2026-10-05-config-vocabulary/review.md` (an independent
  read-only subagent). Verdict **LANDABLE**: the rename is type-pinned at every layer and all seven keys were
  probe-verified end to end (each one shown to change the behaviour it claims), with no runtime regression on the
  post-migration path. It falsified two things this batch had itself written down and found two real test gaps,
  all fixed before this doc landed:
  - **F1** `/memory on|off` is pi's spelling — dsh has **no** command that writes `memoryEnabled` (the settings
    card is the only writer), and the exempt status report is `/context`, not `/project-context status`. Corrected
    in `src/shared/config.ts`'s header, the CHANGELOG, `docs/vocabulary-conventions.md` and this file.
  - **F2** the stale-profile failure is half loud, not loud: see H-D2 above, now corrected here, in the CHANGELOG
    and in the conventions file, and §7's order changed with it.
  - **F3** the memory switch had no negative; mutant **m5** (the pass reading `autolearnEnabled` instead) survived
    all 346 cases. `test/top-level-gate.test.mjs` now carries the negative, and m5 dies on it.
  - **F4** (pre-existing) card union `options` were never compared with the schema, and `card-render.test.mjs`
    derives its counts from that same table, so a lost option was invisible. `test/settings-form.test.mjs` now
    compares them, and mutant **m6** dies on it. F6 ("schema key" compared against `DEFAULT_CONFIG`) was cosmetic
    and is now compared against `PluginSettingsSchema`.
  - What it could **not** verify, and this ruling therefore does not claim: the live host's behaviour on a stale
    profile (the restart is user-only; F2 is module-level plus the loader's own `create(…).catch(…)` isolation
    path), and the live-reload case, where a retained old fiber could keep an older publication alive.

## 7. Deployment order — the part this repo cannot do itself

The two profiles are user-owned and still carry the old names. `~/.dsh/profiles/desktop/cordis.patch.yml` has
`handoffAdaptive: true` and `handoffKeepTokens: 0`; `~/.dsh/profiles/web/cordis.patch.yml` has `handoffKeepTokens: 0`
plus a comment that names it. All four lines change to `handoffThresholdAuto: true` /
`handoffBudgetRecentTokens: 0`, and the order is **edit both files first, then restart** (the review's F2):
restarting first leaves the `project-context` entry failing — it owns the settings namespace, so its card
disappears — while `project-memory`, `project-autolearn` and `project-handoff`, whose entries carry no config of
their own, apply with `DEFAULT_CONFIG` and silently run `handoffBudgetRecentTokens: 20000` /
`handoffPendingQuestion: defer`. The user's own `0` / `wait` would be ignored with nothing on screen saying so.
Editing first has the mirror-image transient — the running host's live reader sees an unknown key and swallows it
— but the restart is the very next step, so that window is the harmless direction.
`handoffPendingQuestion: wait` and `maxMemoryChars: 40000` are unaffected either way.

**Corrigendum (2026-10-05, source- and kernel-verified; the deployment had not run yet, so the breakage below is
predicted from the code path and not observed).** The transient above is *not* swallowed, so the window is not
harmless. `@deepseek-ai/dsh-base` — in both profiles' bundle list — mounts `hmr` (`@deepseek-ai/dsh-hmr`):
`disabled: !!js "!ctx.get('profileContext')"`, `config.root: []`, commented "Profile configuration reloads by
default". That watcher roots itself at each live patch file's **directory**
(`patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)]` in
`packages/boot/hmr/src/index.ts`, `PROFILE_PATCH_FILENAME = 'cordis.patch.yml'`), so an external edit to
`cordis.patch.yml` is reconciled into the **running** Loader tree by `reconcileProfilePatches`
(`packages/boot/app-boot/src/index.ts`), whose last act is
`entry.update({ config: { ...includeConfig, patches: prepared } })`; the Include re-composes the changed entry and
`apply()` re-runs. All four plugins resolve their config in the **first statement** of that apply, unguarded:
`src/project-context/index.ts:61`, `src/project-memory/index.ts:361`, `src/project-autolearn/index.ts:57`,
`src/project-handoff/index.ts:84`. New keys under the old code therefore throw there exactly as the old keys
under the new code do, `introduced` is non-empty, and the reconcile **throws** — the HMR watcher only logs
`config reload at <file> failed` and the failed entry stays. Observable without any restart: the
`project-context` card disappears and the other three fall back to `DEFAULT_CONFIG`, i.e. §7's "restart first"
failure mode, reached earlier. The surviving watches are visible from the live host alone: take the 19387 holder
from `ss -ltnp | grep 19387`, then `grep -oE 'ino:[0-9a-f]+' /proc/<pid>/fdinfo/*` resolves to `~/.dsh` **and**
`~/.dsh/profiles/desktop` (the second patch path, `~/.dsh/cordis.patch.yml`, does not exist, which is exactly why
one root walks up to `~/.dsh`).

Consequence for the order: **edit and restart must be back-to-back**, which the command block below does in
seconds. "Edit now, restart when convenient" is not the safe half of this choice — it is the same half-loud
breakage as restarting first, reached earlier. The `src/shared/settings.ts:95` reader that does swallow an unknown
key is the settings *projection*, not the apply path, which is where §7's original reading of the transient went
wrong. This closes the live-reload question §6 left open ("a retained old fiber could keep an older publication
alive"): a retained fiber does not save the entry.

**The block.** Verified on copies of both files (4 lines changed, 0 leftovers), and pre-read with
`bash /etc/nixos/scripts/dsh-desktop-restart.sh --dry-run` and `--verify-only` — the two read-only modes are
allowed inside a session, the restart itself is not, and it ends the session that runs it, so all four lines go in
your own terminal:

```bash
cp ~/.dsh/profiles/desktop/cordis.patch.yml ~/.dsh/profiles/desktop/cordis.patch.yml.bak-$(date +%Y%m%d-%H%M)-batchh
cp ~/.dsh/profiles/web/cordis.patch.yml     ~/.dsh/profiles/web/cordis.patch.yml.bak-$(date +%Y%m%d-%H%M)-batchh
sed -i 's/handoffKeepTokens/handoffBudgetRecentTokens/g; s/handoffAdaptive/handoffThresholdAuto/g' \
  ~/.dsh/profiles/desktop/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml
bash /etc/nixos/scripts/dsh-desktop-restart.sh
```

**In the successor session.** The load check is the three-part one owned by the tracked skill
`dsh-host-build-restart-verify` (step 4: the holder's start against the last `src/` commit, the change's
characteristic line in `lib/`, and `diff -rq <tmp> lib/` against a fresh `tsc` into a temp dir) — do not re-derive
it here. Two batch-specific reads on top: the settings card must be **back** and carry the profile's own values
(`handoffThresholdAuto: true`, `handoffBudgetRecentTokens: 0`) — a missing card means apply threw, and `20000` /
`defer` in its place means the entries fell back to `DEFAULT_CONFIG`, which is exactly the failure this corrigendum
predicts; and the batch G observable, which only a real pass produces, is a marked skill name whose body that round
did not render being refused with `body not shown this pass`.

## 8. Deliberate non-goals

- pi's terminal wording for the handoff receipt (H-D5).
- `Consolidation ran but produced no new memory or context.` — not in the renamed family, and pi kept its analogue.
- The autolearn layer's replies (`Skill created: …` etc.) keep naming the **object** rather than the layer. No
  ruling was taken on converging them; it is recorded as an open item in `docs/vocabulary-conventions.md`.
- `handoffPendingQuestion`, `handoffThresholdRatio`, `archiveEnabled`, `handoffEnabled`: unchanged.
