# pi → dsh port triage

**First pass closed, second ported nothing, third found portable work.** This file started as a
read-only triage of the eight pi commits `dsh` had not taken (written at dsh `a6510a3`, pi
`origin/HEAD`). It is kept as the record of **what was taken, what was refused, and why** — not as a
plan: the first pass's plan is executed, and one of its recommendations was later overturned (see
"Superseded").

**Second pass, 2026-10-03**: pi's `master` advanced past the first triage; the 22 commits in
`3ee5794..8b300dc` were triaged separately and **ported nothing**. See "Second pass" below for the
per-commit dispositions and the read-now checks behind them.

**Third pass, 2026-10-04**: pi's `master` advanced again, to `6707376`. The 78 commits in
`8b300dc..6707376` were classified, and this pass **does** find portable work — four batches, none
started. See "Third pass" at the end of this file. The second pass's "ported nothing" stays true of
*its own* range only; it is not a statement about pi today.

The durable per-change record lives in [`CHANGELOG.md`](../CHANGELOG.md); this file only maps the
upstream commits to what dsh did with them.

## Outcome

| pi commit | subject | what dsh did |
|---|---|---|
| `3ee5794` | anchor auto on the conservative knee curve | **PORTED, twice corrected** — `8557fb1` (knee as a cap: wrong) → `011a68e` (revert) → `a7b1c1d` (fallback chain) → `1824d17` (two-term trigger + override receipt). See "Superseded" |
| `0af9ec6` | reserve reasoning budget, honor finish reasons | **PORTED (2a)** in `f2acbae`; **2b already-fixed in dsh** (dsh's stream call already throws on a failed/aborted `finish`), so pi's provider-error-swallow defect had no dsh analogue |
| `27f7043` | harden memory and handoff recovery | **PORTED** — memory cap `fdc5722` + `3da2517` (cap state in `/memory status`); the handoff half was already-fixed |
| `d4cdad3` | four residuals + stale contexts | **SPLIT**: (1) ported (`92402f9`), (5) ported (`0d3574e`); (2) oversized session-header read and (3) staged-marker TTL and (4) status lines have **no dsh counterpart** — dsh's equivalents never existed |
| `09ea0c7` | stop repeating the gitignore header | **PORTED** (`92402f9`); dsh also took the case-insensitive refinement from `d4cdad3`(1) |
| `8a2e6e4` | carry session settings, flatten the tree | **ALREADY-FIXED (settings)** — dsh already carried model/thinking across `newSession`; **NOT-APPLICABLE (tree)** — dsh has no session-selector parent chain |
| `af93fab` | version the memory renders and skills | **NOT-APPLICABLE** — repo hygiene for pi's own tree |
| `093dbf3` | mid-turn cut | **NOT-APPLICABLE**, decided before this triage and not re-litigated |

## Superseded

The original P1 recommendation was to add the knee as a **floor** under the configured target —
`tokens = min(max(min(usable − margin, knee), floor), usable − margin)`, with
`handoffTargetTokens` as a physical floor that could raise the trigger. **That is retracted.** The
landed shape is the **two-term** rule:

```text
quality  = autoCompactTokenLimit ?? knee(window)     # fallback chain, not a sum, not a cap
capacity = usable - SAFETY_MARGIN_TOKENS
tokens   = min(quality, capacity)
```

`handoffTargetTokens` appears **nowhere** on that line: a local preference must not lift the trigger
above the honest knee, which is the entire purpose of the curve. What it asks for is reported
instead — the physical floor is a **refusal gate, not a lift** (`1824d17`), and dsh names the knee
as its own refusal cause (`768c693`). The retracted reading had the sign flipped in both
directions: as a cap it made an absent upstream field mean the curve did nothing, and as a floor it
reopened the hole the curve exists to close. Current code:
[`src/project-handoff/threshold.ts`](../src/project-handoff/threshold.ts).

## Traps worth keeping

- **Finish-reason spelling differs**: dsh reports `max-tokens`, pi reports `length`. Copying pi's
  string silently disables the retry path (mutant-verified: three tests red). The P2 port had to
  translate, not transcribe.
- **A new config key is six edits**: host field, settings schema, card spec, projection, rendered
  row, and two locales. `settings-form.test.mjs` scans every schema key, so skipping the `client/`
  edits fails the suite rather than passing quietly.
- **The config-key question is separate from the arithmetic**: the same P1 work raised whether
  `handoffTargetTokens` should keep its adaptive meaning at all; that was settled only after the
  formula (`1824d17`), and the two must not be conflated again.

## Second pass — 2026-10-03 (22 commits after the first triage)

The first pass ended at the newest pi commit it had to consider, `3ee5794`. pi's `master` has since
reached `8b300dc` — two commits past the `v0.1.11` tag, which peels to `ed2704c`
(`git -C /mnt/Data/Projects/pi-project-context rev-parse v0.1.11^{commit}`). This pass classified the
**22 commits in `3ee5794..8b300dc`** and
**ported nothing to `src/`**: every behavioural fix among them either already exists in dsh under
another name, or repairs a mechanism that is pi-only. The range and the revisions are re-readable —
`git -C /mnt/Data/Projects/pi-project-context log --oneline 3ee5794..HEAD` — and pi's tree had no
commits outside `master` at the time of this pass (`git log --all --oneline --not master` was empty).
The commit hashes below are fixed objects; a `HEAD` pointer would not be.

| pi commit | subject | disposition |
|---|---|---|
| `33e8d9e` | close the R3 loss-surface findings, converging on dsh's shape | Three of its four findings are **ALREADY IN DSH** (checks below): the migration conflict + `superseded` result, the copy-not-rename rotation with `newestMemoryArchive` recovery, and the cross-process index lock — pi's message describes its own side of that work as porting "dsh's already-correct implementation". The fourth, the handoff config mirror (`saveConfig` / `syncConfig`), is **NOT-APPLICABLE**: dsh persists settings as a patch through the host service (`settings.update` in `src/project-handoff/command.ts`) and keeps no per-process config snapshot to revert |
| `1aff2aa` | close the remaining R3 loss-surface findings (pi side) | **ALREADY IN DSH** for the journal flush (`handle.sync()`), the injective `safeSessionId` (8-hex digest of the original id) and the index cap that carries its dropped count forward. **NOT-APPLICABLE** for the foreign staged-settings marker: dsh carries the parent's model via `parentModelSelection` over `session.requestHeader()`, with no marker file, so a foreign stage cannot exist |
| `918c0bb` | re-apply the candidate shape rules on `/autolearn approve` | **ALREADY IN DSH** — one exported `shapeRejection` is consulted by the pass and by the approve path (against the *untruncated* description) |
| `54e0364` | keep the manual target off the trigger line | **ALREADY IN DSH** — dsh landed the two-term trigger and the override receipt; pi's message says this is "the shape dsh landed" |
| `6e620a5` | name the threshold refusal instead of blaming the window | **ALREADY IN DSH, and further along** — dsh names four causes (`window-headroom` / `quality-knee` / `summarizer-floor` / `no-positive-threshold`) through `thresholdRefusal` / `thresholdRefusalText`; pi names fewer |
| `ed2704c` | drop the unused whole-snapshot writer | **NOT-APPLICABLE** — the `saveConfig(projectRoot, config)` primitive dsh would have had to delete never existed here, so the bug it invites is absent rather than removed |
| `9d09c6f` | pin the archive mtime in the recovery test | **NOT-APPLICABLE** — dsh's recovery fixture writes exactly one archive, so its "newest" has no tie to break |
| `b5d825d`, `7c5d396`, `18af40b`, `53607c6`, `4b02cfe`, `5d983ae` | split the extension into per-capability subpackages, then one module per responsibility; split the handoff settings | **NOT-APPLICABLE** — pi's own tree refactor; dsh's `src/project-<capability>/` + `src/shared/` already has that shape. `7c5d396`'s config-mirror merge is the pi-only mechanism noted above |
| `7f2ebe9` | document the conservative knee threshold and its caps | **NOT-APPLICABLE** — pi's `docs/`; dsh documents its own threshold in `src/project-handoff/threshold.ts` |
| `a057818` | describe the split module layout | **NOT-APPLICABLE** — pi's `docs/architecture.md` |
| `01913f1` | consolidate the project skill set | **NOT-APPLICABLE** — pi's own skills |
| `d79fab5`, `25b41d6` | refresh the memory render | **NOT-APPLICABLE** — pi's rendered memory artifacts |
| `7f3579d`, `cc6f6df`, `009e12d` | codestable release / issue records | **NOT-APPLICABLE** — pi's own process records |
| `8b300dc` | name the removed whole-snapshot writer in a test comment | **NOT-APPLICABLE** — pi test comment about the writer dsh never had |

**Read-now checks behind the "already in dsh" rows.** Each is one command against this repo, so the
claim is falsifiable without trusting this table:

```text
grep -n 'superseded\|conflicts'      src/shared/migrate.ts            # migration refuses to eat a divergent dir
grep -n 'Copy, do not rename'        src/project-memory/journal.ts    # rotation keeps the journal valid at every instant
grep -n 'newestMemoryArchive'        src/project-memory/journal.ts    # readers recover from the archive
grep -n 'handle.sync()'              src/project-memory/journal.ts    # the append is flushed
grep -n 'withMemoryLock'             src/project-context/session-index.ts  # cross-process index lock
grep -n 'older session'              src/project-context/session-index.ts  # the cap reports what it dropped
sed -n '109,118p'                    src/shared/paths.ts              # safeSessionId stays injective
grep -n 'shapeRejection'             src/project-autolearn/candidate.ts     # one predicate for pass + approve
grep -n 'ThresholdRefusal\|thresholdOverrideText'  src/project-handoff/threshold.ts
grep -rn 'handoff-session-settings'  src/                             # no staged-settings marker to defend
git grep -n 'saveConfig\|updateConfig\|syncConfig' -- src/              # no config mirror to revert
```

**Honest limits of this pass.**

- The classification came from reading the modules each pi fix touches, **not** from a full semantic
  diff of the two trees. A behaviour pi changed inside a module dsh implements differently could hide
  in that gap; the checks above bound the specific findings, not the whole surface.
- `/handoff <key>` sends a patch to the host settings service. Whether that service merges patches
  under a cross-process lock is dsh **core**, outside this repo — so the pi findings about a
  whole-snapshot cache and a per-process merge have no repo-side counterpart to fix here, and this
  pass does not claim the host is free of them.
- `R3` is overloaded: dsh's own R3 batch (the pressure-check throttle, the shared admission
  predicate) is a different audit from pi's loss-surface R3. The two must not be cross-cited.
