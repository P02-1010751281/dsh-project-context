# Adversarial review — batch H (config-vocabulary convergence), dsh-project-context

Reviewer: independent subagent. HEAD at review: `798ee70`. Working tree under review is **uncommitted**
and it **moved during the review** (see "What I could not verify"): when I started, the change was
`src/` + `client/` + `test/` only; mid-review a concurrent writer added the docs half
(`CHANGELOG.md`, `README.md`, `.agents/memory/MEMORY.md`, four `docs/` edits, and two new untracked files
`docs/vocabulary-conventions.md`, `docs/batch-h-vocabulary-keys-ruling.md`, plus
`.agents/evidence/2026-10-05-config-vocabulary/{README.md,mutate.sh}`).

Read-only: I modified nothing under the repo (I did run the repo's own `pnpm build`/`pnpm test`, which
regenerate the gitignored `lib/`; the tracked tree was untouched by me). Scratch files and this report live
under `/tmp/h-review/`.

Environment: `node v24.21.0` (`/nix/store/…-nodejs-24.21.0/bin/node`), `pnpm 12.3.4`.

Gates re-read on the frozen src hash
`sha256(find src client test | sort) == 3e1f7fe7f4d9af0a7482414cbdce45319ea6ee78b3548adad49bfb91ea7adb54`
(same before and after the run, so no concurrent src edit was in flight):

```
$ pnpm typecheck     -> exit 0
$ node --test        -> tests 346 / pass 346 / fail 0
$ pnpm build         -> built ./lib/client.js (28605 bytes)
$ grep -rn MUTANT lib/ | wc -l -> 0
```

---

## VERDICT

**LANDABLE** — with two documentation corrections that must ride the same commit.

Strongest single reason: the seven-key rename is **type-pinned at every layer** and all seven keys are
proven wired end-to-end by probe, but the change's own stated rationale and failure-mode description are
false in five places: the docs claim a `/memory on|off` command that does not exist in dsh, and they claim
a stale profile "fails loudly … never silently at the default" when in fact only the settings-namespace
owner throws while the three sibling plugins silently run on `DEFAULT_CONFIG` (the user's `handoffKeepTokens: 0`
becomes 20000 and `handoffPendingQuestion: wait` becomes `defer`). No runtime regression exists on the
post-migration path.

---

## Findings

### F1 — Documentation names two commands that do not exist in dsh (`/memory on|off`, `/project-context status`)

**Claim.** `src/shared/config.ts`'s new header, the CHANGELOG entry, `docs/vocabulary-conventions.md` §2.2
and `docs/batch-h-vocabulary-keys-ruling.md` all state that `memoryEnabled` "mirrors `/memory on|off`", and
the CHANGELOG names the exempt multi-line status report as "`/project-context status`".

**Probe.** All four `apply()` calls with a stub ctx that records `commands.register` names; then invoke the
real `/memory` handler for `rawInput` `on`/`off`.

```
$ node /tmp/h-review/probe5.mjs
  registered command names: ["context","session-log","memory","autolearn","handoff"]
$ node /tmp/h-review/probe1.mjs   (section 8)
  registered command: memory
  rawInput="on"  -> {"kind":"error","text":"Unknown option \"on\". Usage: /memory (status) | /memory update"}
  rawInput="off" -> {"kind":"error","text":"Unknown option \"off\". Usage: /memory (status) | /memory update"}
$ grep -n "memory on\|/project-context" src/shared/config.ts CHANGELOG.md docs/vocabulary-conventions.md docs/batch-h-vocabulary-keys-ruling.md
src/shared/config.ts:4: … — `/memory on|off` writes `memoryEnabled`,
CHANGELOG.md:75:- … `autoConsolidate`→`memoryEnabled`（`/memory on|off`）、
CHANGELOG.md:91:  （`Usage:` 行、多行 status 报表——本仓即 `/project-context status` 那份）。
docs/vocabulary-conventions.md:38:- **键名镜射改变它的命令路径**…：`memoryEnabled`（`/memory on|off`）、`autolearnEnabled`、
docs/batch-h-vocabulary-keys-ruling.md:21:| `autoConsolidate` | `memoryEnabled` | `/memory on\|off` |
docs/batch-h-vocabulary-keys-ruling.md:46:  two exemptions kept (`Usage: …` lines, and the multi-line status report — in dsh that is `/project-context`'s
```

