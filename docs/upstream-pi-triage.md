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
`8b300dc..6707376` were classified, and this pass **does** find portable work — four batches (A, B,
C, D), all four ported in the same round. See "Third pass" at the end of this file. The second
pass's "ported nothing" stays true of *its own* range only; it is not a statement about pi today.

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

**Ported 2026-10-04 (batch A).** `src/project-memory/context-schema.ts` now owns the section table,
the reserved-overhead budget maths and the last-non-empty-line marker reader; `context-doc.ts`
renders from that table, and the consolidation prompt builds its section list from the same one, so
the two cannot drift. Deliberate deviations: the two test-only pins `cfa4b6f`/`7fa5e3a` were **not**
ported — they pin pi's *memory* schema (`memory/schema.ts`, its Project/Invariants/Pitfalls/Index
table), and dsh's memory document is free-form, so those tests would have nothing to assert; the
surrogate guard `a665f5d` added to pi's `clipToLineBoundary` **was** ported, because the per-item and
title trims now run through it and a half pair cannot be re-encoded. Regression tests:
`test/context-schema.test.mjs` (15 cases, two mutants killed).

**B — structured sections through a tool.** dsh parses a JSON reply
(`parseConsolidation`, `src/shared/reply-json.ts`). pi fills per-section entries through a
strict-ready `record_memory` tool and renders the stored document from them, so the schema no longer
has to guarantee the character cap. This is the largest item (33 files, ~2180 insertions), carries
BREAKING command renames on pi's side, and needs its own batch and its own review.
**Brief for that batch: `docs/batch-b-port-brief.md`** (it records the verified tool-surface facts
and the three decisions the owner must take first).

**Ported 2026-10-04 (batch B).** The tool surface was verified live before any edit — one
plugin-sourced, sessionless `ctx.llm.stream()` carrying `tools` on the route this repo actually
runs (`deepseek-account` / `deepseek-flash`) delivered 10 `tool-call-delta` chunks, one assembled
`block-end` and a `tool-calls` finish; the transcript is
`.agents/evidence/2026-10-04-record-memory-tool-probe/`. Then, on top of `0650fe1` (the tool
plumbing slice, landed just before this batch), in five further scoped commits:

