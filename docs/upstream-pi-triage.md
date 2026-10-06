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
- The memory document gained a fixed four-section schema — `Project` / `Invariants` / `Pitfalls` /
  `Index`, ported at pi's `0.2 / 0.4 / 0.25 / 0.15` shares (since rebalanced in this repo; read the
  current shares from `src/project-memory/memory-schema.ts`, and see `CHANGELOG.md` 未发布) — and a renderer
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
| **D** | autolearn may supersede a skill the pipeline itself generated — **implemented 2026-10-05: `docs/batch-d-autolearn-supersede-brief.md`** | `2d562ce` + `extensions/project-context/autolearn/{skill,candidate,inventory,prompt,pass}.ts` at `f6bea1d`; design in `12c6390`, `6f533ef` | `src/project-autolearn/{skill,candidate,inventory,prompt,pass}.ts` | yes — it changes what a learned skill *is*, and our skills are tracked |
| **E** | one name per fact on the command surface: `/handoff` `threshold` (merges `auto` + bare ratio) and `budget summary\|recent` (replaces `target`/`keep`); bare `/session-log` read-only, `write` writes — **implemented 2026-10-05: `docs/batch-e-command-surface-ruling.md`** | `0399e04`; design in `13feb8a`, `23dc5b3`, `811ebec`, `463ee07` | `src/project-handoff/{command,index,threshold,perform}.ts`, `src/project-context/index.ts` | yes — user-visible verb renames |
| **F** | the cross-project boundary as a prompt rule plus a caption inside `<recent-conversation>` — **implemented 2026-10-05** | `4f26ddd` (`extensions/project-context/memory/prompt.ts`) | `src/project-memory/consolidate.ts` (`CONSOLIDATION_PROMPT_RULES`, the conversation block) | small; one caveat below |

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
| `2d562ce` | feat(autolearn): let the pipeline supersede a skill it generated, and only one of those | **PORT-WORTHY** — batch D — provenance marker plus supersede/merge in `src/project-autolearn/{skill,candidate,inventory,prompt,pass}.ts` (**implemented 2026-10-05**, `84274e5`) |
| `0399e04` | feat(commands,config)!: one command per layer, budget verbs, and a one-time legacy config migration | **PORT-WORTHY (parts)** — batch E — `/handoff` verb convergence and the bare `/session-log` read/write split (**implemented 2026-10-05**, `4b7bfb8`); its legacy-config half is PI-ONLY (their file shapes, not our settings card) |
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

## Fifth pass — 2026-10-05 (22 commits after the fourth pass)

The fourth pass stopped at `f6bea1d`. pi's `master` has since reached `ca71fd3` — **22 commits**, covering pi's
v0.3.2 and v0.4.0. Both tags sit *inside* the range and both peel to a **docs** commit, one above the code commit
that carries the change: `v0.3.2` → `8b4550a` over `997447a`, `v0.4.0` → `f217e7d` over `2177386`. `v0.3.1` peels
to `12c6390`, which is below the range. State which revision and which tag you mean rather than pairing them.

**Read the checkout honestly.** This checkout's branch `master` is still at `6707376` while `origin/master` is
`ca71fd3` (`git rev-list --left-right --count master...origin/master` → `0 78`), so the tree is *behind*, not
diverted, and every pi read behind this section is `git show ca71fd3:<path>` or `git grep <pattern> ca71fd3 -- <path>`
— never the working tree, which answers with pre-change files.

Unlike the fourth pass, this range is not record-keeping: 3 commits touch code, tests or skills and 19 touch only
docs, audits or evidence, but the two code commits are the largest pi has sent since the third pass, and one of them
**names dsh in its own body**.

| batch | what | pi reference | dsh target | ruling needed |
| --- | --- | --- | --- | --- |
| **G** | autolearn *pulls* a learned skill's body on request instead of pushing every body it can fit — brief: `docs/batch-g-autolearn-pull-brief.md` (**landed 2026-10-05**, see its §8) | `997447a`; design `1367027`, `998a4ae`, `8bcba99`, `3859d3d`; evidence `9e87671`, `1029b44`, `23775db`, `0ca0d91`, `34fc32d` | `src/project-autolearn/{inventory,prompt,pass,schema,parse,candidate}.ts` | yes — it adds a third tool field, and dsh already spells pi's `inspect` as `need_sessions` |
| **H** | a key mirrors the command path that changes it; one notification prefix per layer — brief: `docs/batch-h-vocabulary-keys-brief.md` | `2177386` (code) + `b869be3` (the six strings v0.3.0 left behind); design `998a4ae`, `a11d1ef`, `851a14f`, `ebdba28`, `f217e7d` | `src/shared/{config,settings,setting-labels}.ts`, `src/project-handoff/{command,index}.ts`, `src/project-memory/index.ts`, `client/locales.ts` | yes — seven keys are user-visible and persisted *outside* this repo |
| **docs** | a project-owned vocabulary conventions file, so a rename cannot land half-done twice | `a11d1ef` → `.codestable/reference/vocabulary-conventions.md` | a `docs/` file; our nearest counterpart today is `docs/batch-e-command-surface-ruling.md` | small; port the rules, not pi's file |

`2177386`'s body states the obligation rather than implying it: "Six of these keys were shared with dsh, so the two
config surfaces now differ and dsh has to adopt the new spellings; that is recorded in the file header, the docs and
the changelog rather than left implicit."

### The three commits that carry code, tests or skills

| commit | subject | disposition |
| --- | --- | --- |
| `2177386` | feat(config)!: make config keys, notification prefixes and status renderers say the same fact the same way | **PORT-WORTHY** — batch H — but the mechanical half is *not* portable: pi's seam is `legacyConfigPatch` reading a project file, and dsh's settings are persisted by the platform outside the repo (see below) |
| `997447a` | feat(autolearn): make the pass pull a learned skill's body instead of pushing every body it can fit | **PORT-WORTHY — batch G — landed 2026-10-05** (the reading below is the pre-port state) — dsh had the identical defect shape. `learnedBodiesText` (`inventory.ts:73-84`) pushes whole bodies until `MAX_LEARNED_BODY_CHARS` (= `MAX_SKILL_BODY_CHARS` = `20000`) runs out and `continue`s a body that does not fit, while `inventoryText` still lists its name; the gate `rejectionReason` (`candidate.ts:53-68`) reads only `collision.autolearn`. "Not shown" and "may not be superseded" are therefore **two** rules here, and only the prompt states the second (`prompt.ts:16`: "Never reuse the name of a learned skill whose body is not shown"). pi's fix computes the shown set once and reads it from both guards. `git grep -cn 'shown' -- src/project-autolearn/candidate.ts` → 0 is the whole gap |
| `b869be3` | docs(handoff): finish the vocabulary v0.3.0 left behind in the handoff notifications | **ALREADY IN DSH (command names), divergent wording** — none of the six retired strings exists here (`Auto summarize target`, `summary target`, `recent kept`, `keep ~` → 0 hits) and our command names already match (`budget summary\|recent`, the `summary only` literal). What differs is the *receipt*: ours names the recent window by the settings-card label (`src/shared/setting-labels.ts` en `Recent tokens kept`) where pi's terminal is `~N recent carried` (`run.ts:28`), and our line is `summary thinking N` where pi's key is `handoffThinking`. Fold this into batch H's ruling; it is not a port of its own |

### The 19 commits that touch only docs, audits, evidence or skills