- This pass changed no `src/` file, so it adds no `CHANGELOG.md` entry — the changelog records
  behaviour, and the map of what dsh did with upstream commits is this file's job.

## Third pass — 2026-10-04 (78 commits after the second pass)

The second pass stopped at `8b300dc`. pi's `master` has since reached `6707376`: **78 commits**, of
which **22 are behavioural** (3 `feat`, 14 `fix`, 3 `test`, 1 `refactor`, 1 `chore`) and 56 are
`docs`/process records. Unlike the second pass, this range **is not a no-op** — it carries four
portable batches. The range is re-readable —
`git -C /mnt/Data/Projects/pi-project-context log --oneline 8b300dc..6707376` — and the hashes below
are fixed objects, where a `HEAD` pointer would not be. This pass changed no `src/` file: it maps
the range and names the deltas; porting is a separate batch.

| pi commit | subject | disposition |
|---|---|---|
| `6e3b371` | give CONTEXT.md a fixed schema, per-section budgets and a truncation marker | **PORTABLE (A)** |
| `a3f8370` | fix the memory schema and pointerize entries | **PORTABLE (A)** |
| `7ed538f` | reserve the schema blank lines and pin section descriptions | **PORTABLE (A)** |
| `f81531f` | close the S1/S3 memory-schema review findings | **PORTABLE (A)** |
| `cfa4b6f`, `7fa5e3a` | pin the schema overhead / cap scaling; pin the pointer rule | port **with** A (test-only) |
| `a562d7e` | render consolidation output from structured sections | **PORTABLE (B, largest)** |
| `d02e869` | damp auxiliary-call alerts and cap-truncation loss | **SPLIT**: (a) **PORTABLE (C)**; (b) **NOT-APPLICABLE** |
| `024b3db` | state the enforced autolearn body bounds in the prompt | **PORTABLE (C)** |
| `00bf797` | keep an external edit that lands while a reply is being built | **PORTABLE (D)** |
| `dd2adcc` | refuse the clipped report line too | **PORTABLE (D)** |
| `1f0672c` | keep an over-cap reply locally before the cap clips it | **ALREADY IN DSH** — the journal keeps the raw, uncapped text and rotation archives it |
| `71922d8` | close the round-3 review findings | **PARTLY** — same conflation, opposite symptom (below) |
| `f34c4a9` | align the condensation prompt with the cap wording | **NOT-APPLICABLE** — dsh has no cap-driven condensation prompt |
| `2a38c5f`, `fd0cc9e` | empty-memory size and cap suggestion; share the cap wording | **NOT-APPLICABLE** — dsh's `/memory status` prints no size or percentage |
| `a665f5d` | close the independent-review findings | **NOT-APPLICABLE** — pi's `call-policy` internals |
| `1b01070` | keep the session archive cursor on the archive size | **NOT-APPLICABLE** (below) |
| `7f0e803`, `3ffdc26` | close the session-log review findings; harden and bound the check | **NOT-APPLICABLE** — pi's `session-log.ts` internals |
| `65b2699` | drive pi-ai's real strict resolver with the real tools | **NOT-APPLICABLE** unless B lands |
| 56 `docs(...)` commits | pi's own architecture notes, design-review rounds and release evidence | **NOT-APPLICABLE** |