- `src/shared/model-call.ts` forwards `tools` (omitted — not an empty array — when a call offers
  none, so a toolless caller's request stays byte-identical) and collects the calls a reply carries,
  preferring the assembled `block-end` over the deltas. dsh streams a tool call's arguments as
  **text**, where pi-ai hands back a parsed object, so `pickToolCall` returns the raw argument string
  and `parseToolArguments` (`src/shared/reply-json.ts`) decodes it.
- The memory document gained a fixed four-section schema — `Project` 0.2 / `Invariants` 0.4 /
  `Pitfalls` 0.25 / `Index` 0.15 (`src/project-memory/memory-schema.ts`) — and a renderer
  (`src/project-memory/sections.ts`) that enforces each section's share by clipping an entry to its
  per-item cap and dropping whole entries, reporting the counts instead of writing a marker. The
  consolidation pass offers `record_memory`, prefers its call, renders the sections through the same
  renderer the Markdown fallback uses, and refuses a call cut off at the output cap (the adapter
  repairs a truncated arguments string into a shape-valid object, so "there is a tool call" is not
  evidence its contents arrived). The prompt states the sections and their budgets in characters,
  built per pass from the renderer's own table. Both entries are also gated before storage —
  `sectionsSemanticallyEmpty` for the structured one, `isHeadingOnlyDocument` for the opaque one — so
  a headings-only or body-less reply can never replace a stored memory with a skeleton.
- The autolearn pass (`record_skill`, `src/project-autolearn/schema.ts`) rides the same plumbing,
  with the same truncation refusal, one text-only retry, and a shared shaper behind both entries.
- **Command surface:** `/context-update` became `/memory update` and was removed outright, with no
  alias. pi could delete it because there it was only an alias of `/memory-learn`; here it was the
  sole forced entry point, so the verb had to exist before the old name could go.

**Deliberate deviations, recorded rather than silent:**

- The tool's backtrack field stays **`need_sessions`**. pi renamed it to `inspect` in the same change,
  but dsh's prompt, parser and tests already used `need_sessions`; the port is the tool, not the
  rename, and two names for one field would be worse than either.
- **No `constrainedSampling`.** dsh's `ToolSchema` is `{name, description, parameters}` — a plain
  declaration the adapter maps to the provider's `tools` — so there is no strict-mode marker to
  carry. The schemas are strict **by construction** instead (every property required,
  `additionalProperties: false`, no `anyOf`, no `maxLength`/`maxItems`), which is what pi's
  `makeStrictJsonSchema` would otherwise have had to normalize.
- **pi's sticky no-tools fallback (`callAux` + `call-policy`) — re-opened and implemented 2026-10-05.**
  A route that rejects the `tools` parameter fails the pass, backs off like any other failure, and
  logs; pi retries once without tools and keeps them off for the rest of the pass. It was closed here
  as "what is missing is an *observed* code", and that premise does not hold: a tools rejection is a
  provider 400, and both adapters this repo can run on map a rejected request body to the same code —
  `INVALID_REQUEST` (`llm-deepseek/src/transport.ts`, and `classifyPiAiError` in
  `llm-pi-ai/src/stream.ts`) — while pi keys on no such class at all: `toolsFallbackApplies` is
  **fail-open** over a message-text regex classifier that excludes only auth/quota/transient
  (`shared/call-policy.ts`). The prerequisite this entry recorded correctly is what got fixed:
  `requestPluginTextWithMeta` read `failure.code` and then threw it away into
  `plugin model call failed (<code>): <message>`, and dsh's own `HarnessError` contract says to route
  on the code, never by parsing the message. Now the code rides on the thrown error and
  `callWithToolsFallback` spends exactly one tools-free retry on the request-shape codes
  (`INVALID_REQUEST`, plus the generic `HTTP_400` / `HTTP_413` fallbacks); both passes call through it,
  each with the pass's own switch. **pi's sticky switch is ported too** (`toolsAttempted` /
  `toolsDisabled`, marked before the call): the first version here argued each pass issues exactly one
  tools-carrying call, and that premise is false — autolearn asks a second time when the first decision
  wants archives read first (`ask(backtrackPrompt(...))`), so a route that just refused `tools` would
  have been offered them again. The one remaining deviation is the trigger: a positive request-shape
  code set instead of pi's message-regex fail-open default, and — as a consequence — dsh falls back
  for the finish-carried failure that pi deliberately excludes (pi's `AuxCallError`), because in dsh
  every adapter throw is normalized into that same in-band finish, so the code has to decide rather
  than the delivery path.
  `docs/batch-b-residual-decisions.md` §2 owns the decision.
- **pi's condensation retry (`needsCondense` → a second model call to curate the shrink) IS
  implemented, as tier C.** `docs/batch-c-tier-c-design.md` owns the contract: a reply that would
  lose whole entries (`memoryLoss`'s `retryWorthy`) gets exactly one targeted retry on the same
  `usedInput`, carrying `memoryLossRetryRule` — pi's own instruction ("merge duplicates within a
  section and dropping the least durable entries") in dsh's words. The trigger is a superset of
  pi's `render.sectionDropped > 0` (it adds `droppedItems`, the opaque reply's `writeCapDroppedChars`,
  and `itemTruncated`, which retries but never refuses). The one deliberate difference is the
  failure policy: pi adopts the condensed reply when it is clean and otherwise **keeps the first,
  lossy result** and lets the cap report speak, where dsh **refuses the write** — `MEMORY.md` stays
  byte-identical and the status is `lossy-refused`. Silent degradation was acceptable, a wrong cause
  was not. (Recorded here as *not ported* until 2026-10-05, when closing the batch-B residuals showed
  the claim had been overtaken by tier C.)
- **The free-form/legacy path is unchanged.** A memory that is not a plain four-section bullet
  document still loads and renders verbatim, and `normalizeMemoryDocument` still owns the
  whole-document marker for the entries that do not have sections.
- **This repo's own `MEMORY.md` has migrated to the four-section format.** It was recorded here as
  pending because the migration had to run against the *live* new code — a host started before the
  schema landed writes the free-form document and reverts it. That precondition is now met, and
  `sectionsFromMarkdown` reads the stored document as the four sections instead of `undefined`. Check
  it rather than trusting this line: compare the 19387 socket holder's `ps -o lstart=` against
  `git log -1 --format=%cI -- src/project-memory/memory-schema.ts`, then read the file through the
  plugin's own parser instead of grepping for a heading.
- **autolearn accepts a cut reply that parsed — inverted 2026-10-05
  (`docs/batch-b-residual-decisions.md` §3).** This entry used to say the pass retries before it reads
  on a `max-tokens` finish, unlike the memory pass. It did, for the reason recorded here: the autolearn
  **text** path is fail-soft, so `parseAutolearn` reads an unparseable reply as
  `{skill: null, need_sessions: []}` — the same decision a model that proposed nothing returns — and
  reading a cut reply first would report a truncated answer as "no skill was warranted". That was a
  missing **signal**, not a property of the contract: `parseJsonObject` already returns `undefined` for
  a reply that does not parse, and `parseAutolearn` dropped the distinction one call up.
  `parseAutolearnReply` now reports it, and the pass accepts a `max-tokens` reply whose object closed
  before the cut — every member was emitted whole, because a raw `JSON.parse` cannot accept a
  half-written value — while still re-asking for one that did not parse. Probe over every cut point of
  three reply shapes (`.agents/evidence/2026-10-05-autolearn-cut-parse-probe/`): a cut bare-JSON reply
  **never** parses, while every cut landing in the fence or the trailing prose (137 of 137) carries the
  **complete** body. The dangerous half stays the tool-call path — the adapter repairs a cut argument
  string — and that is unchanged.
- **The truncation guard keys on the finish reason, and that is all dsh has.** `toolCallIsTruncated`
  refuses a call when the finish reason is `max-tokens` **or empty** (a stream with no terminal
  event). It cannot detect a repaired call that arrives labelled `stop`; both shipped adapters label
  truncation `max-tokens`, so that residual is latent rather than live, and it is the same signal pi
  uses (`stopReason === "length"`).

**Fixed before release by the batch's own adversarial review** (its report is not committed; the
findings are): the two halves of the empty-reply gate were not equivalent — `sectionsSemanticallyEmpty`
calls an entry that is itself a heading "content" (it contains letters), while the very same rendered
bytes are what `isHeadingOnlyDocument` refuses, so a headings-only `record_memory` call could still
replace a stored memory with a skeleton, silently. The structured and fallback-sections entries now
judge the **rendered document** too (`replyIsSemanticallyEmpty`). The same review extended the
truncation guard to the empty finish reason and made the retry fire for it, corrected the false
"receipts word their notices per entry" comment on `ConsolidationOutcome.kind`, and replaced a
vacuous prompt assertion with one that can fail. Each of the three fixes was mutation-checked
(remove the rendered-document half → the headings-only case red; stop refusing the empty finish →
the unsignalled-call case red; retry only on `max-tokens` → the same case red).

Regression tests: `test/sections.test.mjs` (the schema, the renderer's cap enforcement over random
caps, the extractor contract and both gates), plus the tool-path cases in `test/logic.test.mjs` and
`test/autolearn.test.mjs`. Each commit's own pins were mutation-checked (two to three mutants each,
all killed).

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