Both spellings are pi's: pi's toggle is `/project-context on|off <feature>` (verified:
`pi-project-context/extensions/project-context/index.ts:202` `if (verb !== "on" && verb !== "off")`), and
pi's status command is `/project-context status`. dsh's cross-layer command is `/context` and dsh has **no**
command that writes `memoryEnabled` — only the settings card changes it. `docs/vocabulary-conventions.md` is
internally inconsistent: §2.1 lists the real command set while §2.2 asserts the non-existent one.

**Classification:** false claim in documentation. **Severity:** low–medium (it is the exact rule the batch
exists to enforce, and it is repeated in five places, so a future reader cannot tell what the command face is).
**Minimal fix:** replace `/memory on|off` with the settings card (or state "no command changes this key in
dsh") in `config.ts:4`, `CHANGELOG.md:75`, `vocabulary-conventions.md:38`, `ruling:21`; replace
`/project-context status` with `/context` in `CHANGELOG.md:91` and `ruling:46`.

### F2 — The stale-profile failure is only half loud: the owner throws, the three siblings silently revert to defaults

**Claim.** `docs/batch-h-vocabulary-keys-ruling.md` §2/§5K: "the four `apply()` call sites are unguarded …
Measured consequence: a stale profile fails at plugin apply, **never silently at the default**."
`CHANGELOG.md` and `vocabulary-conventions.md` §5K repeat the "throws at apply / fails loudly" framing.

**Probe.** Apply each plugin with (A) the shape the profiles *currently* persist, (B) no config at all —
which is what the profile actually attaches to the three sibling entries — and (C) `effectivePluginConfig`
on a fresh, unpublished settings module.

```
$ node /tmp/h-review/probe2.mjs
=== A. each apply() on the REAL currently-persisted desktop shape (old keys) ===
  context: THREW Error: dsh-project-context: unknown config key "handoffAdaptive"
  memory:  THREW Error: dsh-project-context: unknown config key "handoffAdaptive"
  autolearn: THREW Error: dsh-project-context: unknown config key "handoffAdaptive"
  handoff: THREW Error: dsh-project-context: unknown config key "handoffAdaptive"
=== B. each apply() with NO config (what the three sibling entries actually get) ===
  {"context":"accepted","memory":"accepted","autolearn":"accepted","handoff":"accepted"}
=== C. effectivePluginConfig with NO publication (fresh module instance) ===
  returned fallback object? true
=== D. defaults the siblings would silently run with ===
  DEFAULT handoffBudgetRecentTokens=20000 (profile wants 0)
  DEFAULT handoffPendingQuestion=defer (profile wants wait)
  DEFAULT maxMemoryChars=40000 (profile wants 40000)
```

Why B is the real wiring: both `~/.dsh/profiles/{desktop,web}/cordis.patch.yml` attach the config to
`- id: project-context` only (read directly), and the bundle `cordis.patch.yml` carries no config.
`publishProjectContextSettings` runs *after* `resolvePluginConfig` (`src/project-context/index.ts:61-62`), so
an owner throw means the shared `live` publication is never made and `effectivePluginConfig(entry)` falls
back to each sibling's own `DEFAULT_CONFIG` (`src/shared/settings.ts:110-112`). The loader isolates the
failure: `cordis-plugin-loader/lib/index.js:88`
`if (newMap[id]) await this.create(newMap[id]).catch((error) => { this.logger.error(error) })` — one entry's
throw does not stop its siblings.

Consequence on the concrete deploy step: restart the host before editing both profiles and
`project-context` fails visibly but handoff/autolearn/memory keep running with `handoffBudgetRecentTokens: 20000`
and `handoffPendingQuestion: defer` — i.e. the user's deliberate `handoffKeepTokens: 0` / `wait` are
**silently ignored**, which is the exact "silent default" the ruling says can not happen. `src/shared/settings.ts`'s
live reader itself is guarded (swallows → falls back), confirmed by probe C.

**Classification:** behaviour regression on the stale-profile path + false claim in documentation.
**Severity:** medium (mitigated only by the fact that the profiles are edited in the same step by a user who
already knows; the docs currently assert the opposite). **Minimal fix:** correct the ruling/CHANGELOG/vocabulary
sentence to "the `project-context` entry throws at apply and disappears from the card; until the profiles are
edited the other three plugins run with `DEFAULT_CONFIG` (`handoffBudgetRecentTokens: 20000`,
`handoffPendingQuestion: defer`)". No minimal code fix exists inside this repo (the siblings cannot see the
owner entry's raw config); an optional hardening would be for each sibling to log when the shared publication
is absent.

### F3 — `memoryEnabled`'s consumer has no negative test; a wrong-key read survives all 346

**Claim.** The new test file implies each renamed key's real path is exercised; the batch brief's H5/H6 pin
readers. The suite has an explicit `archiveEnabled: false` negative and an `autolearnEnabled: false` negative,
but no `memoryEnabled: false` negative.

**Probe.**
```
$ grep -rn "memoryEnabled" test/ | grep -v config-vocabulary
test/card-render.test.mjs:173:	memoryEnabled: true,
test/logic.test.mjs:2378:	assert.equal(parsed.memoryEnabled, DEFAULT_CONFIG.memoryEnabled);
$ sed -n '770,812p' test/autolearn.test.mjs   # the autolearn switch negative exists and has a positive control
$ grep -n '"agent/status"' test/*.mjs
test/autolearn.test.mjs:798,806   (autolearn switch off/on)
test/top-level-gate.test.mjs:224,231  (memory/autolearn positive path, default config only)
```
`top-level-gate.test.mjs` proves the memory auto path *runs* with defaults, so an **inverted** check is caught;
but a wrong-key read is not: replacing `if (!current.memoryEnabled) return;` with
`if (!current.autolearnEnabled) return;` (`autolearnEnabled` defaults to `true`, nothing in the memory tests
sets it false) passes the whole suite while the memory pass silently ignores its own switch.

**Classification:** test gap. **Severity:** low–medium. **Minimal fix:** add a `memoryEnabled: false` negative
mirroring `autolearn.test.mjs:773` (or an `overrides` case in `top-level-gate.test.mjs`'s memory section, like
the `archiveEnabled: false` test).

### F4 — Card union `options` and row `kind` are never compared with the schema

**Claim.** `test/settings-form.test.mjs` pins card keys ↔ schema keys; the new test's source scan covers `src/`
and `client/`. Nothing pins a union row's *values*.

**Probe.**
```
$ grep -n "row.options" test/settings-form.test.mjs
  assert.ok(Array.isArray(row.options) && row.options.length > 0, `${row.key} is a union without options`);
$ sed -n '197,202p' test/card-render.test.mjs
const PILL_TOTAL = UNION_ROWS.reduce((sum, row) => sum + (row.options?.length ?? 0), 0);
const CLEAN_BUTTONS = BOOLEAN_ROWS.length + PILL_TOTAL + 1;
$ node /tmp/h-review/probe4.mjs   (section 2)
  card handoffThinking options=["off", "session"]
  card handoffPendingQuestion options=["defer", "wait"]
  card handoffLang options=["auto", "zh", "en"]
```
`card-render.test.mjs` derives its expected pill/button counts *from the same table*, so shrinking
`handoffLang`'s options to `["auto","zh"]`, or swapping a row's `kind` between `number` and `text`, keeps every
assertion green (the platform schema would still refuse the missing option, so the user just loses a control).
**Classification:** test gap (pre-existing; the batch touched these lines only for the key rename).
**Severity:** low. **Minimal fix:** assert each union row's `options` equals the schema's union members (the
schema is available in the same test file).

### F5 — The new "profiles' persisted shapes" test does not test the persisted shapes, and its comment says the opposite of its code

**Claim.** `test/config-vocabulary.test.mjs:46-50,141` — "both profiles' persisted shapes resolve" / "The values
the two profiles persist, keyed by the retired spelling so the shape cannot drift", passed to all four
`apply()`s.

**Probe.** The object literal uses the **new** spellings, the profiles persist the **old** ones, and the real
shapes throw (F2 probe A). The test also hands the `project-context` entry's config to `project-memory`,
`project-autolearn` and `project-handoff`, which the profiles never do.
```
$ sed -n '46,58p' test/config-vocabulary.test.mjs
const PROFILE_SHAPES = {
	desktop: { maxMemoryChars: 40_000, handoffThresholdAuto: true, handoffBudgetRecentTokens: 0, handoffPendingQuestion: "wait" },
```
**Classification:** test gap / misleading test name and comment. **Severity:** low. **Minimal fix:** rename to
"the post-rename shape both profiles must adopt", fix the comment, and (optionally) assert that the current
on-disk shape throws, making the required profile edit part of the test.

### F6 — "every key the handoff verbs write back is a schema key" compares against `DEFAULT_CONFIG`, not the schema

**Probe.**
```
$ sed -n '160,188p' test/config-vocabulary.test.mjs
	assert.ok(Object.keys(DEFAULT_CONFIG).includes(key), `${key} is written back but is not a schema key`);
$ node /tmp/h-review/probe1.mjs   (section 9)
  DEFAULT_CONFIG keys = schema keys: true
```
The two sets are identical today (probe), and `settings-form.test.mjs` independently pins card keys ↔ schema
keys, so there is no live hole. **Classification:** cosmetic / test naming. **Severity:** cosmetic.
**Minimal fix:** compare against `Object.keys(PluginSettingsSchema({}))`.

---

## Items attacked that turned out clean (probe-backed)

1. **Every key is wired to a real consumer.** `git grep` shows readers for all seven
   (`memoryEnabled`→`src/project-memory/index.ts:413,420`; `autolearnEnabled`→`src/project-autolearn/index.ts:64,71`;
   `handoffBudgetSummaryTokens`→`threshold.ts:346` + `command.ts:143`; `handoffBudgetRecentTokens`→`auto.ts:64`,
   `perform.ts:89`, `threshold.ts:58,135,173,248`; `handoffThinking`→`summary.ts:22`; `handoffThresholdAuto`→
   `threshold.ts:88,321`; `handoffLang`→`conversation.ts:154`). End-to-end probe (probe1 §§1,3–7, probe6):
   `handoffThresholdAuto` switches `resolveThreshold` fixed/adaptive (157000 vs 500000), `handoffBudgetRecentTokens`
   moves the floor and can refuse (`149001` → `undefined`), `handoffBudgetSummaryTokens` produces the
   override receipt (`200000` → `handoff budget summary 200000 is not applied in full …`) while provably not
   lifting the trigger (157000 at 8k/64k/200k), `handoffThinking` flips `resolveSummaryEffort`, `handoffLang`
   forces/loses the language (`zh`/`en` both directions, `auto` detects CJK correctly once `sourceKind` is set).
2. **Exactly four unguarded `resolvePluginConfig` callers.** `git grep -n resolvePluginConfig -- src/ client/`
   → the four `apply()`s plus `src/shared/settings.ts:95` (inside `try/catch`).
3. **Bounds agree between `settings.ts` and `config.ts`** at every boundary, for the renamed fields and the
   untouched ones (probe4 §1: 7999/8000/200000/200001, −1/0/200000/200001, 0.09/0.1/0.95/0.96,
   3999/4000/200000/200001, 0/1 turns, 999/1000 ms — `schema=REJECT/ok` == `reader=REJECT/ok` in all 20 cases).
4. **Profiles' values survive the rename target shape**: `maxMemoryChars 40000`, `handoffBudgetRecentTokens 0`,
   `handoffThresholdAuto true` (desktop), `handoffPendingQuestion wait` all resolve to the same values.
5. **The stale-profile throw is real** (not swallowed by schemastery before `apply`): `PluginSettingsSchema(oldShape)`
   **preserves** unknown keys (`handoffKeepTokens` and even `bogusKey` survive), so `fiber.config` really does
   deliver the old key to `resolvePluginConfig` (probe-schema.mjs).
6. **D4 wording integrity.** `memoryUpdateReply` across all reachable `(status, memoryWritten, contextWritten)`
   combinations (probe3) never claims an artifact that did not land: `updated`/`clipped` derive the target from
   the landed flags and are unreachable with `wrote === false` (`src/project-memory/index.ts:348`);
   `stale` ⇔ `memoryKeptStale && !wroteContext` and `stale-context` ⇔ `… && wroteContext` (line 334) so the
   "context updated" claim is guarded; `failed` names what landed; `lossy-refused` adds the context sentence only
   when `contextWritten`. All replies carry the `Memory: ` prefix and none reads `Memory: memory …`. Leaving
   `Consolidation ran but produced no new memory or context.` unconverged is **defensible, not a defect**: pi
   keeps the identical unprefixed literal at `ca71fd3` (`extensions/project-context/memory/report.ts:496`).
7. **`/context`'s multi-line report is the only remaining `Project context:`** (`src/project-context/index.ts:129`)
   and that is exactly the adopted second exemption. No other user-visible memory string was missed.
8. **The new source scan cannot false-negative on scope:** it walks `src/` and `client/` recursively and sees all
   67 `.ts`/`.tsx` files (66 + 1 `.tsx`; no other source extension exists), 0 old-name hits (probe7).
9. **Locale faces cannot be half-renamed:** `labelKey`/`hintKey` return `SettingsCardKey` from
   `keyof ProjectContextSettings` (`client/card-fields.ts:115,126`), so a stale `field.*` key fails `tsc` —
   hence the batch's discarded "invalid mutant" is correctly classified as invalid.

---

## `pi` reference coverage (item 5)

Read: `git -C pi-project-context show 2177386` and `git show ca71fd3:.codestable/reference/vocabulary-conventions.md`.

- The rename table and its rationale match, **except** that pi's §2.2 key rule ("a key mirrors the command path
  that changes it") is satisfied by only six of the seven keys here: dsh has no command that changes
  `memoryEnabled` (F1). pi also has a one-time migration; the (b) ruling is explicitly a dsh deviation and is
  recorded as such.
- pi's §2.3 prefix terminal state covers all four layers (`Memory:`, `Session log:`, `Handoff:`, `Autolearn:`).
  dsh converged only `Memory:` in this batch. `Handoff …` (`Handoff refused:`, `Handoff session created:` …) and
  `Session log written:` already conform; `autolearn` still leads with the object (`Skill created:` …). The new
  `docs/vocabulary-conventions.md` records that as an open item — consistent with the user's D4 scope, not a
  defect, but it is the one layer pi converged that dsh deliberately did not.
- pi's two exemptions are honoured, with the second re-expressed for dsh (`/context`'s path report) in the new
  vocabulary file — correct there, wrong in the CHANGELOG (F1).