### What is actually portable

**A — CONTEXT.md's fixed schema, per-section budgets and truncation marker.** dsh hardcodes the
three headings *inside* the render closure in `src/project-memory/context-doc.ts`, so the renderer
and the consolidation prompt are two independent copies of the same layout and can drift. It fits
the cap by shedding list items and then returns `document.slice(0, MAX_CONTEXT_CHARS)` — a bare
slice with **no marker**, so a clipped CONTEXT.md is indistinguishable from a complete one, which is
the exact failure mode `MEMORY.md` already guards against. pi drives the prompt and the renderer from
one `CONTEXT_SECTIONS` table, reserves the fixed layout plus the marker with
`contextSchemaOverheadChars()`, divides `cap − overhead` by per-section shares, and reads the marker
only from the document's **last non-empty line** so a model-authored lookalike inside a section is
never mistaken for a real clip.

```text
grep -n 'slice(0, MAX_CONTEXT_CHARS)' src/project-memory/context-doc.ts   # dsh's unmarked cut
grep -rn 'contextSectionBudgets\|isContextTruncated\|contextSchemaOverhead' src/   # = none
```

**B — structured sections through a tool.** dsh parses a JSON reply
(`parseConsolidation`, `src/shared/reply-json.ts`). pi fills per-section entries through a
strict-ready `record_memory` tool and renders the stored document from them, so the schema no longer
has to guarantee the character cap. This is the largest item (33 files, ~2180 insertions), carries
BREAKING command renames on pi's side, and needs its own batch and its own review.