**Ported 2026-10-04 (batch C).** The consolidation cap is now built per pass by
`memoryBudgetRule(maxMemoryChars, currentChars)` — the cap is per project, so a fixed number in the
static rules would be a second source of truth — and the autolearn rules interpolate
`MAX_SKILL_BODY_CHARS` / `MAX_SKILL_DESCRIPTION_CHARS` (dsh has no `MIN_SKILL_BODY_CHARS`, so only the
upper bounds are stated). Regression tests: `test/prompt-bounds.test.mjs` (3 cases, two mutants
killed). **Considered and deliberately not changed:**
`src/project-handoff/summary.ts`'s "Keep it under 900 words" — the handoff document has no enforced
character bound at all, so that line is style guidance rather than a contradicted bound. The pi
reference does not cover it either.

**D — a reply built from a memory that has since changed is published anyway.** dsh *adopts* an
external edit into the journal (`load.ts`), and then the pass writes the render it built from the
**pre-edit** read — so the edit is reverted, and "adopted" only ever meant "entered the history".
pi carries the text the prompt was built from as `basisKey`, refuses to publish when the stored
memory no longer matches, journals the newer bytes on both refusal paths, and reports
`keepReason: "stale"`; `dd2adcc` extends that refusal to the "shortened the existing memory" line so
no receipt claims a write that did not happen.