- pi's §2.2 also insists the rename be done in one round across code + prompts + `docs/` + `CHANGELOG` + MEMORY.
  The `docs/`+`CHANGELOG`+`README`+`MEMORY.md` half was landing concurrently with this review; `.agents/memory/MEMORY.md`
  ended the review with **0** old-name references.

---

## Item 6 — every remaining repo reference to the seven old names, by file:line

Search: `grep -rnE '<seven old names>' .` excluding `node_modules/`, `lib/`, `.git/`,
`.agents/memory/session-logs/`. Classification per `docs/vocabulary-conventions.md` §6 (current face must be
renamed; released sections / briefs / rename tables / triage records are historical face and are not rewritten).

**Intentional / exempt (report as exempt, not as findings):**
- `test/config-vocabulary.test.mjs` — lines 37–43 (the rename table), 123–136 (`assert.throws` list), 128–129,
  152–153 (real-profile positive control). **Exempt by instruction.**
- `docs/batch-h-vocabulary-keys-brief.md` — **exempt by instruction** (whole file; it is the pre-ruling brief).
- `docs/batch-h-vocabulary-keys-ruling.md` — 17, 21–27 (rename table), 113 (mutation record), 127, 130
  (describes the profiles' *pre-edit* keys, which is the deployment task). Historical/decision record.
- `docs/vocabulary-conventions.md` — 127–133 (the §5 K terminal rename table). Intentional.
- `docs/batch-e-command-surface-ruling.md` — 22, 23, 24, 25, 38, 39, 42, 43, 60, 61, 104 (11 lines / 14 matches):
  batch E's ruling names the then-current keys. Historical.
- `docs/upstream-pi-triage.md` — 38, 47, 64, 603, 604, 612, 613, 638: triage record of the pre-rename state. Historical.
- `CHANGELOG.md` — 26, 38, 220, 707, 708, 744, 864, 865, 1079, 1084, 1197: **released sections** (all above the
  new `未发布` block). Historical. The new `未发布` block's old→new pairs (75–79) are a rename table.
- `.agents/evidence/2026-10-05-config-vocabulary/README.md` (3) and `mutate.sh` (2): the batch's own mutation evidence.

**Current-face references — none remain.** `src/`, `client/`, all other `test/`, `README.md`, `scripts/`,
`package.json`, `.agents/skills/`, and `.agents/memory/MEMORY.md` are clean:
```
$ git grep -nE '<seven>' -- src/ client/          -> (exit 1, 0 lines)
$ grep -rnE '<seven>' scripts/ package.json .agents/skills/  -> (0 lines)
$ grep -nE '<seven>' .agents/memory/MEMORY.md     -> (0 lines)   # after the concurrent writer finished
$ grep -nE '<seven>' README.md                    -> (0 lines)
```

**Local-only (untracked/gitignored, not part of the docs commit):**
`.agents/memory/memory.jsonl` (5), `.agents/memory/memory-log-2026-09-26T13-01-12-657Z-d833bb69.jsonl` (22),
`.agents/memory/memory-log-2026-10-04T15-26-07-666Z-48b6d72f.jsonl` (16), and five
`.agents/memory/MEMORY.md.memory-backup-*` files (2 each). Journals/backups, historical.

Note the only **current-face falsehood** in this set is `CHANGELOG.md:75`'s `/memory on|off` (F1) — the old
*key names* on 75–79 are legitimate rename-table content.

---

## Test integrity (item 7)

- **Vacuous assertions:** none found. The value-passthrough, unknown-key-throws, write-back-key, source-scan and
  apply-throws tests all fail under the mutants the parent already ran (compat term, old-key write-back, prefix
  revert), and I reproduced the mechanisms independently (probe1, probe2, probe7).
- **One plausible wrong implementation that still passes all 346:** `src/project-memory/index.ts:413,420` reading a
  sibling switch (`current.autolearnEnabled`) instead of `current.memoryEnabled` — F3. (The symmetric autolearn
  mistake is caught by `autolearn.test.mjs:773`.)
- **A second, weaker one:** a card union row's `options` set or a `number`↔`text` `kind` swap — F4.
- **Source scan false negatives:** it is scoped to `src/` + `client/` and to `.ts`/`.tsx`; it reads the source
  tree (correct — `lib/` is generated). It cannot see `test/`, `scripts/`, `docs/`, which is why item 6 matters.
  No file in `src/`/`client/` uses another source extension. It has no false-negative on the current tree
  (probe7: 67 files, 0 hits).
- **Assertion-from-the-same-table:** `card-render.test.mjs`'s `PILL_TOTAL`/`CLEAN_BUTTONS` derive from `ROWS`, so
  it pins rendering consistency, not the option sets (F4).

---

## What I could NOT verify (and why)

1. **The live host's actual behaviour on a stale profile.** The desktop restart script and `/memory update` are
   user-only and refuse to run from inside a dsh session; I did not restart anything and did not touch `~/.dsh`.
   F2 is therefore proven at module level (probe2) plus the loader's own `create(...).catch(...)` isolation
   (`cordis-plugin-loader/lib/index.js:88`), **not** observed on a running host. The live-reload case (as opposed
   to cold boot) is the one place the conclusion could soften: if cordis keeps the previous fiber on a failed
   update, the old `live` publication may linger and the siblings may keep the user's old values.
2. **Whether the docs half is final.** The working tree changed under me (docs/CHANGELOG/README/MEMORY.md were
   written at 11:23–11:26, after my first `git status`). My findings on `CHANGELOG.md`, `README.md`,
   `.agents/memory/MEMORY.md`, `docs/vocabulary-conventions.md` and `docs/batch-h-vocabulary-keys-ruling.md`
   describe the content at ~11:26 (`git diff | sha256sum = b8d1308…`); F1/F2 wording may already have been
   revised by the time this report is read. All `src/`, `client/`, `test/` conclusions are pinned to the frozen
   source hash `3e1f7fe7…`.
3. **The batch's own mutation evidence.** `.agents/evidence/2026-10-05-config-vocabulary/mutate.sh` and the
   CHANGELOG's mutation paragraph are the parent's record; I verified 0 `MUTANT` markers in `lib/` and the current
   gates, but I did not re-run the mutants (I must not modify the repo).
4. **The profiles' post-edit end state** (I am read-only and the files are user-owned; I read them only).
5. **`resolveHandoffLanguage`'s newest-continuation-prompt branch** and the two files' other languages — covered
   by existing tests, not re-probed here.