**C — prompt bounds that are not the enforced bounds.** Both dsh prompts still state a *word* hint
where the code enforces *characters*:

```text
sed -n '61p' src/project-memory/consolidate.ts    # "Keep memory concise and below 6000 words"
sed -n '14p' src/project-autolearn/prompt.ts      # "Keep any skill body below 3000 words"
grep -n 'MAX_SKILL_BODY_CHARS\|MAX_SKILL_DESCRIPTION_CHARS' src/project-autolearn/skill.ts
```

`d02e869`'s message is why this is not cosmetic: a reply can satisfy the hint and still be cut at
`maxMemoryChars`, and whatever sat at the end is lost. pi replaced both with the enforced values
(character ranges, and the description cap the validator actually applies).

**D — a reply built from a memory that has since changed is published anyway.** dsh *adopts* an
external edit into the journal (`load.ts`), and then the pass writes the render it built from the
**pre-edit** read — so the edit is reverted, and "adopted" only ever meant "entered the history".
pi carries the text the prompt was built from as `basisKey`, refuses to publish when the stored
memory no longer matches, journals the newer bytes on both refusal paths, and reports
`keepReason: "stale"`; `dd2adcc` extends that refusal to the "shortened the existing memory" line so
no receipt claims a write that did not happen.

```text
grep -rn 'basisKey\|keepReason' src/        # = none
grep -n 'adopts those' src/project-memory/load.ts   # dsh adopts; nothing refuses
```

### Rows that need care

- **`1b01070` is not dsh's bug.** pi's cursor held a *source* byte offset captured before the read,
  so a writer appending in between made the next refresh re-append and duplicate entries. dsh's
  cursor is an **event count** plus a stamp of the artifact it wrote
  (`appendableAt` requires size **and** inode **and** mtime to match), and it appends serialized
  events, never a source byte range. `grep -rn 'readRange\|sourceSize' src/` = none.
- **`1f0672c` is already covered by a different mechanism.** dsh's journal stores each record's raw
  `text` *before* any cap, and `rotateMemoryJournalIfNeeded` folds with the limit only while
  archiving the full journal first ("copy, do not rename"). So the pre-clip bytes survive in the
  journal, and past rotation in `memory-log-*.jsonl`. Residual, not a defect to fix now: those
  archives are subject to reclamation, so the copy is best-effort rather than guaranteed.
- **`71922d8` is the same conflation with the opposite symptom.** pi's defect was that the
  fresh-reply marker strip was also applied to legacy imports, silently promoting a capped memory to
  "complete". dsh has one `normalizeMemoryDocument` that **preserves** the previous marker on both
  paths: right for the import path, but a fresh consolidation reply that now fits keeps a stale
  "truncated, N dropped" marker. Verify that symptom on a real capped project before porting the
  split.
- **The auxiliary-call policy half of `d02e869` and all of `a665f5d` have no dsh counterpart.**
  `grep -rn 'failedUntil\|backoff\|consecutive' src/project-autolearn/` = none, and autolearn has no
  notice site at all, so pi's six-toasts-in-a-row symptom has no dsh surface. Repeated failures per
  settle and one `errors.log` record per attempt were **not** measured here.

**Honest limits of the third pass.** The classification came from reading the pi diffs and the dsh
modules each one lands in, plus the checks above — not from a full semantic diff of the two trees, so
a behaviour pi changed inside a module dsh implements differently can still hide in that gap. Batch
B's size and the command renames were read from `a562d7e`'s message and file list, not from a
line-by-line reading of its 2180 insertions. Every "PORTABLE" row above is a claim that dsh lacks the
behaviour, backed by a check that returns nothing; no row claims the port is small.