```text
grep -rn 'basisKey\|keepReason' src/        # = none (before the port below)
grep -n 'adopts those' src/project-memory/load.ts   # dsh adopts; nothing refuses
```

**Ported 2026-10-04 (batch D).** `ConsolidationOutcome` carries `basisKey` (the memory the prompt was
built from); `recordMemoryDocument` refuses to publish a reply whose baseline no longer matches and
returns `{written:true} | {written:false, kept}`, with the pre-append window closed by the exported
`nextRenderSupersedes` predicate. Both refusal paths journal the newer bytes. The pass counts what
landed, not what it attempted (`wroteMemory` / `wroteContext`), and the receipt gained `stale` /
`stale-context` so no wording claims a memory write that did not happen. Deliberate deviations: dsh
has no `normalizeMemoryReply`/`preserveMarker` split (one `normalizeMemoryDocument` does both jobs),
so `preserveMarker` is not ported; `keepReason` becomes the two report values instead of a field, and
`dd2adcc`'s extra refusal of the "shortened the existing memory" line collapses into the single
`wrote && outcome.clipped` guard, which now fires only on a real write. Regression tests:
`test/external-edit.test.mjs` (4 cases, three mutants killed).

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

## Fourth pass — 2026-10-05 (56 commits after the third pass)

The third pass stopped at `6707376`. pi's `master` has since reached `f6bea1d` — **56 commits**, covering
pi's v0.2.2, v0.2.3, v0.3.0 and v0.3.1. `v0.3.1` peels to `12c6390`, which is *inside* the range three
commits below the tip, so the newest tag is not the newest commit: state which one you mean.

**Read the checkout honestly.** This checkout's working tree is still at `6707376`; `origin/master` is
`f6bea1d`. Every pi read behind this section is `git -C $P show f6bea1d:<path>` or `git grep <pattern>
f6bea1d -- <path>` — never the working tree, which is a revision behind and would answer with the
pre-change files.

Unlike the third pass, this range is mostly pi's own record-keeping: **6 commits touch code or tests, 50
touch only docs, skills, audits or evidence.** It is not a no-op, but its portable work is small:

| batch | what | pi reference | dsh target | ruling needed |
| --- | --- | --- | --- | --- |
| **D** | autolearn may supersede a skill the pipeline itself generated — **brief: `docs/batch-d-autolearn-supersede-brief.md`** | `2d562ce` + `extensions/project-context/autolearn/{skill,candidate,inventory,prompt,pass}.ts` at `f6bea1d`; design in `12c6390`, `6f533ef` | `src/project-autolearn/{skill,candidate,inventory,prompt,pass}.ts` | yes — it changes what a learned skill *is*, and our skills are tracked |
| **E** | one name per fact on the command surface: `/handoff` `threshold` (merges `auto` + bare ratio) and `budget summary\|recent` (replaces `target`/`keep`); bare `/session-log` read-only, `write` writes | `0399e04`; design in `13feb8a`, `23dc5b3`, `811ebec`, `463ee07` | `src/project-handoff/index.ts`, `src/project-context/index.ts` | yes — user-visible verb renames |
| **F** | the cross-project boundary as a prompt rule plus a caption inside `<recent-conversation>` | `4f26ddd` (`extensions/project-context/memory/prompt.ts`) | `src/project-memory/consolidate.ts` (`CONSOLIDATION_PROMPT_RULES`, the conversation block) | small; one caveat below |