pi's own process records; the default disposition is PI-ONLY and none needs a port. The tags name the ones that are
design input for a batch above.

| commit | subject | disposition |
| --- | --- | --- |
| `ca71fd3` | docs(evidence): record the v0.4.0 vocabulary release and freeze the design | PI-ONLY (record) — evidence for batch H |
| `ab1a1d1` | docs(memory): refresh the render for v0.4.0 | PI-ONLY (record) |
| `f217e7d` | docs(configuration,handoff): document the renamed keys, the prefixes and the conventions file | PI-ONLY (record) — design input for batch H (the rename table and the "new name wins" rule) |
| `34fc32d` | docs(evidence): record the v0.3.2 release for the ask-first body flow | PI-ONLY (record) — evidence for batch G |
| `7bbf93c` | docs(memory): refresh the render for v0.3.2 | PI-ONLY (record) |
| `8b4550a` | docs(architecture,configuration): describe the ask-first body flow and cut v0.3.2 | PI-ONLY (record) — design input for batch G |
| `851a14f` | docs(vocabulary): settle the four open questions and clear two dead skill pointers | PI-ONLY (record) — design input for batch H (the settled rename set) |
| `5eec054` | docs(memory): record the decided run-it-now verbs and point at the vocabulary conventions | ALREADY IN DSH — that four layers word "run it now" differently is a decision, not drift, and it is already our ruling's shape (`/memory update`, `/session-log write`, `/handoff now`, bare `/autolearn`) |
| `ebdba28` | docs(design): open the vocabulary-consistency issue and record the audit's dispositions | PI-ONLY (record) — design input for batch H |
| `a11d1ef` | docs(spec): write down the vocabulary and naming conventions, and where they are enforced | **PORT-WORTHY (docs)** — the third row above; §2.2 (keys) is pi-file-specific and must be rewritten for our settings card |
| `998a4ae` | docs(design): record the naming decisions and audit the vocabulary that v0.3.0 did not converge | PI-ONLY (record) — design input for batch G (`inspectSkill`, the two-item cap, the `body not shown this pass` literal, the show/merge/supersede verbs) |
| `3859d3d` | docs(design): finish the r2 constant sweep — the budget tables still said 2500 | PI-ONLY (record) — pi's own design constants |
| `8bcba99` | docs(design): revise progressive disclosure to r2 on what the literature and specs actually say | PI-ONLY (record) — cites the Agent Skills spec's own levels; our `MAX_SKILL_BODY_CHARS` is a *character* cap of 20000, a different base, so batch G's brief must say which it uses |
| `1367027` | docs(design): draft progressive disclosure for autolearn — on-demand bodies and layered skills | PI-ONLY (record) — the design batch G implements |
| `9e87671` | docs(fix-note): correct the budget arithmetic and name the thirteen excluded skills | PI-ONLY (record) — evidence for batch G |
| `1029b44` | docs(memory): correct the learned-body arithmetic — four skills are shown, not seventeen | PI-ONLY (record) — evidence for batch G |
| `bd8b089` | docs(memory): refresh the memory render for the backfill and correct the add-only sentence | ALREADY IN DSH — the lesson (a render rebuilt from the journal drops facts written into the document by hand) is `.agents/skills/dsh-memory-doc-loss-repair/`'s headline rule |
| `23775db` | docs(fix-note): record the owner-directed marker backfill and the budget it consumes | PI-ONLY (record) — evidence for batch G; the *backfill decision* it records is a ruling for us, not a port |
| `0ca0d91` | chore(skills): mark the seventeen existing skills with the autolearn provenance marker | **PI-ONLY as a file change** (pi's own 17 skills) — but the analogous owner decision for our 21 is what *arms* batch G's trap, so record it as a ruling and never copy the file edits |

### Why batch G is not merely pi's problem

pi reached the trap by doing exactly what this repo's batch D made possible, one release later. `0ca0d91` marked
seventeen hand-written skills as pipeline provenance on the owner's convention; `23775db` then recorded what that
cost, and `1029b44` corrected the arithmetic: **96975 characters of marked bodies against the 20000-character total
cap, so four are shown and thirteen are dropped while the code gate still treats their thirteen names as reusable.**
`997447a` is the code-level guard that fix-note had explicitly deferred to the owner.

Our numbers are the same shape and a different count: `MAX_SKILL_BODY_CHARS` is `20000` here too, and
`0 of 21` skills in this repo carry the marker — so nothing is superseded blind *today*. The defect is latent, not
absent, and it is one owner decision away from being live: marking our own corpus is precisely the step that took pi
from "add-only in code" to thirteen invisible-but-overwritable names. That is why batch G deserves a brief even
though no user-visible behaviour is wrong at this revision.

### Why batch H is riskier here than in pi

The seven new spellings are `memoryEnabled`, `autolearnEnabled`, `handoffBudgetSummaryTokens`,
`handoffBudgetRecentTokens`, `handoffThinking`, `handoffThresholdAuto`, `handoffLang`; all seven are **0 exact
matches** in our `src/`, and all seven old names (`autoConsolidate`, `autoLearn`, `handoffTargetTokens`,
`handoffKeepTokens`, `handoffSummaryThinking`, `handoffAdaptive`, `handoffLanguage`) are present. pi's header says
six were shared; our grep says seven old spellings exist here, so treat pi's six/seven split as pi's accounting and
read our own tree.

**待核项（2026-10-05 追加，用户裁定记录）**：pi 的 `extensions/project-context/shared/config.ts` 头注释（第 13–24
行）有两处口径不符，均已按本仓 grep 复核。这是 pi 的注释问题、不是代码缺陷，也不动摇批次 H（七个改名另有
独立依据：pi 的 `RENAMED_KEYS` 表加词表约定）：

1. 它写 "Six of the renamed keys were shared with dsh"，实为**七个**：dsh 在 `v0.3.0` 就已拥有全部七个旧名
   （`git show v0.3.0:src/shared/config.ts` 七个逐一到齐），改名后两侧同名。即上面那句 six/seven。
2. 它把 `handoffLang` 与 `handoffMode`、`handoffGuard` 并列为 pi-only，但 `handoffLang` **不是** pi-only：两侧
   同名且语义一致（`"auto" | "zh" | "en"`，handoff scaffolding language）。真正的 pi-only 是 `handoffMode`、
   `handoffGuard`（外加 pi 的状态字段 `autolearnAt`）。

复现（2026-10-05 实跑，两侧 `DEFAULT_CONFIG` 各按对象字面量提取键集后求交）：dsh 21 键 / pi 23 键 / 共有 20；
dsh-only = `handoffPendingQuestion`，pi-only = `autolearnAt`、`handoffGuard`、`handoffMode`；七个改名键两侧
`grep -cx` 全部为 1。**待核**：下次与 pi 同步或改 pi 头注释时一并订正；本仓不改 pi 树。

The mechanical half does not transfer. pi folds an old name into the new one inside `legacyConfigPatch`, which reads
a *project* file (`.agents/memory/project-context.json`). Our settings are parsed from the Loader entry's config
(`src/shared/config.ts`'s `resolvePluginConfig`) and the platform persists the values the card writes into each
profile's own `cordis.patch.yml` — files outside this repo. `git grep -in legacy -- src/shared/config.ts` → **0
hits**: there is no legacy-name reader to add a term to. So renaming `handoffKeepTokens` without a compatibility
reader would leave the profiles' explicit `handoffKeepTokens: 0` (their comments say it is deliberate: hand off
the summary only) as an **unknown key**, and `resolvePluginConfig` throws on unknown keys
(`src/shared/config.ts:105-107`). The settings namespace's live reader swallows that and falls back
(`src/shared/settings.ts:94-101`), but the four `apply()` call sites call `resolvePluginConfig` unguarded, so the
observable is a thrown `unknown config key` at plugin apply — not a quiet return to the `20000` default. Either
way, a *naming* commit would change behaviour in files this repo does not own.

### Reproducible commands

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P rev-parse HEAD origin/master                                           # 6707376 / ca71fd3
git -C $P rev-list --left-right --count master...origin/master                   # 0 78 (behind, not diverted)
git -C $P rev-list --count f6bea1d..ca71fd3                                      # 22
git -C $P log --oneline f6bea1d..ca71fd3 -- 'extensions/**' 'tests/**'           # the three above
for t in v0.3.1 v0.3.2 v0.4.0; do git -C $P rev-parse "$t^{commit}"; done        # 12c6390 / 8b4550a / f217e7d
git -C $P show 2177386 -- extensions/project-context/shared/config.ts            # the 7-entry RENAMED_KEYS table
git -C $P show ca71fd3:extensions/project-context/autolearn/inventory.ts         # learnedBodies: text + names
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -cE '\b(memoryEnabled|autolearnEnabled|handoffBudgetSummaryTokens|handoffBudgetRecentTokens|handoffThinking|handoffThresholdAuto|handoffLang)\b' -- src/   # 0: batch H not started
git -C $D grep -n 'collision && !collision.autolearn' -- src/project-autolearn/candidate.ts   # the pre-port gate; rc=1 after batch G
git -C $D grep -cn 'shown' -- src/project-autolearn/candidate.ts                 # 0 before batch G; 9 after it
git -C $D grep -n 'whose body is not shown' -- src/project-autolearn/prompt.ts   # the pre-port wording: the rule lived in the prompt only
git -C $D grep -in legacy -- src/shared/config.ts                                # 0: no legacy-name reader exists
grep -rl autolearn-generated $D/.agents/skills/*/SKILL.md | wc -l                # 0 of 21: the corpus is unmarked (a corpus fact, not a code one)
grep -n 'handoffKeepTokens\|handoffAdaptive' ~/.dsh/profiles/*/cordis.patch.yml  # the values a rename would orphan
```

### The honest boundary

This is a per-module read of what pi's commits touch and of the mechanism under its dsh name, not a semantic diff of
the two trees; anything outside this repo (dsh core, the delivery line in `/etc/nixos`, the profile files under
`~/.dsh`) is not owned here. At the time of this pass both batches were *proposals with evidence*, not landed work:
`src/` was not touched by this pass and nothing was ported. **Batch G has since landed** (2026-10-05, one `src/` +
test commit: `docs/batch-g-autolearn-pull-brief.md` §8, evidence
`.agents/evidence/2026-10-05-autolearn-pull-model/`), so three commands in the block above describe the *pre-port*
state and were annotated in place: the `collision && !collision.autolearn` grep now returns rc=1 (the gate reads
`if (collision) { if (!collision.autolearn) … }`), `git grep -cn 'shown' …` reads 9 instead of 0, and the prompt rule
now says `was not shown`. The `0 of 21` marker count is unchanged and is a fact about the corpus rather than about
the code — nothing was ever superseded blind *because nothing was marked*, which is exactly why the defect was
latent. **Batch H has since landed too** (2026-10-05: all seven keys renamed with no compatibility reader, plus the
`project-memory` prefix convergence — rulings in `docs/batch-h-vocabulary-keys-ruling.md`, standing rules in
`docs/vocabulary-conventions.md`), so the `0` above describes only the pre-port state; the seven new spellings now
appear in `src/`, `client/` and the tests. The pi measurements quoted (`96975` characters of marked
bodies against `20000`, four shown of seventeen) are pi's, taken from its own commits; our counterpart is the count
`0 of 21` markers, not a byte total, because a repo with no marked skills has no bodies to weigh. The two standing
traps hold: pi's finish reason is `length` where dsh's is `max-tokens`, and pi's `R3` table is pi's audit and not
this repo's R3 batch. A related caution this pass's own reading produced: pi's `R<n>` labels are **per-issue, not
global** — `R2`/`R4` name structural counterexamples in `2026-09-15-consolidated-memory-json-poison` and review
rounds in `2026-10-03-design-complexity-audit`, so never carry an `Rn` across issues or into this repo without its
issue path.

## Sixth pass — 2026-10-06 (55 commits after the fifth pass)

The fifth pass stopped at `ca71fd3`. pi's `master` has since reached `4e40d43` — **55 commits** in
`ca71fd3..4e40d43`, spanning pi's v0.4.1 and v0.4.2. Both tags sit inside the range and both peel to a
**docs** commit above the code that carries the release: `v0.4.1` → `7b6fc98`, `v0.4.2` → `4b4f9c3`.
Neither endpoint is itself a tag: `ca71fd3` is `v0.4.0-2-gca71fd3` and `4e40d43` is
`v0.4.2-2-g4e40d43`. State the revision and the tag separately rather than pairing them.

**Read the checkout honestly.** The checkout's own `master` is at `1a958ce` while `origin/master` is
`4e40d43`, so its working tree answers with pre-change files; every pi read behind this section is
`git show 4e40d43:<path>` or `git show <commit>`. The range is 55 by `rev-list --count` but **53 on the
first-parent line**: the merge `233e7c4` (pi's `Merge remote-tracking branch 'refs/remotes/ghmaster'`)
brings two commits reachable only through its second parent — `0f424b9` and `1a958ce`, which are the
census corrections the fifth pass asked for (see "What this pass closes"). `git log --all --not master`
is non-empty here only because the local `master` is behind; `git branch -a` shows no second branch.

Unlike the fifth pass, this range is mostly process: **14 commits touch `extensions/` or `tests/`; 41 are
records**. The code half is one feature and one deletion, both large, and this pass ports **nothing** —
it is a docs-only round, so `src/` is untouched and no host restart is owed.

### The 14 commits that touch code or tests

| commit | subject | disposition |
| --- | --- | --- |
| `9821320` | feat(memory): keep the two decision sections inline and index the rest | **PORT-WORTHY — batch I** (progressive disclosure). dsh injects both documents whole |
| `b4c9405` | refactor(handoff): drop the generated summary and carry a pointer instead | **PORT-WORTHY — batch J** (delete the summarizer). dsh still runs the whole chain at `perform.ts:95` |
| `f19dc93` | fix(handoff): carry the last turn's question, not only its summary | **PI-ONLY** — pi's `findCutPoint` turn indices; dsh splits between whole rendered messages and already answers this with `handoffCarry` (`904152d`), which `handoffSplit`'s own comment argues about pi's `093dbf3` |
| `e77ec20` | refactor(handoff): state the open question once and merge the two detail lines | **PI-ONLY** (wording) — dsh's `continuation()` states the pending question once (heading + wait line) and carries no early duplicate sentence to delete |
| `9abd971` | fix(memory,handoff): apply the review round 1 corrections | **PART OF BATCHES I/J** — corrections to the two features above, not fixes of their own; it is also what *introduced* the two-view preamble/section split that `bd9fd3a` later removed |
| `a0bcdd1` | fix(memory,handoff,docs): apply the review round 2 corrections | **PART OF BATCHES I/J** — its fence half is ALREADY IN DSH (the CommonMark rule above); its cwd-fallback item is structurally present here (see the boundary) |
| `2d1a87b` | fix(memory): a consolidation failure at shutdown is logged, not thrown | **ALREADY IN DSH** — `consolidateProject`'s catch logs and returns a `failed` report (`index.ts:353`), and `SessionWorkTracker.track` swallows rejection (`lifecycle.ts:61`); dsh has no `session_shutdown` at all |
| `bd9fd3a` | fix(memory,handoff): the round-3 nits and the retirement of `handoffThinking` | **SPLIT** — (i) `scanDocument` unification: PI-ONLY today, rides inside batch I; (ii) CommonMark fence close: **ALREADY IN DSH**; (iii) `handoffThinking` retirement: **NOT PORTABLE AS-IS** (see below); (iv) `MIN_SUMMARIZE_TOKENS` → `MIN_DROP_TOKENS`: belongs to batch J |
| `5b01712` | fix(handoff,memory): delete the unreachable re-checks and pin the shutdown fallback root | **PI-ONLY** — it deletes `if (!force …)` blocks in pi's forced-trigger plumbing; dsh's `performHandoff` takes `reason: "auto" \| "manual"` and has no `force` local, and `/handoff force` was retired as an alias (`index.ts:159`) |
| `8f4eab7` | refactor(modules): delete the dead symbols and close the internal-only export surface | **PI-ONLY, and a trap** — pi deletes `newestMemoryArchiveSync` because pi's `loadMemorySync` is gone; in dsh that symbol is **live** (`journal.ts:217`, called from `load.ts:195` in `loadMemorySync`). See "What this pass corrects" |
| `50fb893` | docs(records): correct the retirement rationale, the fence narrative and the audit's own scope | **PI-ONLY (record)** — and one of its corrected claims is still wrong about dsh |
| `fa4c15b` | docs(records): drop the dsh claim nobody can check, and the counts this round moved | **PI-ONLY (record)** — names pi's residual **R-2** (pi cannot see dsh's readers). Answerable from here |
| `0f424b9` | docs(config): all seven renames are shared and `handoffLang` is not pi-only | **PI-ONLY (record)** — closes the fifth pass's 待核 item |
| `8b32dcb` | docs(records): fix the rename list the retirement edit clipped, and the numbers I miscounted | **PI-ONLY (record)** — touches `tests/` only |

### Batch I — progressive disclosure for the two injected documents

pi's `9821320` stops injecting `MEMORY.md` and `CONTEXT.md` whole. `shared/inject.ts` walks the rendered
document **once** (`scanDocument`) into a preamble plus sections, then `renderProgressiveBody` keeps some
sections verbatim and reduces each named heading to one pointer line:

- `MEMORY.md` keeps `## Invariants` + `## Pitfalls`; `## Project` and `## Index` become pointers.
- `CONTEXT.md` keeps `## Key points` + `## Open tasks`; `## Summary` becomes a pointer.
- The preamble and any document-level note (the `_[…]_` truncation marker) stay inline; a heading the
  spec does not name stays inline; a document with no usable heading is injected whole — so a schema
  change degrades to today's behaviour instead of dropping content.
- The pointer block ends with a read-first instruction, and the pointer path is resolved against the
  project root because the reader's `read` resolves relative paths against its own cwd.

**dsh today injects both documents whole.** `src/project-memory/index.ts` builds
`## Project Memory …` + the whole `loadMemorySync(projectRoot, limit).trim()` text and
`## Project Context …` + `text.slice(0, MAX_CONTEXT_CHARS)`. There is no split concept to extend:
`git grep -cn 'scanDocument\|splitSections\|renderProgressiveBody\|InjectionSpec' -- src/` → **0**.

Design input lives in pi's audits — `00282cb` (context cost), `a453233` (who consumes disclosure),
`8efd274` and `10cd4da` (the read-on-demand result is **model-dependent, not mechanism-dependent**),
`a6d18e4` (a strong read-first sentence is what rescues a non-reading model), `0b6d45c` (design).

**Ruling needed: yes.** It changes what the model sees every turn (pi measures about ten thousand
characters per turn saved) in exchange for a `read` round-trip on indexed facts, and pi's own audit says
the benefit depends on the model obeying the read-first sentence.

### Batch J — drop the generated handoff summary and carry a pointer

pi's `b4c9405` deletes the whole summarizer: the model call, its token-cap retry, its output reserve and
model-window cap, and the localizer that rewrites the summary's section headings. The successor now gets
only mechanical payload — the carried tail verbatim, the file list, the pending question — plus the old
session log as a pointer with a strong "look a detail up in the log with `grep`, never answer from
impression" instruction. `HANDOFF.md` keeps title, created, project, log and index and nothing else.

**dsh still runs the full chain**, invoked at `src/project-handoff/perform.ts:95`:
`summarize(ctx, target, config, handoffPrompt(…), withTimeout(signal), resolveSummaryEffort(…))`, with
`summary.ts` owning `handoffPrompt`, `summarize` + `summaryAttemptBudgets` / `SUMMARY_RETRY_FLOOR` /
`SUMMARY_TIMEOUT_MS`, `resolveSummaryEffort`, `renderHandoff` and `continuation`, and
`localizeSummaryHeadings` in `language.js`.

Everything that moves with it, in dsh's own spelling:

- **`handoffThinking` and `/handoff thinking`** — its only behavioural reader is
  `resolveSummaryEffort` (`summary.ts:21-27`), reached from `perform.ts:95`. Deleting the summary is what
  turns it into a write-only key.
- **`MIN_SUMMARIZE_TOKENS` → `MIN_DROP_TOKENS`** (`threshold.ts:15`, consumed by `auto.ts:65` and shown
  as "摘要下限 / summarize minimum" in the refusal text) — pi renamed it because the constant then names
  the minimum *droppable prefix*. The dsh name is accurate until the summary is gone.
- The threshold's summary-token accounting, the `/handoff status` receipt and the refusal wording, the
  settings card and its `field.*` locales, and the tests.
- `handoffBudgetSummaryTokens` **survives** in pi (kept deliberately, with a live reader in the override
  receipt) and likewise has a live dsh reader at `threshold.ts:346`, so it is not part of the deletion.

**Ruling needed: yes.** This is the "half-landed is worse than none" shape: it changes how the
successor's first message is produced and orphans a persisted key.

Briefs are written: `docs/batch-i-progressive-injection-brief.md` and
`docs/batch-j-drop-summary-brief.md`. Each states the pi references at a read revision, the dsh files
and line anchors that move, the decisions that need the user's ruling, the traps and the verification
plan, so a fresh session can start from the file alone. Both carry the 2026-10-06 rulings and the
implementer decisions taken under them, and both are **in progress** — the batches land before the
pending desktop restart so one restart loads them together with the earlier `src/` work.

### What this pass corrects

- **pi's claim that `handoffThinking` has no reader is false for dsh.** `50fb893` states the retirement's
  real reason as "nothing reads it on either side, since dsh reads its own `handoffPendingQuestion`".
  dsh **does** read it: `summary.ts:23 if (config.handoffThinking === "session")` inside
  `resolveSummaryEffort`, called at `perform.ts:95`, and the key also appears in the config type/default,
  the settings schema and the card (`config.ts:56,82`, `settings.ts:60`, `card-fields.ts:100`). The two
  repos are therefore **not symmetric**: pi's key was write-only after v0.4.1, dsh's was live. Retiring it
  here before batch J would silently drop a working setting.
- **pi's dead-symbol sweep is a trap here.** `8f4eab7` deletes `newestMemoryArchiveSync` because pi's
  `loadMemorySync` no longer exists. In dsh it is live — `journal.ts:217` defined, `load.ts:195` called by
  `loadMemorySync` to recover the document from a rotation archive. Porting the sweep by symbol name would
  break dsh's prompt assembly. `cleanHeaders`, pi's other dead name, is genuinely 0 hits here.
- **The fence narrative, read from both sides.** pi's v0.4.2 entry describes a unified fence-aware scan.
  dsh already has the CommonMark close rule in both places that matter
  (`language.ts:147 if (marker[0] === fence.char && marker.length >= fence.length && rest.trim().length === 0)`
  and `sections.ts:319 fence.char === openFence.char && fence.run.length >= openFence.run.length && fence.info === ""`),
  and each is a single traversal, so dsh has **no** fence-blind second view. pi's own `50fb893` later
  corrected the entry: `9abd971` is what *introduced* the two-view defect (`splitSections` beside a
  fence-blind `firstHeading` search) and `bd9fd3a` is what removed it.
- **pi's residual R-2 is answerable here.** `fa4c15b` records that pi cannot prove whether dsh reads its
  own keys, because every dsh artifact on its machine lacks the word `handoff`. From this tree the answer
  is yes: `handoffPendingQuestion` is dsh's own key and is read as the `defer` gate in `auto.ts`, and
  `handoffThinking` is read as above.

### What this pass closes

The fifth pass's 待核 item is **closed upstream**. `0f424b9` (merged in by `233e7c4`) and `1a958ce`
correct pi's config header from "six of the renamed keys were shared with dsh" to **all seven**, and
`handoffLang` from pi-only to shared — exactly what the fifth pass read off dsh's tree. pi now states the
same census: pi 23 keys, dsh 21, twenty shared; pi-only `handoffMode` / `handoffGuard` / `autolearnAt`;
dsh-only `handoffPendingQuestion`. No reconciliation is owed on the next sync, and the fifth pass's note
that "本仓不改 pi 树" stands.

### The 41 commits that touch only docs, audits, evidence or skills

pi's own process record. The default disposition is **PI-ONLY (record)**; none needs a port, and the ones
that are design input for a batch above are marked.

`4e40d43`, `027f169`, `4b4f9c3`, `4f14bc3`, `df7052a`, `82b06c1`, `94f963e`, `611fcef`, `98aa3a1`,
`739af58`, `f2d27c8`, `8824599`, `3a9ef26`, `0149d5a`, `1553151`, `15b65cb`, `2a7f7d0`, `f064362`,
`9c46943`, `0a95b4b`, `0d2f62b`, `f4eeb9e`, `7b6fc98`, `98abe01`, `4b96464`, `0b6d45c`, `a6d18e4`,
`10cd4da`, `d4655cf`, `8efd274`, `a453233`, `00282cb`, `c06b292`, `ff94f16`, `9737a8e`, `88acbba`,
`233e7c4` (the merge), `c520c38`, `1a958ce`, `7e9241c`, `60f63b0`.

Marked design input: `0b6d45c`, `00282cb`, `a453233`, `8efd274`, `10cd4da`, `a6d18e4`, `4b96464`,
`98abe01` → batch I; `9737a8e`, `ff94f16`, `c06b292` → batch J. `88acbba`, `0f424b9`, `1a958ce` correct
pi's own census of dsh. The `docs(memory): refresh the memory render` commits are pi's render loop.

### Reproducible commands

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P rev-parse HEAD origin/master                                  # 1a958ce / 4e40d43
git -C $P rev-list --count ca71fd3..4e40d43                             # 55
git -C $P rev-list --count --first-parent ca71fd3..4e40d43              # 53 (merge 233e7c4 adds 2)
git -C $P log --oneline 233e7c4^2 --not 233e7c4^1                        # 0f424b9, 1a958ce
git -C $P branch -a                                                      # no second branch
for t in v0.4.1 v0.4.2; do git -C $P rev-parse "$t^{commit}"; done        # 7b6fc98 / 4b4f9c3
git -C $P describe --tags ca71fd3; git -C $P describe --tags 4e40d43     # v0.4.0-2-g… / v0.4.2-2-g…
git -C $P log --oneline ca71fd3..4e40d43 -- 'extensions/**' 'tests/**'   # the 14 above
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -cn 'scanDocument\|splitSections\|renderProgressiveBody\|InjectionSpec' -- src/   # 0: batch I not started
git -C $D grep -n 'loadMemorySync(projectRoot' -- src/project-memory/index.ts                    # whole-document injection
git -C $D grep -n 'resolveSummaryEffort' -- src/                        # perform.ts:95 — the summary call
git -C $D grep -n 'handoffThinking' -- src/ client/                     # a live reader, not a write-only key
git -C $D grep -n 'newestMemoryArchiveSync' -- src/                     # 3 hits: LIVE, do not port 8f4eab7 by name
git -C $D grep -cn 'cleanHeaders' -- src/ test/                         # 0: pi's other dead name has no dsh twin
git -C $D grep -n 'MIN_SUMMARIZE_TOKENS' -- src/project-handoff/threshold.ts                    # 15, still accurate
git -C $D grep -c 'session_shutdown\|shutdownErrorRoot' -- src/         # 0: dsh disposes via agent/disposed
git -C $D grep -n 'fence.char === openFence.char' -- src/project-memory/sections.ts             # the CommonMark rule, already here
```

### The honest boundary

This is a per-module read of what pi's commits touch and of the mechanism under its dsh name, not a
semantic diff of the two trees; anything outside this repo (dsh core, the delivery line in `/etc/nixos`,
the profiles under `~/.dsh`) is not owned here. Two dispositions rest on source reads rather than probes
and are marked as such: that dsh's `getProjectRoot` cannot reject (so pi's `shutdownErrorRoot` has no
branch to pin here), and that no fence-blind heading scan exists under a name this pass did not guess.
The `9abd971`/`a0bcdd1` rows are classified as corrections *inside* batches I/J rather than as fixes of
their own; one of their items — that `logError` creates a stray `.agents/memory/` when handed a wrong
root (`src/shared/error-log.ts` calls `mkdir(…, { recursive: true })` unconditionally) — is structurally
present in dsh, but whether a reachable dsh path passes it a wrong root was not established. Nothing was
ported: this pass edits `docs/` and memory only, `src/` is untouched, and no CHANGELOG entry or host
restart follows from it.

## Seventh pass — 2026-10-06 (5 commits after the sixth pass)

The sixth pass stopped at `4e40d43`. pi's `origin/master` has since reached `c9d4db6` — **5 commits** in
`4e40d43..c9d4db6`, and the first-parent count is the same 5 (no merge in this range). `v0.4.2` is still the
newest tag and sits 7 commits below the endpoint (`git describe --tags c9d4db6` → `v0.4.2-7-gc9d4db6`); the
previous endpoint is `v0.4.2-2-g4e40d43`. State the revision and the tag separately rather than pairing them.

**Read the checkout honestly.** The checkout's own `master` is still `1a958ce` (`v0.4.0-6-g1a958ce`) while
`origin/master` is `c9d4db6`, so its working tree answers with pre-change files; every pi read behind this
section is `git show c9d4db6:<path>` or `git show <commit>`. `git log --all --not master` is non-empty (56
commits) for that reason only — `git branch -a` shows no second branch.

Unlike the sixth pass, this range is **almost all code**: one docs commit (`ab21491`) and four that touch
`extensions/` or `tests/`. This pass ports **nothing** — it is a docs-only round — but it does find portable
work. Four of the five commits are the follow-up rounds of pi's own v0.4.3 release: `057021d` clears the two
residuals v0.4.2 shipped as named follow-ups, and `3a0183b`, `e024595`, `c9d4db6` are the review rounds that
correct it.

### The five commits

| commit | subject | disposition |
| --- | --- | --- |
| `057021d` | fix(handoff,autolearn): both modes obey the drop floor, and a truncated inventory says so | **SPLIT, PORT-WORTHY — batch K** (items 1, 5) |
| `3a0183b` | fix(handoff,autolearn): name the refusal, pin the floor boundary, and gate the blank line | **SPLIT** — items 2, 4 PORT-WORTHY (batch K); the repo-hygiene gate is PI-ONLY |
| `ab21491` | docs(memory): refresh the memory render | **PI-ONLY (record)** — pi's own memory render |
| `e024595` | fix(config,handoff,autolearn): one source for the ratio range, and a hygiene gate that reports itself | **SPLIT** — item 3 PORT-WORTHY (batch K); the hygiene gate and the near-floor receipt fix are PI-ONLY / not applicable |
| `c9d4db6` | test,docs(handoff): close round 12's nits, including a CRLF hole in the hygiene gate | **PI-ONLY (record)** — its one portable lesson is a rule for item 3's new guard |

### Batch K — the fixed threshold tells the truth

Four items, three groups, all in dsh's handoff and autolearn, each with the dsh defect read off our own
source. Nothing is ported yet.

1. **Fixed-ratio mode does not obey the physical drop floor.** pi's `057021d` routes the fixed branch through
   the same floor the adaptive branch uses, and deliberately keeps it a **refusal gate, not a lift**:
   `ratio * window` landing below `baseline + keep + MIN_DROP` refuses, because a handoff that drops a few
   thousand tokens replaces the session without buying context. dsh's fixed branch
   (`src/project-handoff/threshold.ts:321-335`) consults nothing but `tokens <= 0`: a `0.1` ratio at a
   10 000-token window resolves to a 1 000-token threshold and is handed to `auto.ts` as a usable trigger,
   where the adaptive branch on the same numbers refuses through `handoffRoom`. **Partial overlap, and it
   has to be stated rather than counted as the fix already being here:** `auto.ts:65` already skips a handoff
   whose *measured* older span is under `MIN_DROP_TOKENS`, so dsh will not usually perform the worthless
   handoff — but that reads the session's own fill rather than the configuration, and it is a silent skip
   (the "nothing older to drop" line), not a refusal, so the threshold and the receipt still claim a trigger
   that cannot buy context. The two bases also differ: pi's floor is measured `baseline + keep + 8 000`,
   dsh's skip compares the older span against `8 000`.
2. **Every fixed refusal carries one cause, so item 1 would be reported as a window problem.** dsh's
   `thresholdRefusal` returns the single `no-positive-threshold` for every fixed-mode refusal
   (`threshold.ts:88`) and `thresholdRefusalText`'s closing sentence asserts the ratio "cannot help"
   (`threshold.ts:195-201`). Once item 1 lands that sentence is **false** — the ratio is then the first lever
   — and the two causes (a ratio that rounds out at a tiny window, a threshold under the floor at a large
   one) want opposite advice. pi carries the second cause as `fixed-below-floor` and picks the lever from
   `MAX_THRESHOLD_RATIO`, naming only the carried-window budget when even the largest legal ratio cannot
   clear the floor. *Ruling needed*: this is a behaviour change (a configuration that triggers today would
   refuse), and items 1 and 2 must land together or the refusal blames the window.
3. **The ratio range is copied, not shared.** pi's `e024595` is the follow-up that made its own "single
   source" claim true, and its finding was that exporting one of the pair is worse than neither: moving
   `MAX_THRESHOLD_RATIO` alone while the parser kept its literal stayed green. dsh has not started:
   `0.1`/`0.95` is written **10 times in 5 files**, three of them executable — the command parser
   (`command.ts:26`, plus the two usage sentences at `:53`/`:73`), the config validator
   (`config.ts:144-145`) and the settings zod schema (`settings.ts:57`) — the rest being the type comment
   (`config.ts:48`), the threshold comment (`threshold.ts:196`) and the two card hints (`locales.ts:55,116`).
   The portable shape is **one exported pair** read by the validator, the parser and the usage sentences.
4. **A refused configuration is confirmed as a success.** pi's `3a0183b` makes `/handoff threshold <ratio>`
   hand back the status line, so a ratio that can never fire is visible the moment it is set. dsh replies
   `Handoff setting updated: threshold 0.4` (`src/project-handoff/index.ts:168`) without resolving anything,
   so item 1's unreachable trigger reads as success.
5. **The autolearn inventory hides its tail.** pi's `057021d` appends
   `- (N more skill(s) not listed: the <cap>-character inventory cap was reached)` when the cap truncates the
   list, so the model knows an unseen name is not a nonexistent name and an operator sees the cap being
   reached. dsh's `inventoryText` (`src/project-autolearn/inventory.ts:69`) `break`s silently at
   `MAX_INVENTORY_CHARS = 8_000`. pi records its own merged inventory at 7 892/8 000 — the cap is reached in
   practice. Purely additive and independent of items 1–4.

Items 1+2 are one change, 3+4 are one change, 5 stands alone: three groups, none large enough for a
half-landed shape, and only 1+2 needs a ruling.

### Batch K landed (2026-10-06, same day)

All four items plus the inventory marker are **ported**, not pending. `src/shared/limits.ts` now owns
`MIN_THRESHOLD_RATIO` / `MAX_THRESHOLD_RATIO` / `DEFAULT_THRESHOLD_RATIO` and every reader — the config
validator, the settings schema, the command parser, both usage sentences and the card's two hints — reads the
pair; fixed mode refuses under `thresholdFloor`; the two fixed refusals have separate causes and separate
receipt sentences; `/handoff threshold <ratio>` answers with the status receipt; and `inventoryText` names its
truncated tail.

One implementation decision is not pi's shape and is worth recording. pi mutates its in-process `config` before
rendering the receipt (`config.handoffThresholdRatio = ratio` then `notify(handoffStatusLine(ctx))`). dsh's
write goes through the settings service, and the host's entry restart may not have republished the config by
the time the reply is built — so reading the live config alone would explain the *previous* ratio in the one
message whose entire purpose is to explain the new one. `statusText` therefore takes an optional `pending`
patch and the command passes the patch it just wrote, which makes the receipt describe the write under review;
`/handoff status` passes nothing and reports exactly what is in force.

Five mutants were run against the new pins (four killed, one invalidated by `TS6133` and reshaped — a constant
left unreferenced makes the mutant malformed, and an invalid mutant's red is not evidence). `src/` was restored
from a hash-verified copy, `lib/` rebuilt with no residual marker, and the gate reads green. Nothing here has
run on a host: it needs the same restart batches I and J are waiting for, and the CHANGELOG entry carries the
per-mutant detail.

### What this pass does NOT find

- pi's near-floor receipt fix (print the raw integers when `fmtTokens` rounds both sides of the comparison to
  the same text) has no dsh analogue: dsh's receipt prints `floor` and `usable` as raw integers already, so
  there is no rounding collision to avoid.
- pi's repo-hygiene gate (a tracked text file must not end with a blank line; `tests/run-all.mjs` gained a
  NUL-byte-skipping reader that covers `LICENSE`, and `c9d4db6` closed its CRLF hole) has no dsh counterpart:
  dsh's suites carry no trailing-blank-line check (`git grep -n 'ends with a blank line' -- test/ src/` → 0).
  It is pi's own release gate rather than a behaviour fix, so it is refused, not ported.
- pi's threshold skill no longer states the floor formula with a pre-rename key. No dsh skill carries a ratio
  range or a pre-rename key in a floor formula (`git grep -n '0\.1.*0\.95' -- .agents/skills/` → 0), so there
  is nothing to correct here.
- `ab21491` is pi's own memory render, and the coupling-guard lesson `c9d4db6` draws (a guard that checks one
  bound of a shared pair lets the mirror mutation through — move `MIN` and keep the parser's literal, and both
  the guard and the config tests stay green) is a rule for the guard item 3 adds, not a change of its own.

### Sixth pass addendum (2026-10-06)

Batches I and J are **landed** since that section was written: `12aacbb` (batch J — the summarizer deleted and
`handoffThinking` retired) and `28401bb` (batch I — the two decision sections stay inline and the rest is
indexed) are in `src/`, the gate is green and `lib/` matches a fresh `tsc` compile with `lib/client.js` the
only extra. They are **not yet loaded**: the desktop host serving 19387 started before both commits, so one
restart loads them together with `f38a0ba` and `904152d`. The sixth pass's "in progress" wording stays as the
record of the day it was written; this addendum carries the outcome.

### Reproducible commands

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P fetch origin                                                  # the pass needs this first
git -C $P rev-parse HEAD origin/master                                  # 1a958ce / c9d4db6
git -C $P rev-list --count 4e40d43..origin/master                       # 5
git -C $P rev-list --count --first-parent 4e40d43..origin/master        # 5 (no merge in this range)
git -C $P describe --tags 4e40d43                                       # v0.4.2-2-g4e40d43
git -C $P describe --tags origin/master                                 # v0.4.2-7-gc9d4db6
git -C $P describe --tags HEAD                                          # v0.4.0-6-g1a958ce (checkout behind)
git -C $P tag -l --sort=-v:refname | head -1                            # v0.4.2
git -C $P branch -a                                                     # no second branch
git -C $P log --oneline 4e40d43..origin/master                          # the 5 above
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -n 'ratio >= 0.1 && ratio <= 0.95' -- src/                # command.ts:26 — a literal, not the config pair
git -C $D grep -n '0\.1.*0\.95' -- src/ client/ | wc -l                  # 10 lines
git -C $D grep -c '0\.1.*0\.95' -- src/ client/                          # 5 files carry them
git -C $D grep -n 'no-positive-threshold' -- src/project-handoff/        # one fixed cause for every fixed refusal
git -C $D grep -n 'thresholdFloor' -- src/project-handoff/threshold.ts   # not reached from the fixed branch
git -C $D grep -n 'Handoff setting updated' -- src/                      # index.ts:168 — the blind confirmation
git -C $D grep -n 'MAX_INVENTORY_CHARS' -- src/                          # inventory.ts:12,69 — a silent break
git -C $D grep -n 'ends with a blank line' -- test/ src/                 # 0: no repo-hygiene gate to port into
git -C $D grep -n '0\.1.*0\.95' -- .agents/skills/                       # 0: no skill states the range
```

### The honest boundary

This is a per-module read of what pi's commits touch and of the mechanism under its dsh name, not a semantic
diff of the two trees; anything outside this repo (dsh core, the delivery line in `/etc/nixos`, the profiles
under `~/.dsh`) is not owned here. Three dispositions rest on source reads rather than probes and are marked as
such: that dsh's fixed branch reaches no floor (a read of `threshold.ts:321-335`), that `auto.ts:65` already
guards the *measured* older span (a read of `auto.ts`, not a driven session), and that no dsh skill states the
ratio range (a zero-hit grep over `.agents/skills/`, which the tracking boundary makes a complete set of the
promoted skills). Item 1's ruling is the only decision this pass asks for. Nothing was ported: this pass edits
`docs/` and memory only, `src/` is untouched, and no CHANGELOG entry or host restart follows from it.

## Eighth pass — 2026-10-06 (14 commits after the seventh pass)

The seventh pass stopped at `c9d4db6`. pi's `origin/master` has since reached `7ab60c9` — **14 commits** in
`c9d4db6..7ab60c9`, and the first-parent count is the same 14 (no merge in this range). The range carries two
releases: `c9d4db6` is `v0.4.2-7-gc9d4db6` and `7ab60c9` is `v0.4.4-2-g7ab60c9`, with `v0.4.3` and `v0.4.4`
inside it. State the revision and the tags separately rather than pairing them.

**Read the checkout honestly.** The checkout's own `master` is still `1a958ce` (`v0.4.0-6-g1a958ce`) while
`origin/master` is `7ab60c9`, so its working tree answers with pre-change files; every pi read behind this
section is `git show <commit>` or `git show 7ab60c9:<path>`. `git log --all --not master` is non-empty (70
commits) for that reason only — `git branch -a` shows no second branch.

This range is mostly records: **10 of the 14 commits** touch only `docs/`, `.codestable/`, pi's release evidence
or pi's own `.agents/memory/` renders, and four touch `extensions/` or `tests/`. The pass ports **nothing** — it
is a docs-only round — and it finds one coherent port batch plus one latent coupling.

### The 14 commits

| commit | subject | disposition |
| --- | --- | --- |
| `6a00587` | test,docs(handoff): derive the fixture from the constant, and catch a whitespace-only last line | **SPLIT** — the constant-derived fixture is a latent coupling (see below); pi's blank-line gate and the docs sentence are PI-ONLY |
| `b9085d5` | docs(records): v0.4.3 release evidence, dated changelog, and round 14's three items | **PI-ONLY (record)** |
| `c3757bb` | docs(records): fill in the v0.4.3 release facts | **PI-ONLY (record)** |
| `d023d0f` | docs(memory): refresh the memory render | **PI-ONLY (record)** — pi's own memory render |
| `8baab6f` | docs(memory): refresh the memory render, restoring the entries the pass dropped | **PI-ONLY (record)** — a hand-restore that was itself over the section budgets; its lesson is batch L |
| `793b708` | docs(attention): record that the memory sits at its cap and drops entries | **PI-ONLY (record)** |
| `8cf0a9f` | docs(attention): wrap the new entry's lines at 150 columns | **PI-ONLY (record)** |
| `5a92c54` | docs(memory): session snapshot after the v0.4.3 close-out | **PI-ONLY (record)** |
| `ed51eac` | fix(memory): make the consolidation prompt keep entries instead of dropping them | **PORT-WORTHY — batch L**, superseded by `aaafd0b`, which re-aims the same two sites |
| `65e9283` | docs(records): add the second field sample and the guard-matching caveat | **PI-ONLY (record)** |
| `aaafd0b` | fix(memory): aim the compression rule at the section budgets the renderer enforces | **PORT-WORTHY — batch L** |
| `009cceb` | fix(memory): compress to the section budgets in both prompt layers, ship v0.4.4 | **PORT-WORTHY — batch L** |
| `9c2db1a` | docs(records): fill in the v0.4.4 release facts | **PI-ONLY (record)** |
| `7ab60c9` | docs(memory): session snapshot for the v0.4.4 work | **PI-ONLY (record)** |

### Batch L — the consolidation prompt asks for compression, not deletion

The mechanism is under pi's `extensions/project-context/memory/`, and its round-1 review corrected the first
diagnosis: the entries were **not** deleted by the model. The renderer enforces each section's fixed budget and
drops whole entries that no longer fit, and the committed memory was over budget in three of its four sections
(Invariants +852, Pitfalls +239, Index +544 — pi's figures) while Project used 71% of its share; rendering that
version reproduced exactly the entries the field file was missing (`sectionDropped=3`, `droppedItems=9`) with
about 1 800 characters of the whole-document cap unused. What the prompt contributed was the *permission*: two
prompt-layer sites ended a section-budget sentence with "then drop the least durable entries" (the main rule)
and "remove the least durable entries" (the condensation retry). Both now ask for the same ladder in the same
order — keep every still-true entry, merge duplicates within a section, deduplicate across sections, condense
the wording until each section fits — and allow a deletion only with a stated reason (superseded, or already
covered elsewhere). `aaafd0b` adds a second layer at the block whose text the reply rewrites, and `009cceb`
extends the retry sentence to the sectionless cap path.

**What dsh already has**, read off our source:

- `memorySectionRule` (`src/project-memory/consolidate.ts:172`) states both numbers per section, built from
  `memorySectionBudgets` / `memorySectionPromptBudgets` with `MEMORY_SECTION_PROMPT_SHARE = 0.9`
  (`src/project-memory/memory-schema.ts:69`). pi's "aim the rule at the section budgets" half is therefore
  already here — the budgets are not the missing part.
- `memoryLossRetryRule` (`:212`) already names each section's exact overage (characters beyond the budget,
  entries that would be dropped whole), which pi's retry does not.

**What dsh lacks** (three wording sites, all in `src/project-memory/consolidate.ts`):

1. `:182`, inside `memorySectionRule`: "…When over budget, merge duplicates within a section, then drop the
   least durable entries." Deletion is the closing step and the precondition is unstated — pi's exact defect.
2. `:227`, inside `memoryLossRetryRule` — tier C's one targeted retry: "…bring every section inside its budget
   by merging duplicates within a section and dropping the least durable entries." This is the sharper one:
   dsh's retry is triggered *because* a reply would lose whole entries, and its closing instruction asks for
   the loss tier C refuses, so the prompt and the gate pull in opposite directions.
3. `:429`: the `<existing-memory>` block carries no caption. pi's second layer attaches the rule to the text it
   applies to.

**Why it matters here, now.** Measured through the built renderer against the real `MEMORY.md` after the
2026-10-06 `/memory update` (`.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs`):
Project 86.8%, Invariants 92.8%, Pitfalls 97.6%, Index 97.9% of the hard budgets — the same two-sections-over,
one-section-under shape pi hit, with **74 characters** of headroom in Index and 278 in Pitfalls. One added
Index line is a whole-entry drop, and tier C turns that into `lossy-refused` (nothing written, `MEMORY.md`
byte-identical). The durable lever is the document's size *and* a prompt that spends compression instead of
entries; raising `maxMemoryChars` aggravates the output half.

**Portable shape**: three wording changes and one added caption line, target `src/project-memory/consolidate.ts`,
pinned by tests asserting the ladder and the deletion-with-a-reason condition in both layers. The honest limit
is pi's own: prompt assertions prove the words are present, not that the model obeys, and the real acceptance is
the render surface (no section-budget drop line and no shrinking entry count across later renders).

### One latent coupling (from `6a00587`)

pi derives its fixed-floor fixture from `MIN_THRESHOLD_RATIO` because a hardcoded `0.1` turned a constant move
into collateral reds. dsh still writes the pair literally in test fixtures and in one regex:
`test/logic.test.mjs:2417` (`/between 0.1 and 0.95/`), `:3354`, `:3358`, and
`test/threshold-floor.test.mjs:62,79,93,159`. Since batch K the pair is one exported constant, so moving it
reddens assertions that are not about the move. The gate is green today, so this is coupling rather than a
defect, and it is recorded rather than changed.

### What this pass does NOT find

- The records commits (`b9085d5`, `c3757bb`, `9c2db1a`), the attention entries (`793b708`, `8cf0a9f`), the
  memory renders (`d023d0f`, `8baab6f`, `5a92c54`, `7ab60c9`) and the fix note (`65e9283`) are pi's own
  repository records; dsh records the equivalent under `docs/` and `.agents/evidence/`.
- `8baab6f` is a hand-restore of entries a render dropped; the restore was itself over the section budgets. It
  is the field loop batch L's rule addresses, not a change of its own.
- pi's `.codestable/attention.md` has no dsh counterpart, and its 150-column wrap rule is pi's own prose limit
  (dsh's README wraps at 100).

### Reproducible commands

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P fetch origin                                                  # the pass needs this first
git -C $P rev-parse HEAD origin/master                                  # 1a958ce / 7ab60c9
git -C $P rev-list --count c9d4db6..origin/master                       # 14
git -C $P rev-list --count --first-parent c9d4db6..origin/master        # 14 (no merge in this range)
git -C $P describe --tags c9d4db6                                       # v0.4.2-7-gc9d4db6
git -C $P describe --tags origin/master                                 # v0.4.4-2-g7ab60c9
git -C $P tag -l --sort=-v:refname | head -3                            # v0.4.4 / v0.4.3 / v0.4.2
git -C $P branch -a                                                     # no second branch
git -C $P log --oneline c9d4db6..origin/master                          # the 14 above
git -C $P show ed51eac -- extensions/project-context/memory/prompt.ts   # the first wording change
git -C $P show aaafd0b -- extensions/project-context/memory/prompt.ts extensions/project-context/memory/pass.ts
git -C $P show 009cceb -- extensions/project-context/memory/pass.ts
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -n 'least durable' -- src/project-memory/consolidate.ts  # 182, 227 — both still deletion-first
git -C $D grep -n 'existing-memory' -- src/project-memory/consolidate.ts # 429 — no caption line
git -C $D grep -n 'MEMORY_SECTION_PROMPT_SHARE' -- src/project-memory/  # memory-schema.ts:69 — budgets already stated
git -C $D grep -rn 'between 0\.1 and 0\.95' -- test/                     # logic.test.mjs:2417 — the hardcoded pair
node $D/.agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs   # the read-now occupancy
```

### The honest boundary

This is a per-module read of what pi's commits touch and of the mechanism under its dsh name, not a semantic
diff of the two trees; anything outside this repo (dsh core, the delivery line in `/etc/nixos`, the profiles
under `~/.dsh`) is not owned here. pi's diagnosis numbers (Invariants +852 / Pitfalls +239 / Index +544,
`sectionDropped=3`, `droppedItems=9`) are pi's field evidence as recorded in its own commits, not re-measured
here; dsh's occupancy percentages are read now from `share-fit.mjs` against the built `lib/`. Batch L is not
started: this pass edits `docs/` and memory only, `src/` is untouched, and no CHANGELOG entry or host restart
follows from it. Nothing was ported.