The `0399e04` **legacy-config** half has no counterpart here and is not portable as written: pi had three
pre-unification file shapes read on the hot path (`docs/configuration` at `463ee07`), while our settings
live in the shared namespace's `PluginSettingsSchema` and `src/shared/config.ts` has no legacy term
(`git grep -in legacy -- src/shared/config.ts` → nothing). `src/shared/migrate.ts` migrates *directory
layouts* (a legacy `.omp`/`.pi` tree), not config shapes. The "a parameter lives with the layer that
owns what it changes" principle is already how our settings card is arranged.

Batch F's caveat is ours, not pi's: this repo deliberately keeps pointers to other projects in memory
(who owns the `/etc/nixos` delivery line, what the pi checkout is for), and pi's rule keeps exactly that
legal — "naming another project is fine only to record who owns an open item" — so the port must forbid
another repo's *state and measurements*, not the ownership pointers we already keep.

### The six commits that carry code or tests

| commit | subject | disposition |
| --- | --- | --- |
| `2d562ce` | feat(autolearn): let the pipeline supersede a skill it generated, and only one of those | **PORT-WORTHY** — batch D — provenance marker plus supersede/merge in `src/project-autolearn/{skill,candidate,inventory,prompt,pass}.ts` |
| `0399e04` | feat(commands,config)!: one command per layer, budget verbs, and a one-time legacy config migration | **PORT-WORTHY (parts)** — batch E — `/handoff` verb convergence and the bare `/session-log` read/write split; its legacy-config half is PI-ONLY (their file shapes, not our settings card) |
| `89cadee` | fix(commands): give each fact one name on the command surface | **PI-ONLY** — the umbrella command whose first line collided with `/context` does not exist here; `/context` is our only printer of the context-file path |
| `4f26ddd` | fix(memory): state the cross-project boundary as a rule and at the conversation block | **PORT-WORTHY** — batch F — one prompt rule plus one conversation-block caption in `src/project-memory/consolidate.ts` |
| `bc8c21e` | fix(memory): render the memory status from one shared formatter | **ALREADY IN DSH** — one owner already: `memoryStatusReply` (`src/project-memory/index.ts`), one definition and one call site, so there is no second entry point to drift |
| `e3585ce` | fix(tests): discover pi's managed self-install tree | **PI-ONLY** — pi's own test harness discovering pi's managed self-install tree |

### The 50 commits that touch only docs, skills, audits or evidence

They are pi's own process records; the default disposition is PI-ONLY and none of them needs a port. The
tags name the ones that are design input for a batch above, or evidence for the rule the batch lands.

| commit | subject | disposition |
| --- | --- | --- |
| `f6bea1d` | docs(memory): refresh the memory render for the autolearn supersede boundary | PI-ONLY (record) — design input for batch D |
| `6f533ef` | docs(fix-note,evidence): record why autolearn may now supersede its own skills and how it is scoped | PI-ONLY (record) — design input for batch D |
| `12c6390` | docs(architecture,configuration): describe how a learned skill is identified and superseded | PI-ONLY (record) — design input for batch D |
| `e118782` | docs(fix-note): correct the autolearn non-goal - the field facts exist, the decisions do not | PI-ONLY (record) — design input for batch D |
| `89bdded` | chore(skills): record the two release-slice rules this v0.3.0 cut had to learn | PI-ONLY (record) |
| `480e145` | docs(fix-note): record the command-surface convergence fix | PI-ONLY (record) — design input for batch E |
| `fb766ed` | docs(memory): refresh the memory render for the v0.3.0 surface | PI-ONLY (record) |
| `f962cd8` | docs(design): drop the draft labels the frozen revision still carried | PI-ONLY (record) |
| `392732f` | docs(evidence): freeze the command-surface design at v0.3.0 and record the release | PI-ONLY (record) — design input for batch E |
| `4f1e26b` | chore(skills): merge the retire/rename procedure into the surface audit and clean the prompt-rule skill | PI-ONLY (record) |
| `463ee07` | docs(configuration,handoff): write the v0.3.0 surface, the budget verbs and the flat-only read path | PI-ONLY (record) — design input for batch E |
| `fa2efec` | docs(design): fold in the five answers and assess the legacy config chains | PI-ONLY (record) — design input for batch E |
| `18798fd` | docs(design): keep the umbrella toggle as a bare batch and refuse a command-level master switch | PI-ONLY (record) — design input for batch E |
| `811ebec` | docs(design): one command per layer, shrink the handoff verbs, drop the umbrella toggle | PI-ONLY (record) — design input for batch E |
| `13feb8a` | docs(design): write the full layered command contract, the naming fix and the /context split | PI-ONLY (record) — design input for batch E |
| `23dc5b3` | docs(design): reassign the command surface by data-flow layer (revision 2) | PI-ONLY (record) — design input for batch E |
| `eb85b30` | docs(design): draft the command-surface convergence and the home for the path lookup | PI-ONLY (record) — design input for batch E |
| `cc0b489` | docs(evidence): record the v0.2.3 boundary fix and its release evidence | PI-ONLY (record) |
| `9feadab` | docs(configuration): correct the /context overlap and record the one-name rule | PI-ONLY (record) — design input for batch E |
| `df5dfb1` | docs(skills): tighten the boundary-guard pattern so it stops matching http codes | PI-ONLY (record) |
| `dce7ae2` | docs(skills): take the measurement literals out of the boundary guard and drop a rotted test count | PI-ONLY (record) |
| `e63aa9c` | docs(skills): review the autolearn-promoted status-renderer skill and de-duplicate its guard | PI-ONLY (record) |
| `0d086e4` | docs(evidence): v0.2.2 release evidence (tag, dual push, pin commit, installed HEAD) | PI-ONLY (record) |
| `663a177` | docs(memory): refresh the memory render and record the shared status formatter | PI-ONLY (record) |
| `e18f198` | docs(configuration): record how the six commands relate | PI-ONLY (record) — design input for batch E |
| `3ef875e` | docs(skills): fold the learned skill-inventory skill into curated-surface-hygiene | PI-ONLY (record) |
| `37a150b` | docs(evidence): record the memory-status dedup and its mutation check | PI-ONLY (record) — evidence for bc8c21e, already in dsh |
| `3488e39` | docs(audits): addendum 3 section 8 records why the tracked autolearn candidate is gone | PI-ONLY (record) — why pi's tracked autolearn candidate is gone |
| `045697b` | docs(memory): refresh the memory render and correct the post-consolidation counts | PI-ONLY (record) |
| `beedf32` | docs(skills): consolidate the skill set from 19 to 14 and clear the stale pointers | ALREADY IN DSH — one owner per restated rule and a staged corpus is `.agents/skills/dsh-skill-corpus-consolidation/SKILL.md` |
| `6d49e2c` | docs(memory): refresh the memory render and re-apply the external-state boundary again | PI-ONLY (record) — evidence the boundary leak recurs, feeds batch F |
| `ad78038` | docs(skills): point the skill bodies at the current module paths | PI-ONLY (record) |
| `7322e7c` | docs(skills): drop the last sibling value from the complexity-audit skill | PI-ONLY (record) |
| `ef14394` | docs(skills): finish the example de-identification in the divergence skill | PI-ONLY (record) |
| `015b025` | docs(skills): drop machine-bound paths and stale counts from the skill bodies | PI-ONLY (record) |
| `e2a18da` | docs: link the changelog from the top-level readme | ALREADY IN DSH — `README.md` points at `CHANGELOG.md`, which is the release skill's step 2 |
| `362c4de` | docs(memory): refresh the memory render and re-apply the external-state boundary | PI-ONLY (record) — evidence the boundary leak recurs, feeds batch F |
| `268a53f` | docs(memory): keep consumer-repo state in the audit, not in project memory | PI-ONLY (record) — evidence the boundary leak recurs, feeds batch F |
| `02a1a11` | docs: wrap long lines, add a CHANGELOG, and keep incidents out of the reference docs | PI-ONLY (record) |
| `0efd022` | docs(skills): shorten the routing descriptions | PI-ONLY (record) |
| `66cddc0` | docs: stop the documentation index from naming a stale current issue | PI-ONLY (record) |
| `7b245b3` | docs(memory): refresh the memory render | PI-ONLY (record) |
| `9d8c677` | docs: sweep the last stale lock-attribution sites and document render durability | ALREADY IN DSH — render durability is `.agents/skills/dsh-memory-doc-loss-repair/`'s headline rule; the lock half is pi-internal |
| `14ad27a` | docs(audits): hand the two sibling-repo follow-ups back to their own projects | PI-ONLY (record) — hands pi's two sibling-repo follow-ups back |
| `af1f9d3` | docs(memory): refresh the memory render | PI-ONLY (record) |
| `8697d94` | docs(memory): refresh the memory render | PI-ONLY (record) |
| `12ca850` | docs(audits): record a second field incident where pi's own re-render dropped merged content | PI-ONLY (record) |
| `8d6162a` | docs(memory): refresh the memory render | PI-ONLY (record) |
| `47598f8` | docs(skills): add the audit-claim-verification skill approved by the autolearn pass | ALREADY IN DSH — same scope as `.agents/skills/dsh-artifact-claim-verification/` |
| `9c5a548` | docs(audits): record the closing dispositions for the parked audit items | PI-ONLY (record) |

### Reproducible commands

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P log --oneline 6707376..f6bea1d | wc -l                                  # 56
git -C $P log --oneline 6707376..f6bea1d -- 'extensions/**' 'tests/**'            # the six above
git -C $P log --all --oneline --not master                                        # empty: the checkout is behind, not diverted
git -C $P show f6bea1d:extensions/project-context/autolearn/skill.ts              # batch D's marker
git -C $P show 4f26ddd -- extensions/project-context/memory/prompt.ts             # batch F's two lines
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -n 'existing.has(skill.name)' -- src/project-autolearn/candidate.ts # dsh refuses every existing name
git -C $D grep -rn 'another repository\|cross-project' -- src/project-memory/      # empty: batch F does not exist here
git -C $D grep -n 'name: "handoff"' -A 3 -- src/project-handoff/index.ts           # our verbs, incl. auto|ratio|target|keep
git -C $D grep -n 'name: "memory"\|memoryStatusReply' -- src/project-memory/index.ts  # one status owner already
```

### The honest boundary

This is a per-module read of what pi's commits touch and of the mechanism under its dsh name, not a
semantic diff of the two trees; anything outside this repo (dsh core, the delivery line in `/etc/nixos`)
is not owned here. pi's corpus and skills are pi-only by construction: its release-slice rules
(`89bdded`), its boundary-guard regex fixes (`df5dfb1`, `dce7ae2`) and its description budget (`0efd022`,
pi caps a description because it injects it into every session prompt; ours is
`MAX_SKILL_DESCRIPTION_CHARS = 1024`) describe pi's own surface. Two traps from the earlier passes stand:
pi's finish reason is `length` where dsh's is `max-tokens`, and pi's `R3` table is pi's design-review
audit, not this repo's R3 batch — do not cross-cite either.
